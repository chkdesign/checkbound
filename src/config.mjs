import { DiagnosticError } from './common.mjs';
import path from 'node:path';
import { canonical, sha256, keys, readBytes, MAX_LOG_BYTES, parseJson } from './common.mjs';

export const CONFIG_FILE='.checkbound.json';
export function validateConfig(config) {
  keys(config,['schemaVersion','baseRef','maxOutputBytes','commands']);
  if(config.schemaVersion!==1 || typeof config.baseRef!=='string' || !config.baseRef.trim() ||
    config.baseRef.startsWith('-') || config.baseRef.length>256 || /[\0\r\n]/.test(config.baseRef)) throw new DiagnosticError('Invalid base reference');
  if(!Number.isInteger(config.maxOutputBytes)||config.maxOutputBytes<1||config.maxOutputBytes>MAX_LOG_BYTES) throw new DiagnosticError('Invalid output limit');
  if(!Array.isArray(config.commands)||config.commands.length<1||config.commands.length>16) throw new DiagnosticError('Expected 1–16 commands');
  const ids=new Set();
  for(const c of config.commands) {
    keys(c,['id','argv','timeoutMs']);
    if(typeof c.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(c.id)||ids.has(c.id)) throw new DiagnosticError('Invalid or duplicate command id');
    ids.add(c.id);
    if(!Array.isArray(c.argv)||!c.argv.length||c.argv.length>128||c.argv.some(a=>typeof a!=='string'||a.includes('\0')||a.length>4096)||!c.argv[0]) throw new DiagnosticError('Invalid argv');
    if(!Number.isInteger(c.timeoutMs)||c.timeoutMs<1||c.timeoutMs>86400000) throw new DiagnosticError('Invalid timeout');
  }
  return config;
}
export const policyDigest = config => sha256(canonical(validateConfig(config)));
export function loadConfig(root) {
  const config=validateConfig(parseJson(readBytes(path.join(root,CONFIG_FILE),65536)));
  return {config,digest:policyDigest(config)};
}

export function serializeConfig(config) {
  const bytes=JSON.stringify(validateConfig(config),null,2)+'\n';
  if(Buffer.byteLength(bytes)>65536) throw new DiagnosticError('Configuration exceeds 65536-byte limit');
  return bytes;
}
