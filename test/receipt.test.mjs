import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleReceipt } from './helpers.mjs';


test('receipt detects edits and requires matching log bytes', async () => {
  const { sealReceipt, validateReceipt }=await import('../src/receipt.mjs');
  const good=sealReceipt(exampleReceipt()); assert.equal(validateReceipt(good,()=>Buffer.from('ok')),good);
  const changed=structuredClone(good); changed.commands[0].exitCode=9;
  assert.throws(()=>validateReceipt(changed,()=>Buffer.from('ok')));
  assert.throws(()=>validateReceipt(good,()=>Buffer.from('no')));
  assert.throws(()=>validateReceipt(good,()=>{throw new Error('Missing');}));
});
test('even rehashed malformed receipts fail closed', async () => {
  const { sealReceipt, validateReceipt }=await import('../src/receipt.mjs');
  for(const change of [r=>delete r.subject, r=>r.schemaVersion=99,r=>r.commands=[],
    r=>r.commands[0].log.file='../outside', r=>r.commands[0].exitCode=7,
    r=>r.commands[0].timedOut=true, r=>r.commands[0].signal='SIGTERM',
    r=>r.commands[0].log.capturedBytes=1048577, r=>r.commands[0].log.truncated=true,
    r=>r.extra='unknown',r=>r.finishedAt='not a date']) {
    const r=exampleReceipt(); change(r); assert.throws(()=>validateReceipt(sealReceipt(r),()=>Buffer.from('ok')));
  }
});
