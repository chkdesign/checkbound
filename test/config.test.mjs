import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, policy } from './helpers.mjs';

test('execution-affecting policy fields change its digest', async t => {
  const { validateConfig, policyDigest } = await import('../src/config.mjs');
  const base = policy(); validateConfig(base);
  for (const change of [c => c.commands[0].argv.push('extra'), c => c.commands[0].timeoutMs++,
    c => c.maxOutputBytes++, c => c.baseRef = 'other']) {
    const next = structuredClone(base); change(next);
    assert.notEqual(policyDigest(next), policyDigest(base));
  }
  assert.equal(policyDigest({...base, commands: base.commands}), policyDigest(base));
});

test('config rejects unknown keys and invalid command boundaries', async () => {
  const { validateConfig } = await import('../src/config.mjs');
  const cases = [ {...policy(), shell: true}, {...policy(), commands: []},
    {...policy(), baseRef: '-bad'}, {...policy(), maxOutputBytes: 0} ];
  for (const mutation of [c => c.commands[0].argv = [], c => c.commands[0].timeoutMs = 0,
    c => c.commands[0].argv[0] = 'bad\0file', c => c.commands.push(c.commands[0]),
    c => c.commands[0].env = {SECRET:'no'}]) { const c=policy(); mutation(c); cases.push(c); }
  for (const c of cases) assert.throws(() => validateConfig(c));
});

test('config reads are bounded and reject symlinks', async t => {
  const { loadConfig } = await import('../src/config.mjs');
  const root=fixture(t), file=path.join(root,'.checkbound.json');
  assert.equal(loadConfig(root).config.commands[0].id, 'check');
  fs.writeFileSync(file, ' '.repeat(65537)); assert.throws(() => loadConfig(root));
  fs.unlinkSync(file); fs.symlinkSync('sample.txt', file); assert.throws(() => loadConfig(root));
});
