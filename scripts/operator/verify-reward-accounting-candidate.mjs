// Offline integrity/module-load check. Does not invoke a service, signer or deployment entrypoint.
import fs from 'node:fs';import path from 'node:path';import{createHash}from'node:crypto';import{createRequire}from'node:module';
const root=path.resolve(import.meta.dirname,'../..'),dir=path.join(root,'docs/reward-accounting-20261027/candidate-final-reviewed'),base=path.join(root,'docs/operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified');
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),check=(v,reason)=>{if(!v)throw Error(reason)};
const review=JSON.parse(fs.readFileSync(dir+'/review.json','utf8')),parent=JSON.parse(fs.readFileSync(base+'/release.json','utf8'));
check(sha(base+'/release.json')===review.baseManifestSHA256,'PARENT_MANIFEST_CHANGED');check(sha(dir+'/worker.mjs')===review.workerSHA256,'WORKER_CHANGED');
for(const f of [...review.schemas,...review.operatorFiles])check(sha(path.join(dir,f.path))===f.sha256,'CANDIDATE_FILE_CHANGED:'+f.path);
for(const f of [...review.inputs,...review.operatorSources])check(sha(path.join(root,f.path))===f.sha256,'SOURCE_CHANGED:'+f.path);
for(const f of parent.files)check(sha(path.join(base,f.path))===f.sha256,'PARENT_FILE_CHANGED:'+f.path);
for(const l of parent.links)check(fs.realpathSync(path.join(base,l.path))===fs.realpathSync(path.join(base,l.target)),'PARENT_LINK_CHANGED');
const require=createRequire(import.meta.url);for(const f of review.operatorFiles)require(path.join(dir,f.path));
const report={at:new Date().toISOString(),passed:true,workerSHA256:review.workerSHA256,reviewSHA256:sha(dir+'/review.json'),baseFilesVerified:parent.files.length,sourceInputsVerified:review.inputs.length,operatorModuleLoadOnly:true,financialEntrypointsInvoked:false,deployed:false};
fs.writeFileSync(path.join(root,'docs/reward-accounting-20261027/candidate-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
