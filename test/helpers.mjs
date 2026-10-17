import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const policy = (argv = [process.execPath, '-e', 'console.log("checked")']) => ({
  schemaVersion: 1, baseRef: 'main', maxOutputBytes: 65536,
  commands: [{ id: 'check', argv, timeoutMs: 2000 }],
});
export function git(root, ...args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: os.tmpdir(),
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Example Developer', GIT_AUTHOR_EMAIL: 'dev@example.invalid',
      GIT_COMMITTER_NAME: 'Example Developer', GIT_COMMITTER_EMAIL: 'dev@example.invalid' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
export function fixture(t, config = policy()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checkbound-synthetic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'sample.txt'), 'one\n');
  if (config) fs.writeFileSync(path.join(root, '.checkbound.json'), JSON.stringify(config));
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'Create synthetic fixture');
  return root;
}
export function commit(root, name = 'sample.txt', value = 'two\n') {
  fs.writeFileSync(path.join(root, name), value);
  git(root, 'add', name); git(root, 'commit', '-qm', 'Update synthetic fixture');
}

import { createHash } from 'node:crypto';
export function exampleReceipt(attemptId='000000000001-00000000-0000-4000-8000-000000000000') {
  return {schemaVersion:1,attemptId,toolVersion:'0.1.0',
    subject:{head:'a'.repeat(40),base:'b'.repeat(40),tree:'c'.repeat(40),branch:'main'},
    policyDigest:'d'.repeat(64),context:{platform:'darwin',arch:'arm64',node:'v24.0.0',envDigest:'e'.repeat(64)},
    startedAt:'2026-01-01T00:00:00.000Z',finishedAt:'2026-01-01T00:00:01.000Z',stateUnchanged:true,
    commands:[{id:'check',argv:['node','--test'],timeoutMs:1000,startedAt:'2026-01-01T00:00:00.000Z',
      finishedAt:'2026-01-01T00:00:01.000Z',exitCode:0,signal:null,outcome:'passed',timedOut:false,errorCode:null,
      log:{file:'command-0.log',sha256:createHash('sha256').update('ok').digest('hex'),capturedBytes:2,totalBytes:2,truncated:false}}]};
}
