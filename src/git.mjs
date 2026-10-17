import { DiagnosticError } from './common.mjs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SHA, commandEnvironment } from './common.mjs';

export function git(cwd,args) {
  return execFileSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.untrackedCache=false',...args],{
    cwd,encoding:'utf8',maxBuffer:16777216,stdio:['ignore','pipe','pipe'],
    env:{...commandEnvironment(),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'},
  }).trim();
}
export const repositoryRoot = cwd => git(cwd,['rev-parse','--show-toplevel']);
export function resolveCommit(root,ref) {
  const sha=git(root,['rev-parse','--verify','--end-of-options',`${ref}^{commit}`]);
  if(!SHA.test(sha)) throw new DiagnosticError('Expected a full commit id');
  return sha;
}
function assertSupportedIndex(root) {
  let filters='';
  try {filters=git(root,['config','--null','--get-regexp','^filter\\..*\\.(clean|process)$']);} catch(e) {if(e.status!==1) throw e;}
  if(filters) throw new DiagnosticError('Executable Git clean/process filters are not supported');
  const flags=git(root,['ls-files','-v','-z']).split('\0');
  if(flags.some(f=>/^[a-zS]/.test(f))) throw new DiagnosticError('assume-unchanged and skip-worktree entries are not supported; restore normal index flags');
  const entries=git(root,['ls-files','--stage','-z']).split('\0');
  if(entries.some(f=>f.startsWith('160000 '))) throw new DiagnosticError('Submodules are not supported');
}

export function snapshot(cwd,baseRef) {
  const root=repositoryRoot(cwd), head=resolveCommit(root,'HEAD'),base=resolveCommit(root,baseRef);
  assertSupportedIndex(root);
  let branch=null; try {branch=git(root,['symbolic-ref','--quiet','--short','HEAD']);} catch(e) {if(e.status!==1) throw e;}
  return {root,head,base,tree:git(root,['rev-parse','HEAD^{tree}']),branch,
    dirty:git(root,['status','--porcelain=v1','-z','--untracked-files=all']).length>0};
}
export function assertCommittedConfig(root) {
  const entry=git(root,['ls-tree','HEAD','--','.checkbound.json']);
  if(!/^100(?:644|755) blob [a-f0-9]+\t\.checkbound\.json$/.test(entry)) throw new DiagnosticError('Commit .checkbound.json before verification');
}
export const stateDirectory = root => path.resolve(root,git(root,['rev-parse','--git-path','checkbound-v0']));
