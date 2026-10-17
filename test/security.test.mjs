import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync,spawnSync } from 'node:child_process';
import { fixture,policy,git } from './helpers.mjs';
import { loadConfig } from '../src/config.mjs';
import { runVerification } from '../src/run.mjs';
import { snapshot,stateDirectory } from '../src/git.mjs';
const cli=fileURLToPath(new URL('../bin/checkbound.mjs',import.meta.url));

test('FIFO evidence cannot block read-only status', {skip:process.platform==='win32'},async t=>{
  const root=fixture(t),r=await runVerification(root,{authorized:true,approvedPolicyDigest:loadConfig(root).digest});
  const log=path.join(stateDirectory(root),'attempts',r.attemptId,'command-0.log');fs.unlinkSync(log);
  execFileSync('mkfifo',[log]);
  const result=spawnSync(process.execPath,[cli,'status','--json'],{cwd:root,encoding:'utf8',timeout:2000});
  assert.equal(result.status,4);assert.equal(JSON.parse(result.stdout).state,'INVALID');
});

for(const mode of ['timeout','interruption']) test(mode+' terminates same-group descendants even if the leader exits first',{skip:process.platform==='win32'},async t=>{
  const childCode='process.on("SIGTERM",()=>{}); setTimeout(()=>require("fs").writeFileSync(".git/survived","yes"),1500); setInterval(()=>{},1000)';
  const parentCode='const p=require("child_process").spawn(process.execPath,["-e",'+JSON.stringify(childCode)+'],{stdio:"ignore"}); require("fs").writeFileSync(".git/descendant-pid",String(p.pid)); setInterval(()=>{},1000)';
  const c=policy([process.execPath,'-e',parentCode]);c.commands[0].timeoutMs=mode==='timeout'?1000:3000;const root=fixture(t,c);let childPid;
  const controller=new AbortController(),timer=mode==='interruption'?setTimeout(()=>controller.abort(),1100):null;
  t.after(()=>{clearTimeout(timer);try{if(childPid) process.kill(childPid,'SIGKILL');}catch{}});
  const r=await runVerification(root,{authorized:true,approvedPolicyDigest:loadConfig(root).digest,signal:controller.signal});
  childPid=Number(fs.readFileSync(path.join(root,'.git/descendant-pid'),'utf8'));clearTimeout(timer);assert.equal(r.commands[0].outcome,mode==='timeout'?'timeout':'interrupted');
  await new Promise(resolve=>setTimeout(resolve,700));assert.equal(fs.existsSync(path.join(root,'.git/survived')),false);
});

test('Git clean filters cannot execute during inspection',t=>{
  const root=fixture(t);fs.writeFileSync(path.join(root,'.gitattributes'),'sample.txt filter=example\n');
  git(root,'add','.gitattributes');git(root,'commit','-qm','Synthetic attributes');
  git(root,'config','filter.example.clean','printf x > .git/filter-marker; cat');
  const now=new Date(Date.now()+5000);fs.utimesSync(path.join(root,'sample.txt'),now,now);
  assert.throws(()=>snapshot(root,'main'));assert.equal(fs.existsSync(path.join(root,'.git/filter-marker')),false);
});

test('submodule entries fail closed before recursive status',t=>{
  const root=fixture(t),sha=git(root,'rev-parse','HEAD');
  git(root,'update-index','--add','--cacheinfo',`160000,${sha},example-module`);git(root,'commit','-qm','Synthetic gitlink');
  assert.throws(()=>snapshot(root,'main'));
});

test('timeout returns even when an escaped descendant keeps an output pipe open',{skip:process.platform==='win32'},t=>{
  const escaped='setInterval(()=>{},1000)';
  const parent='const p=require("child_process").spawn(process.execPath,["-e",'+JSON.stringify(escaped)+'],{detached:true,stdio:"inherit"}); require("fs").writeFileSync(".git/escaped-pid",String(p.pid)); setInterval(()=>{},1000)';
  const c=policy([process.execPath,'-e',parent]);c.commands[0].timeoutMs=500;const root=fixture(t,c);
  const r=spawnSync(process.execPath,[cli,'run','--yes'],{cwd:root,encoding:'utf8',timeout:5000,killSignal:'SIGKILL'});
  try {
    assert.equal(r.status,1);assert.match(r.stdout,/FAILED/);
  } finally {try{process.kill(Number(fs.readFileSync(path.join(root,'.git/escaped-pid'),'utf8')),'SIGKILL');}catch{}}
});
