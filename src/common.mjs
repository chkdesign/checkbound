import fs from 'node:fs';
import { createHash } from 'node:crypto';

export class DiagnosticError extends Error {}
export function safeReason(error) {
  if(error instanceof DiagnosticError) return error.message;
  return ({ENOENT:'Required configuration or evidence file is missing',EEXIST:'File already exists; refusing to overwrite',ELOOP:'Linked files are not supported',EACCES:'Permission denied reading local files'})[error?.code] ?? 'Cannot safely read configuration, Git state or local evidence';
}
export function parseJson(bytes) {
  try {return JSON.parse(bytes.toString('utf8'));} catch {throw new DiagnosticError('Invalid JSON in configuration or receipt');}
}

export const VERSION = '0.1.0';
export const MAX_LOG_BYTES = 1048576;
export const MAX_RECEIPT_BYTES = 1048576;
export const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export const DIGEST = /^[a-f0-9]{64}$/;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
export function keys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join('|') !== [...expected].sort().join('|')) throw new DiagnosticError('Unexpected or missing fields');
}
export function readBytes(file, limit) {
  const before=fs.lstatSync(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size>limit) throw new DiagnosticError('Unsafe or oversized file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const st=fs.fstatSync(fd);
    if (!st.isFile() || st.size > limit) throw new DiagnosticError('Unsafe or oversized file');
    const buffer=Buffer.alloc(limit+1); let offset=0, n;
    while (offset <= limit && (n=fs.readSync(fd,buffer,offset,limit+1-offset,null)) > 0) offset+=n;
    if (offset > limit) throw new DiagnosticError('Oversized file');
    return buffer.subarray(0,offset);
  } finally { fs.closeSync(fd); }
}
export function privateDirectory(dir, create=false) {
  if (create) { try { fs.mkdirSync(dir,{mode:0o700}); } catch(e) { if(e.code!=='EEXIST') throw e; } }
  const st=fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || (process.platform!=='win32' && (st.mode & 0o077))) {
    throw new DiagnosticError('Unsafe state directory');
  }
}
export function writeExclusive(file, bytes) {
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
  try { fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function commandEnvironment() {
  const env={PATH:process.env.PATH ?? '',LANG:'C'};
  if(process.platform==='win32') for(const k of ['SystemRoot','ComSpec','PATHEXT']) if(process.env[k]) env[k]=process.env[k];
  return env;
}
export const executionContext = () => ({platform:process.platform,arch:process.arch,node:process.version,envDigest:sha256(canonical(commandEnvironment()))});
