import { loadConfig } from './config.mjs';
import { repositoryRoot,snapshot,assertCommittedConfig } from './git.mjs';
import { readLatest } from './store.mjs';
import { VERSION,canonical,executionContext,safeReason,DiagnosticError } from './common.mjs';

export const EXIT_CODES={CURRENT:0,FAILED:1,STALE:2,MISSING:3,INVALID:4};
export function status(cwd) {
  try {
    const root=repositoryRoot(cwd),{config,digest}=loadConfig(root),current=snapshot(root,config.baseRef);
    assertCommittedConfig(root);
    const receipt=readLatest(root);
    if(!receipt) return {state:'MISSING',reasons:['No verification attempts recorded']};
    const reasons=[];
    if(current.dirty) reasons.push('Working tree is dirty');
    if(!receipt.stateUnchanged) reasons.push('Git state or policy changed during verification');
    for(const key of ['head','base','tree','branch']) if(receipt.subject[key]!==current[key]) reasons.push(`${key==='head'?'HEAD':key} changed`);
    if(receipt.policyDigest!==digest) reasons.push('Verification policy changed');
    if(receipt.toolVersion!==VERSION) reasons.push('Tool version changed');
    if(canonical(receipt.context)!==canonical(executionContext())) reasons.push('Execution context changed');
    // Only compare command semantics against this policy once its digest matches.
    if(receipt.policyDigest===digest) {
      if(receipt.commands.length!==config.commands.length||receipt.commands.some((c,i)=>{
        const expected=config.commands[i];
        return c.id!==expected.id||canonical(c.argv)!==canonical(expected.argv)||c.timeoutMs!==expected.timeoutMs||c.log.capturedBytes>config.maxOutputBytes;
      })) throw new DiagnosticError('Receipt commands do not match their policy');
    }
    // Detect observable changes while assembling status; this is still a local snapshot, not a merge lock.
    const end=snapshot(root,config.baseRef);
    if(canonical(end)!==canonical(current)||loadConfig(root).digest!==digest||readLatest(root)?.attemptId!==receipt.attemptId) {
      throw new DiagnosticError('Repository or evidence changed while reading status');
    }
    const detail={attemptId:receipt.attemptId,head:current.head,base:current.base,policyDigest:digest,
      commands:receipt.commands.map(c=>({id:c.id,outcome:c.outcome}))};
    if(reasons.length) return {state:'STALE',reasons,...detail};
    const failed=receipt.commands.filter(c=>c.outcome!=='passed');
    return {state:failed.length?'FAILED':'CURRENT',reasons:failed.length?failed.map(c=>`${c.id}: ${c.outcome}`):['All configured commands passed for this Git state'],...detail};
  } catch(error) {
    return {state:'INVALID',reasons:[safeReason(error)]};
  }
}
