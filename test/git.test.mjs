import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture, git } from './helpers.mjs';

test('snapshot resolves full commits and detects dirty files', async t => {
  const { snapshot } = await import('../src/git.mjs');
  const root=fixture(t), clean=snapshot(root,'main');
  assert.equal(clean.head, git(root,'rev-parse','HEAD'));
  assert.equal(clean.base, clean.head); assert.equal(clean.branch,'main'); assert.equal(clean.dirty,false);
  fs.writeFileSync(path.join(root,'new.txt'),'untracked'); assert.equal(snapshot(root,'main').dirty,true);
});
test('detached HEAD is supported and nonrepositories fail', async t => {
  const { snapshot, repositoryRoot } = await import('../src/git.mjs');
  const root=fixture(t); git(root,'checkout','--detach','-q');
  assert.equal(snapshot(root,'main').branch,null);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'checkbound-not-git-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.throws(()=>repositoryRoot(dir)); assert.throws(()=>snapshot(root,'missing'));
});
test('snapshot disables repository fsmonitor execution', async t => {
  const { snapshot } = await import('../src/git.mjs');
  const root=fixture(t), marker=path.join(root,'hook-ran');
  const hook=path.join(root,'.git','monitor');
  fs.writeFileSync(hook, '#!/bin/sh\ntouch "'+marker+'"\n'); fs.chmodSync(hook,0o700);
  git(root,'config','core.fsmonitor',hook); snapshot(root,'main');
  assert.equal(fs.existsSync(marker),false);
});

test('index flags cannot hide tracked modifications from verification',async t=>{
  const { snapshot }=await import('../src/git.mjs');
  for(const flag of ['--assume-unchanged','--skip-worktree']) {
    const root=fixture(t);git(root,'update-index',flag,'sample.txt');
    fs.writeFileSync(path.join(root,'sample.txt'),'hidden mutation');
    assert.throws(()=>snapshot(root,'main'));
  }
});
