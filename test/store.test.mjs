import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './helpers.mjs';
import { exampleReceipt } from './helpers.mjs';

test('attempts are monotonic, private, preserved and never fall back over incomplete records', async t => {
  const { acquire, createAttempt, writeLog, writeReceipt, readLatest }=await import('../src/store.mjs');
  const { sealReceipt }=await import('../src/receipt.mjs');
  const root=fixture(t); assert.equal(readLatest(root),null);
  const lock=acquire(root); assert.throws(()=>acquire(root)); assert.throws(()=>readLatest(root));
  const first=createAttempt(lock); writeLog(first,0,Buffer.from('ok'));
  writeReceipt(first,sealReceipt(exampleReceipt(first.id))); lock.release();
  assert.equal(readLatest(root).attemptId,first.id);
  assert.equal(fs.statSync(path.join(first.dir,'receipt.json')).mode&0o777,0o600);
  const nextLock=acquire(root),second=createAttempt(nextLock); nextLock.release();
  assert.ok(second.id>first.id); assert.ok(fs.existsSync(path.join(first.dir,'receipt.json')));
  assert.throws(()=>readLatest(root));
});
test('storage rejects linked logs, linked directories, corrupt JSON and oversized records', async t => {
  const { acquire,createAttempt,writeLog,writeReceipt,readLatest }=await import('../src/store.mjs');
  const { stateDirectory }=await import('../src/git.mjs');
  const { sealReceipt }=await import('../src/receipt.mjs');
  const root=fixture(t),lock=acquire(root),attempt=createAttempt(lock);
  writeLog(attempt,0,Buffer.from('ok')); writeReceipt(attempt,sealReceipt(exampleReceipt(attempt.id))); lock.release();
  const log=path.join(attempt.dir,'command-0.log'),receipt=path.join(attempt.dir,'receipt.json');
  fs.unlinkSync(log); fs.symlinkSync(path.join(root,'sample.txt'),log); assert.throws(()=>readLatest(root));
  fs.unlinkSync(log); fs.writeFileSync(log,'ok',{mode:0o600});
  fs.writeFileSync(receipt,'{'); assert.throws(()=>readLatest(root));
  fs.writeFileSync(receipt,' '.repeat(1048577)); assert.throws(()=>readLatest(root));
  fs.rmSync(path.join(stateDirectory(root),'attempts'),{recursive:true});
  fs.symlinkSync(root,path.join(stateDirectory(root),'attempts')); assert.throws(()=>readLatest(root));
});
