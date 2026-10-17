import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture,policy,git } from './helpers.mjs';
import { loadConfig } from '../src/config.mjs';
import { stateDirectory } from '../src/git.mjs';
const options = root => ({authorized:true,approvedPolicyDigest:loadConfig(root).digest});
const node = code => [process.execPath,'-e',code];

test('commands require authorization bound to displayed policy', async t => {
  const { runVerification }=await import('../src/run.mjs');
  const root=fixture(t,policy(node('require("fs").writeFileSync("executed","yes")')));
  await assert.rejects(()=>runVerification(root,{}));
  await assert.rejects(()=>runVerification(root,{...options(root),approvedPolicyDigest:'0'.repeat(64)}));
  assert.equal(fs.existsSync(path.join(root,'executed')),false);
});

test('successful execution binds state and preserves separate attempts', async t => {
  const { runVerification }=await import('../src/run.mjs');
  const { readLatest }=await import('../src/store.mjs');
  const root=fixture(t),one=await runVerification(root,options(root)),two=await runVerification(root,options(root));
  assert.equal(one.commands[0].outcome,'passed'); assert.equal(one.subject.head,git(root,'rev-parse','HEAD'));
  assert.equal(one.policyDigest,loadConfig(root).digest); assert.equal(one.stateUnchanged,true);
  assert.notEqual(one.attemptId,two.attemptId); assert.equal(readLatest(root).attemptId,two.attemptId);
  assert.equal(fs.readdirSync(path.join(stateDirectory(root),'attempts')).length,2);
});

for(const [name,argv,timeoutMs,want,code] of [
  ['nonzero exit',node('process.exit(7)'),2000,'failed',7],
  ['timeout',node('setInterval(()=>{},1000)'),100,'timeout',null],
  ['missing executable',['checkbound-nonexistent-executable-12345'],2000,'error',null],
  ['signal exit',node('process.kill(process.pid,"SIGTERM")'),2000,'failed',null],
]) test(name+' cannot pass',async t=>{
  const { runVerification }=await import('../src/run.mjs');
  const c=policy(argv);c.commands[0].timeoutMs=timeoutMs;
  const root=fixture(t,c),r=await runVerification(root,options(root));
  assert.equal(r.commands[0].outcome,want); assert.equal(r.commands[0].exitCode,code);
  assert.equal(r.commands[0].timedOut,want==='timeout');
});

test('output capture is bounded without breaking the command',async t=>{
  const { runVerification }=await import('../src/run.mjs');
  const c=policy(node('process.stdout.write("x".repeat(100000)); process.stderr.write("y".repeat(100000))'));c.maxOutputBytes=100;
  const root=fixture(t,c),r=await runVerification(root,options(root)),l=r.commands[0].log;
  assert.equal(r.commands[0].outcome,'passed');assert.equal(l.capturedBytes,100);assert.equal(l.totalBytes,200000);assert.equal(l.truncated,true);
  assert.equal(fs.statSync(path.join(stateDirectory(root),'attempts',r.attemptId,l.file)).size,100);
});

test('interrupt records failure and does not run remaining commands',async t=>{
  const { runVerification }=await import('../src/run.mjs');
  const c=policy(node('setInterval(()=>{},1000)'));c.commands.push({id:'second',argv:node('require("fs").writeFileSync("unwanted","yes")'),timeoutMs:2000});
  const root=fixture(t,c),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),300);
  const r=await runVerification(root,{...options(root),signal:controller.signal});clearTimeout(timer);
  assert.equal(r.commands[0].outcome,'interrupted');assert.equal(r.commands[1].outcome,'not-run');
  assert.equal(fs.existsSync(path.join(root,'unwanted')),false);
});

test('argv is literal and environment secrets are not forwarded or serialized',async t=>{
  const { runVerification }=await import('../src/run.mjs');
  const c=policy([...node('console.log(process.argv[1]); console.log(process.env.CHECKBOUND_TEST_SECRET ?? "absent")'),'$(touch unwanted); *']);
  const root=fixture(t,c),before=process.env.CHECKBOUND_TEST_SECRET;process.env.CHECKBOUND_TEST_SECRET='invented-value-for-env-check';
  try {
    const r=await runVerification(root,options(root));
    const log=fs.readFileSync(path.join(stateDirectory(root),'attempts',r.attemptId,r.commands[0].log.file),'utf8');
    assert.equal(log,'$(touch unwanted); *\nabsent\n');assert.equal(fs.existsSync(path.join(root,'unwanted')),false);
    assert.equal(JSON.stringify(r).includes('invented-value-for-env-check'),false);
  } finally {if(before===undefined) delete process.env.CHECKBOUND_TEST_SECRET;else process.env.CHECKBOUND_TEST_SECRET=before;}
});

test('dirty or uncommitted configuration prevents execution',async t=>{
  const { runVerification }=await import('../src/run.mjs');
  const root=fixture(t);fs.writeFileSync(path.join(root,'sample.txt'),'changed');
  await assert.rejects(()=>runVerification(root,options(root)));
  git(root,'checkout','--','sample.txt');git(root,'rm','--cached','.checkbound.json');
  fs.writeFileSync(path.join(root,'.gitignore'),'.checkbound.json\n');git(root,'add','.gitignore');git(root,'commit','-qm','Ignore synthetic config');
  await assert.rejects(()=>runVerification(root,options(root)));
});

test('commands changing files or HEAD cannot establish unchanged state',async t=>{
  const { runVerification }=await import('../src/run.mjs');
  for(const argv of [node('require("fs").writeFileSync("sample.txt","changed")'),
    ['git','checkout','--orphan','invented-empty-branch']]) {
    const root=fixture(t,policy(argv)),r=await runVerification(root,options(root));assert.equal(r.stateUnchanged,false);
  }
});

test('run in detached HEAD preserves detached subject',async t=>{
  const { runVerification }=await import('../src/run.mjs');
  const root=fixture(t);git(root,'checkout','-q','--detach');
  assert.equal((await runVerification(root,options(root))).subject.branch,null);
});
