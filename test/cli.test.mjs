import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync,spawn } from 'node:child_process';
import { fixture,git,policy } from './helpers.mjs';
import { stateDirectory } from '../src/git.mjs';
const cli=fileURLToPath(new URL('../bin/checkbound.mjs',import.meta.url));
const invoke=(root,...args)=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH},timeout:10000});

test('first run configures, commits, verifies and exposes CURRENT JSON',t=>{
  const root=fixture(t,null);
  let r=invoke(root,'init','--base','main','--command',JSON.stringify([process.execPath,'-e','console.log("ok")']),'--timeout-ms','2000');
  assert.equal(r.status,0,r.stderr);assert.ok(fs.existsSync(path.join(root,'.checkbound.json')));
  assert.equal(fs.existsSync(stateDirectory(root)),false);
  assert.notEqual(invoke(root,'init','--base','main','--command','["node"]' ).status,0);
  git(root,'add','.checkbound.json');git(root,'commit','-qm','Configure synthetic verification');
  assert.equal(invoke(root,'status').status,3);
  r=invoke(root,'run');assert.notEqual(r.status,0);assert.equal(fs.existsSync(stateDirectory(root)),false);
  r=invoke(root,'run','--yes');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/CURRENT/);assert.match(r.stderr,/console.log/);
  r=invoke(root,'status','--json');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).state,'CURRENT');assert.equal(r.stderr,'');
});
test('failed CLI run remains FAILED and JSON corruption fails closed',t=>{
  const root=fixture(t,policy([process.execPath,'-e','process.exit(6)']));
  assert.equal(invoke(root,'run','--yes').status,1);
  assert.equal(JSON.parse(invoke(root,'status','--json').stdout).state,'FAILED');
  fs.writeFileSync(path.join(root,'.checkbound.json'),'{');
  const r=invoke(root,'status','--json');assert.equal(r.status,4);assert.equal(JSON.parse(r.stdout).state,'INVALID');
});
test('status never runs configured commands and missing state is read-only',t=>{
  const root=fixture(t,policy([process.execPath,'-e','require("fs").writeFileSync("unwanted","yes")']));
  const r=invoke(root,'status','--json');assert.equal(JSON.parse(r.stdout).state,'MISSING');
  assert.equal(fs.existsSync(path.join(root,'unwanted')),false);assert.equal(fs.existsSync(stateDirectory(root)),false);
});
test('CLI rejects unrecognized options without execution',t=>{
  const root=fixture(t);assert.notEqual(invoke(root,'run','--force').status,0);
  const r=invoke(root,'status','--json','--bad');assert.equal(JSON.parse(r.stdout).state,'INVALID');
  assert.equal(fs.existsSync(stateDirectory(root)),false);
});
test('CLI SIGINT records interrupted evidence',async t=>{
  const root=fixture(t,policy([process.execPath,'-e','setInterval(()=>{},1000)']));
  const child=spawn(process.execPath,[cli,'run','--yes'],{cwd:root,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',b=>stderr+=b);
  const closed=new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));
  // Wait until an attempt exists: interruption must exercise the running command, not startup.
  const deadline=Date.now()+5000;
  while(!fs.existsSync(path.join(stateDirectory(root),'attempts'))||fs.readdirSync(path.join(stateDirectory(root),'attempts')).length===0) {
    if(Date.now()>deadline) {child.kill('SIGKILL');throw new Error('No attempt started: '+stderr);}
    await new Promise(r=>setTimeout(r,20));
  }
  child.kill('SIGINT');const result=await closed;assert.equal(result.code,130);
  const r=invoke(root,'status','--json');assert.equal(JSON.parse(r.stdout).state,'FAILED');
});

test('refusals give actionable messages without exposing malformed config text',t=>{
  const root=fixture(t);fs.writeFileSync(path.join(root,'sample.txt'),'dirty');
  let r=invoke(root,'run','--yes');assert.match(r.stderr,/Working tree is dirty/);
  git(root,'checkout','--','sample.txt');
  fs.writeFileSync(path.join(root,'.checkbound.json'),'{"invented-private-value');
  r=invoke(root,'status','--json');assert.equal(JSON.parse(r.stdout).state,'INVALID');
  assert.equal(r.stdout.includes('invented-private-value'),false);assert.match(r.stdout,/JSON/);
});

test('init refuses configuration exceeding the readable size limit',t=>{
  const root=fixture(t,null),argv=['node',...Array.from({length:20},()=> 'x'.repeat(4000))];
  const result=invoke(root,'init','--base','main','--command',JSON.stringify(argv));
  assert.notEqual(result.status,0);assert.equal(fs.existsSync(path.join(root,'.checkbound.json')),false);
});

test('initialization reports detached HEAD and existing dirty state',t=>{
  const root=fixture(t,null);git(root,'checkout','--detach','-q');
  fs.writeFileSync(path.join(root,'sample.txt'),'dirty');
  const r=invoke(root,'init','--base','main','--command','["node","--test"]');
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/detached HEAD/);assert.match(r.stdout,/dirty/);
  assert.match(r.stdout,new RegExp(git(root,'rev-parse','HEAD')));
});
