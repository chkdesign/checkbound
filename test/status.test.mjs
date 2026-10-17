import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture,policy,git,commit } from './helpers.mjs';
import { loadConfig } from '../src/config.mjs';
import { runVerification } from '../src/run.mjs';
import { stateDirectory } from '../src/git.mjs';
import { sealReceipt } from '../src/receipt.mjs';
const run=root=>runVerification(root,{authorized:true,approvedPolicyDigest:loadConfig(root).digest});

test('missing evidence is MISSING and status creates no storage',async t=>{
  const { status }=await import('../src/status.mjs');const root=fixture(t);
  assert.equal(status(root).state,'MISSING');assert.equal(fs.existsSync(stateDirectory(root)),false);
});
test('clean successful evidence is CURRENT and dirty files make it STALE',async t=>{
  const { status }=await import('../src/status.mjs');const root=fixture(t);await run(root);
  assert.equal(status(root).state,'CURRENT');fs.writeFileSync(path.join(root,'extra'),'x');
  assert.equal(status(root).state,'STALE');fs.unlinkSync(path.join(root,'extra'));assert.equal(status(root).state,'CURRENT');
});
test('a new commit with the same tree invalidates evidence',async t=>{
  const { status }=await import('../src/status.mjs');const root=fixture(t);await run(root);
  git(root,'commit','--allow-empty','-qm','New synthetic revision');
  assert.equal(status(root).state,'STALE');assert.ok(status(root).reasons.some(r=>r.includes('HEAD')));
});
test('base advancement independently invalidates evidence',async t=>{
  const { status }=await import('../src/status.mjs');const root=fixture(t);git(root,'switch','-qc','topic');await run(root);
  const next=git(root,'commit-tree','HEAD^{tree}','-p','main','-m','Advance synthetic base');git(root,'update-ref','refs/heads/main',next);
  assert.equal(status(root).state,'STALE');assert.ok(status(root).reasons.some(r=>r.includes('base')));
});
for(const [label,change] of [['command',c=>c.commands[0].argv.push('changed')],['timeout',c=>c.commands[0].timeoutMs++],
  ['output limit',c=>c.maxOutputBytes++],['base reference',c=>c.baseRef='HEAD']]) test(label+' changes invalidate policy',async t=>{
  const { status }=await import('../src/status.mjs');const root=fixture(t);await run(root);
  const c=loadConfig(root).config;change(c);fs.writeFileSync(path.join(root,'.checkbound.json'),JSON.stringify(c));
  assert.equal(status(root).state,'STALE');assert.ok(status(root).reasons.includes('Verification policy changed'));
});
for(const [label,argv,timeout] of [['failure',[process.execPath,'-e','process.exit(4)'],2000],
  ['timeout',[process.execPath,'-e','setInterval(()=>{},1000)'],100]]) test(label+' evidence is FAILED',async t=>{
  const { status }=await import('../src/status.mjs');const c=policy(argv);c.commands[0].timeoutMs=timeout;
  const root=fixture(t,c);await run(root);assert.equal(status(root).state,'FAILED');
});
test('detectable state mutations during execution remain STALE after cleanup',async t=>{
  const { status }=await import('../src/status.mjs');const root=fixture(t,policy([process.execPath,'-e','require("fs").writeFileSync("sample.txt","changed")']));
  await run(root);git(root,'checkout','--','sample.txt');assert.equal(status(root).state,'STALE');
});
test('latest invalid attempt and active lock block an older CURRENT result',async t=>{
  const { status }=await import('../src/status.mjs');const {acquire,createAttempt}=await import('../src/store.mjs');
  const root=fixture(t);await run(root);const lock=acquire(root);assert.equal(status(root).state,'INVALID');
  createAttempt(lock);lock.release();assert.equal(status(root).state,'INVALID');
});
test('receipt/log tampering and omitted outcomes are INVALID',async t=>{
  const { status }=await import('../src/status.mjs');const root=fixture(t),receipt=await run(root);
  const dir=path.join(stateDirectory(root),'attempts',receipt.attemptId),file=path.join(dir,'receipt.json');
  fs.writeFileSync(path.join(dir,'command-0.log'),'changed');assert.equal(status(root).state,'INVALID');
  fs.writeFileSync(path.join(dir,'command-0.log'),'checked\n');
  const changed=structuredClone(receipt);changed.commands[0].argv.push('invented');
  fs.writeFileSync(file,JSON.stringify(sealReceipt(changed)));assert.equal(status(root).state,'INVALID');
  changed.commands=[];fs.writeFileSync(file,JSON.stringify(sealReceipt(changed)));assert.equal(status(root).state,'INVALID');
});
test('tool/context changes invalidate otherwise well-formed evidence',async t=>{
  const { status }=await import('../src/status.mjs');const root=fixture(t),receipt=await run(root);
  const file=path.join(stateDirectory(root),'attempts',receipt.attemptId,'receipt.json');
  for(const change of [r=>r.toolVersion='other',r=>r.context.node='v99.0.0',r=>r.context.envDigest='a'.repeat(64)]) {
    const next=structuredClone(receipt);change(next);fs.writeFileSync(file,JSON.stringify(sealReceipt(next)));assert.equal(status(root).state,'STALE');
  }
});
test('read-only status preserves evidence bytes, file set and modification times',async t=>{
  const { status }=await import('../src/status.mjs');const root=fixture(t);await run(root);
  function files(dir) {return Object.fromEntries(fs.readdirSync(dir,{recursive:true}).filter(n=>fs.statSync(path.join(dir,n)).isFile()).map(n=>{
    const f=path.join(dir,n);return[n,[fs.readFileSync(f).toString('base64'),fs.statSync(f).mtimeMs]];
  }));}
  const before=files(root);assert.equal(status(root).state,'CURRENT');assert.deepEqual(files(root),before);
});
test('detached HEAD can be CURRENT and invalid config fails closed',async t=>{
  const { status }=await import('../src/status.mjs');const root=fixture(t);git(root,'checkout','-q','--detach');await run(root);
  assert.equal(status(root).state,'CURRENT');fs.writeFileSync(path.join(root,'.checkbound.json'),'{');assert.equal(status(root).state,'INVALID');
});
