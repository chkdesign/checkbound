#!/usr/bin/env node
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { CONFIG_FILE,validateConfig,loadConfig,serializeConfig } from '../src/config.mjs';
import { repositoryRoot,snapshot,stateDirectory } from '../src/git.mjs';
import { writeExclusive,VERSION,DiagnosticError,safeReason } from '../src/common.mjs';
import { runVerification } from '../src/run.mjs';
import { status,EXIT_CODES } from '../src/status.mjs';

const args=process.argv.slice(2),[command,...flags]=args;
function only(allowed) {for(const f of flags) if(!allowed.includes(f)) throw new DiagnosticError('Unrecognized option');}
function printStatus(result,json=false) {
  if(json) console.log(JSON.stringify(result));
  else {console.log(`${result.state} — ${result.reasons.join('; ')}`);if(result.attemptId) console.log(`Attempt: ${result.attemptId}`);}
  process.exitCode=EXIT_CODES[result.state];
}
async function initialize() {
  const options={};
  for(let i=0;i<flags.length;i+=2) {
    if(!['--base','--command','--timeout-ms'].includes(flags[i])||flags[i+1]===undefined||options[flags[i]]!==undefined) throw new DiagnosticError('Expected --base REF --command JSON_ARGV [--timeout-ms N]');
    options[flags[i]]=flags[i+1];
  }
  const root=repositoryRoot(process.cwd());
  if(!options['--base']||!options['--command']) {
    if(!process.stdin.isTTY) throw new DiagnosticError('Noninteractive init requires --base and --command');
    const prompt=createInterface({input:process.stdin,output:process.stdout});
    try {
      options['--base']??=(await prompt.question('Base reference [main]: '))||'main';
      options['--command']??=await prompt.question('Verification argv as JSON (for example ["npm","test"]): ');
    } finally {prompt.close();}
  }
  let argv;try {argv=JSON.parse(options['--command']);} catch {throw new DiagnosticError('--command must be a JSON array of argument strings');}
  const config=validateConfig({schemaVersion:1,baseRef:options['--base'],maxOutputBytes:65536,
    commands:[{id:'verify',argv,timeoutMs:Number(options['--timeout-ms']??120000)}]});
  const initial=snapshot(root,config.baseRef);
  writeExclusive(path.join(root,CONFIG_FILE),serializeConfig(config));
  console.log(`Git: ${initial.head} (${initial.branch===null?'detached HEAD':JSON.stringify(initial.branch)}); initially ${initial.dirty?'dirty':'clean'}`);
  console.log('Created .checkbound.json. Review and commit it before running verification.');
  console.log('No verification commands have run. Next: checkbound run');
}
async function verify() {
  only(['--yes']);
  const root=repositoryRoot(process.cwd()),{config,digest}=loadConfig(root);
  console.error('Configured commands (no implicit shell):');
  for(const c of config.commands) console.error(`  ${c.id}: ${JSON.stringify(c.argv)} (timeout ${c.timeoutMs} ms)`);
  console.error('These commands run with your user privileges. This is not a sandbox. Output is stored locally and may contain secrets.');
  if(!flags.includes('--yes')) {
    if(!process.stdin.isTTY) throw new DiagnosticError('Execution requires explicit --yes in noninteractive use');
    const prompt=createInterface({input:process.stdin,output:process.stderr});let answer;
    try {answer=await prompt.question('Run these commands? [y/N] ');} finally {prompt.close();}
    if(!/^y(?:es)?$/i.test(answer.trim())) throw new DiagnosticError('Execution cancelled');
  }
  const controller=new AbortController();let interrupted=null;
  const onInt=()=>{interrupted='SIGINT';controller.abort();},onTerm=()=>{interrupted='SIGTERM';controller.abort();};
  process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
  try {
    const receipt=await runVerification(root,{authorized:true,approvedPolicyDigest:digest,signal:controller.signal});
    printStatus(status(root));console.log(`Evidence: ${JSON.stringify(path.join(stateDirectory(root),'attempts',receipt.attemptId))}`);
    if(interrupted) process.exitCode=interrupted==='SIGINT'?130:143;
  } finally {process.removeListener('SIGINT',onInt);process.removeListener('SIGTERM',onTerm);}
}
try {
  if(command==='init') await initialize();
  else if(command==='run') await verify();
  else if(command==='status') {only(['--json']);printStatus(status(process.cwd()),flags.includes('--json'));}
  else if(command==='--version'&&flags.length===0) console.log(VERSION);
  else if((!command||command==='--help')&&flags.length===0) console.log('CHECKBOUND\n\ncheckbound init [--base REF --command JSON_ARGV --timeout-ms N]\ncheckbound run [--yes]\ncheckbound status [--json]\n\nKnow whether your checks still match your code.');
  else throw new DiagnosticError('Use checkbound init, run, or status. See --help.');
} catch(error) {
  const result={state:'INVALID',reasons:[safeReason(error)]};
  if(command==='status'&&flags.includes('--json')) printStatus(result,true);
  else {console.error(result.reasons[0]);process.exitCode=4;}
}
