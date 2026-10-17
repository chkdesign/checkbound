import { DiagnosticError } from './common.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stateDirectory } from './git.mjs';
import { privateDirectory,writeExclusive,readBytes,MAX_LOG_BYTES,MAX_RECEIPT_BYTES,parseJson } from './common.mjs';
import { ATTEMPT,validateReceipt } from './receipt.mjs';

function locations(root,create=false) {
  const raw=stateDirectory(root);
  const state=path.join(fs.realpathSync(path.dirname(raw)),path.basename(raw));
  if(!fs.existsSync(state)&&!create) {
    // lstat also catches dangling symlinks that existsSync considers missing.
    try {fs.lstatSync(state);throw new DiagnosticError('Unsafe state directory');} catch(e) {if(e.code!=='ENOENT') throw e;}
    return null;
  }
  privateDirectory(state,create);
  const attempts=path.join(state,'attempts');
  privateDirectory(attempts,create);
  return {state,attempts,lock:path.join(state,'run.lock')};
}
function attemptNames(attempts) {
  const names=fs.readdirSync(attempts);
  if(names.some(n=>!ATTEMPT.test(n))) throw new DiagnosticError('Unexpected attempt entry');
  return names.sort();
}
export function acquire(root) {
  const loc=locations(root,true);
  try {fs.mkdirSync(loc.lock,{mode:0o700});} catch(e) {if(e.code==='EEXIST') throw new DiagnosticError('A run lock exists; verify no run is active before removing it manually'); throw e;}
  return {...loc,release:()=>fs.rmdirSync(loc.lock)};
}
export function createAttempt(lock) {
  const names=attemptNames(lock.attempts),last=names.at(-1);
  const sequence=last?Number(last.slice(0,12))+1:1;
  if(sequence>999999999999) throw new DiagnosticError('Attempt sequence exhausted');
  const id=String(sequence).padStart(12,'0')+'-'+randomUUID(),dir=path.join(lock.attempts,id);
  fs.mkdirSync(dir,{mode:0o700});
  return {id,dir};
}
export const writeLog = (attempt,index,bytes) => writeExclusive(path.join(attempt.dir,`command-${index}.log`),bytes);
export function writeReceipt(attempt,record) {
  const bytes=JSON.stringify(record,null,2)+'\n';
  if(Buffer.byteLength(bytes)>MAX_RECEIPT_BYTES) throw new DiagnosticError('Receipt exceeds size limit');
  writeExclusive(path.join(attempt.dir,'receipt.json'),bytes);
}
export function readLatest(root) {
  const loc=locations(root); if(!loc) return null;
  try {fs.lstatSync(loc.lock);throw new DiagnosticError('Verification is in progress or its run lock remains');} catch(e) {if(e.code!=='ENOENT') throw e;}
  const id=attemptNames(loc.attempts).at(-1); if(!id) return null;
  const dir=path.join(loc.attempts,id); privateDirectory(dir);
  const r=parseJson(readBytes(path.join(dir,'receipt.json'),MAX_RECEIPT_BYTES));
  validateReceipt(r,name=>readBytes(path.join(dir,name),MAX_LOG_BYTES));
  if(r.attemptId!==id) throw new DiagnosticError('Attempt identity mismatch');
  return r;
}
