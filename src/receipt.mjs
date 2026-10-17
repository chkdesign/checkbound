import { DiagnosticError } from './common.mjs';
import { canonical,sha256,keys,SHA,DIGEST,MAX_LOG_BYTES } from './common.mjs';

export const ATTEMPT = /^\d{12}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const validTime = value => typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const natural = value => Number.isSafeInteger(value)&&value>=0;
const fail = () => {throw new DiagnosticError('Invalid receipt');};
export function sealReceipt(record) {
  const { integrity:ignored,...body }=record;
  return {...body,integrity:{algorithm:'sha256',digest:sha256(canonical(body))}};
}
export function validateReceipt(r,readLog) {
  keys(r,['schemaVersion','attemptId','toolVersion','subject','policyDigest','context','startedAt','finishedAt','stateUnchanged','commands','integrity']);
  keys(r.integrity,['algorithm','digest']);
  if(r.integrity.algorithm!=='sha256'||!DIGEST.test(r.integrity.digest)||sealReceipt(r).integrity.digest!==r.integrity.digest) fail();
  if(r.schemaVersion!==1||typeof r.attemptId!=='string'||!ATTEMPT.test(r.attemptId)||
    typeof r.toolVersion!=='string'||!r.toolVersion||r.toolVersion.length>64||!DIGEST.test(r.policyDigest)) fail();
  keys(r.subject,['head','base','tree','branch']);
  if(![r.subject.head,r.subject.base,r.subject.tree].every(x=>typeof x==='string'&&SHA.test(x))||
    !(r.subject.branch===null||(typeof r.subject.branch==='string'&&r.subject.branch.length>0&&r.subject.branch.length<=1024))) fail();
  keys(r.context,['platform','arch','node','envDigest']);
  if(!['platform','arch','node'].every(k=>typeof r.context[k]==='string'&&r.context[k].length>0&&r.context[k].length<=64)||!DIGEST.test(r.context.envDigest)) fail();
  if(!validTime(r.startedAt)||!validTime(r.finishedAt)||r.finishedAt<r.startedAt||typeof r.stateUnchanged!=='boolean'||
    !Array.isArray(r.commands)||r.commands.length<1||r.commands.length>16) fail();
  const ids=new Set();
  r.commands.forEach((c,i)=>{
    keys(c,['id','argv','timeoutMs','startedAt','finishedAt','exitCode','signal','outcome','timedOut','errorCode','log']);
    if(typeof c.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(c.id)||ids.has(c.id)) fail();
    ids.add(c.id);
    if(!Array.isArray(c.argv)||!c.argv.length||c.argv.length>128||c.argv.some(a=>typeof a!=='string'||a.includes('\0')||a.length>4096)||!c.argv[0]||
      !Number.isInteger(c.timeoutMs)||c.timeoutMs<1||c.timeoutMs>86400000) fail();
    if(!validTime(c.startedAt)||!validTime(c.finishedAt)||c.finishedAt<c.startedAt||c.startedAt<r.startedAt||c.finishedAt>r.finishedAt) fail();
    if(!(c.exitCode===null||(Number.isInteger(c.exitCode)&&c.exitCode>=0&&c.exitCode<=4294967295))||
      !(c.signal===null||(typeof c.signal==='string'&&/^SIG[A-Z0-9]+$/.test(c.signal)))||
      !(c.errorCode===null||(typeof c.errorCode==='string'&&/^[A-Z0-9_]{1,64}$/.test(c.errorCode)))||typeof c.timedOut!=='boolean') fail();
    if(!['passed','failed','timeout','error','interrupted','not-run'].includes(c.outcome)) fail();
    if(c.timedOut!==(c.outcome==='timeout')) fail();
    if(c.outcome==='passed'&&(c.exitCode!==0||c.signal!==null||c.errorCode!==null)) fail();
    if(c.outcome==='failed'&&(c.exitCode===0||c.errorCode!==null||(c.exitCode===null&&c.signal===null))) fail();
    if(c.outcome==='error'&&(c.errorCode===null||c.exitCode!==null)) fail();
    if(c.outcome==='not-run'&&(c.exitCode!==null||c.signal!==null||c.errorCode!==null)) fail();
    keys(c.log,['file','sha256','capturedBytes','totalBytes','truncated']);
    const l=c.log;
    if(l.file!==`command-${i}.log`||!DIGEST.test(l.sha256)||!natural(l.capturedBytes)||l.capturedBytes>MAX_LOG_BYTES||
      !natural(l.totalBytes)||l.totalBytes<l.capturedBytes||typeof l.truncated!=='boolean'||l.truncated!==(l.totalBytes>l.capturedBytes)) fail();
    const bytes=readLog(l.file);
    if(!Buffer.isBuffer(bytes)||bytes.length!==l.capturedBytes||sha256(bytes)!==l.sha256) fail();
  });
  return r;
}
