import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {derivePublic} from './key-public.mjs';
const installation=path.join(process.env.ProgramFiles,'PaperfundSigner');
const results=path.join(process.env.ProgramData,'PaperfundSignerAcceptance');
const setup=JSON.parse(fs.readFileSync(path.join(results,'setup.public.json'),'utf8').replace(/^\uFEFF/,''));
const old=JSON.parse(fs.readFileSync(setup.proofFile,'utf8').replace(/^\uFEFF/,''));
let previousDisposableRecovery='UNTESTED';
try{
 let recovered=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',path.join(installation,'disposable-dpapi.ps1'),'-Mode','Restore','-Record',old.encryptedBackup],{input:'',encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 previousDisposableRecovery=derivePublic(recovered)===old.publicAddress?'PASS':'PUBLIC_ADDRESS_MISMATCH';recovered='';
}catch{previousDisposableRecovery='FAILED_AFTER_ADMIN_PASSWORD_RESET';}
let fresh;
try{
 fresh=JSON.parse(execFileSync(process.execPath,[path.join(installation,'disposable-signing-proof.mjs')],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}));
}catch{
 fs.writeFileSync(path.join(results,'desktop-session.public.json'),JSON.stringify({at:new Date().toISOString(),passed:false,previousDisposableRecovery,error:'FRESH_DISPOSABLE_PROOF_FAILED'},null,2));
 console.error('FRESH_DISPOSABLE_PROOF_FAILED');process.exit(1);
}
const result={at:new Date().toISOString(),passed:true,previousDisposableRecovery,freshOfflineProof:fresh,credentialSaved:false,passwordResetPerformed:false,policyChanged:false,financialAuthority:'NONE'};
fs.writeFileSync(path.join(results,Date.now()+'.desktop-session.public.json'),JSON.stringify(result,null,2));
fs.writeFileSync(path.join(results,'desktop-session.public.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:true,previousDisposableRecovery,newDisposableSigning:fresh.passed,signerSid:fresh.signerSid,restorationScope:fresh.restorationScope,broadcast:false},null,2));
