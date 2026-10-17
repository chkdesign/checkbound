import { DiagnosticError } from './common.mjs';
import { spawn } from 'node:child_process';
import { loadConfig } from './config.mjs';
import { repositoryRoot,snapshot,assertCommittedConfig } from './git.mjs';
import { acquire,createAttempt,writeLog,writeReceipt } from './store.mjs';
import { sealReceipt,validateReceipt } from './receipt.mjs';
import { VERSION,canonical,sha256,commandEnvironment,executionContext } from './common.mjs';

function execute(command,cwd,env,limit,signal) {
  return new Promise(resolve=>{
    const startedAt=new Date().toISOString(),output=Buffer.alloc(limit);
    let captured=0,total=0,stop=null,errorCode=null,child,timer,cleanup=Promise.resolve();
    const consume=chunk=>{total=Math.min(Number.MAX_SAFE_INTEGER,total+chunk.length);const n=Math.min(chunk.length,limit-captured);chunk.copy(output,captured,0,n);captured+=n;};
    const terminate=reason=>{
      if(stop) return;stop=reason;
      const kill=sig=>{try {if(child.pid) {if(process.platform!=='win32') process.kill(-child.pid,sig);else child.kill(sig);}} catch(e) {if(e.code!=='ESRCH') errorCode='KILL_ERROR';}};
      kill('SIGTERM');cleanup=new Promise(done=>setTimeout(()=>{
        kill('SIGKILL');
        // Escaped descendants may retain inherited pipes. Stop waiting for their output.
        child.stdout.destroy();child.stderr.destroy();
        done();
      },200));
    };
    const abort=()=>terminate('interrupted');
    if(signal?.aborted) {
      resolve({result:{...command,startedAt,finishedAt:startedAt,exitCode:null,signal:null,outcome:'interrupted',timedOut:false,errorCode:null},bytes:Buffer.alloc(0),total:0});return;
    }
    child=spawn(command.argv[0],command.argv.slice(1),{cwd,env,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],windowsHide:true});
    child.stdout.on('data',consume);child.stderr.on('data',consume);
    child.on('error',e=>{errorCode=/^[A-Z0-9_]{1,64}$/.test(e.code ?? '')?e.code:'SPAWN_ERROR';});
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>terminate('timeout'),command.timeoutMs);
    child.on('close',async (code,terminationSignal)=>{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
      await cleanup;
      resolve({result:{...command,startedAt,finishedAt:new Date().toISOString(),exitCode:!errorCode&&Number.isInteger(code)&&code>=0?code:null,signal:terminationSignal,
        outcome:stop ?? (errorCode?'error':code===0?'passed':'failed'),timedOut:stop==='timeout',errorCode},
        bytes:output.subarray(0,captured),total});
    });
  });
}
const subject = s => ({head:s.head,base:s.base,tree:s.tree,branch:s.branch});
export async function runVerification(cwd,{authorized=false,approvedPolicyDigest,signal}={}) {
  if(authorized!==true||typeof approvedPolicyDigest!=='string') throw new DiagnosticError('Explicit command authorization is required');
  const root=repositoryRoot(cwd),lock=acquire(root);
  try {
    // Reload only after taking the lock: approval must cover precisely this policy.
    const {config,digest}=loadConfig(root);
    if(digest!==approvedPolicyDigest) throw new DiagnosticError('Policy changed after authorization; review commands again');
    const initial=snapshot(root,config.baseRef);assertCommittedConfig(root);
    if(initial.dirty) throw new DiagnosticError('Working tree is dirty; commit or remove changes before verification');
    const attempt=createAttempt(lock),startedAt=new Date().toISOString(),context=executionContext(),env=commandEnvironment(),logs=new Map(),commands=[];
    let interrupted=false;
    for(const [index,command] of config.commands.entries()) {
      let item;
      if(interrupted) {
        const time=new Date().toISOString();
        item={result:{...command,startedAt:time,finishedAt:time,exitCode:null,signal:null,outcome:'not-run',timedOut:false,errorCode:null},bytes:Buffer.alloc(0),total:0};
      } else item=await execute(command,root,env,config.maxOutputBytes,signal);
      interrupted ||= item.result.outcome==='interrupted';
      const file=`command-${index}.log`;
      writeLog(attempt,index,item.bytes);logs.set(file,item.bytes);
      commands.push({...item.result,log:{file,sha256:sha256(item.bytes),capturedBytes:item.bytes.length,totalBytes:item.total,truncated:item.total>item.bytes.length}});
    }
    let stateUnchanged=false;
    try {
      const end=snapshot(root,config.baseRef);
      stateUnchanged=!end.dirty&&canonical(subject(end))===canonical(subject(initial))&&loadConfig(root).digest===digest;
    } catch { /* A deleted config or invalid Git state cannot establish freshness. */ }
    const receipt=sealReceipt({schemaVersion:1,attemptId:attempt.id,toolVersion:VERSION,subject:subject(initial),policyDigest:digest,context,
      startedAt,finishedAt:new Date().toISOString(),stateUnchanged,commands});
    validateReceipt(receipt,name=>logs.get(name));writeReceipt(attempt,receipt);
    return receipt;
  } finally {lock.release();}
}
