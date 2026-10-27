// Existing artifact/pinned-profile workflow. Preparation only: no startup, SQL, or protected profile update.
import fs from 'node:fs';import path from 'node:path';import{createHash}from'node:crypto';
import{verifyGuardedRelease}from'./prepare-guarded-api-release.mjs';
import{inventory,verifyWebRelease,hash,read,root}from'./verify-web-cold-release.mjs';
const assert=(v,e)=>{if(!v)throw Error(e)};
const put=(f,b)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b,{flag:'wx'})};
const copy=(a,b)=>put(b,fs.readFileSync(a));
const reviewFile='docs/website-redesign/manifest.json',reviewPin='6f8512d874aab9cf2ceb910d44a250f8eedaa5a29f4e831f2d900cb4b3a02523';
const apiRelative='docs/website-redesign/deployment-prep/artifact-releases/api-guarded-restoration-20261023-v2',apiPin='97d2fc67fbcfcd12c0da5308fd139ccb3be50e3b9d1a894ffa46606cacaa6b53';
const destination=path.join(root,'docs/operator-candidate/artifact-releases/website-cold-start-20261024-v1'),out=path.join(root,'docs/website-redesign/cold-start-20261024');
const assertHash=(file,pin)=>assert(hash(file)===pin,'PREIMAGE_CHANGED:'+file);
assertHash(path.join(root,reviewFile),reviewPin);const reviewed=read(path.join(root,reviewFile));for(const f of reviewed.files)assertHash(path.join(root,f.path),f.sha256);
const prep=read(path.join(root,'docs/website-redesign/deployment-prep/installation-preparation.json'));
assertHash(path.join(prep.backupDirectory,'preparation-manifest.json'),prep.protectedBackupManifestSha256);
const backup=read(path.join(prep.backupDirectory,'preparation-manifest.json'));for(const f of backup.files)assertHash(path.join(prep.backupDirectory,f.path),f.sha256);
const finish=process.argv.includes('--finish-profile');
assertHash(path.join(root,apiRelative,'release.json'),apiPin);
const api=finish?read(path.join(root,apiRelative,'release.json')):verifyGuardedRelease(path.join(root,apiRelative),apiPin);
assert(fs.readFileSync(path.join(root,apiRelative,api.entry),'utf8').includes('PAPER_BUY_DISABLED: 403'),'GUARDED_API_403_MISSING');
assertHash(path.join(root,'scripts/operator/launcher.ps1'),'415e8fe0fd510b0950243860aa7cb0384a084ed2f52c4bb2bfd9ec2c395fac40');
assertHash(path.join(root,'scripts/operator/verify-evidence-runtime.mjs'),'e66f9d6667898daea84f357e4121d2ca77d892d59fdee3483b933b7a8e727c80');
const profileFile=path.join(process.env.LOCALAPPDATA,'PaperfundOperator/runtime.json'),before=read(profileFile),profileBefore=hash(profileFile),configFile=before.web.environmentFile;
assert(configFile===before.operator.environmentFile,'EXISTING_OBSERVER_CONFIG_REQUIRED');
const cfg=read(configFile);for(const[k,v]of Object.entries({PRIVATE_BETA_NON_PAYING:'true',BETA_INVITE_ONLY:'true',PAYOUT_EXECUTION_ENABLED:'false',PAYOUT_SIGNER_TYPE:'DISABLED'}))assert(cfg[k]===v,'UNSAFE_WEB_CONFIG:'+k);
const packages=new Set(['runtime/node_modules/pg']);let changed=true;while(changed){changed=false;for(const e of api.dependencyEdges)if(packages.has(e.from)&&!packages.has(e.to)){packages.add(e.to);changed=true;}}
const edges=api.dependencyEdges.filter(e=>packages.has(e.from)),dependencies=api.files.filter(f=>[...packages].some(p=>f.path.startsWith(p+'/')));
assert(dependencies.length>0,'EMPTY_WEB_DEPENDENCIES');
const scripts=reviewed.files.filter(f=>['scripts/serve-web.mjs','scripts/public-reward-evidence.mjs','scripts/public-payment-state.mjs','scripts/operator/treasury.mjs','scripts/operator/common.mjs'].includes(f.path));assert(scripts.length===5,'WEB_SCRIPT_CLOSURE');
const assets=reviewed.files.filter(f=>f.path.startsWith('docs/website-redesign/build/')).map(f=>({source:f.path,path:'web/'+f.path.slice('docs/website-redesign/build/'.length),sha256:f.sha256}));
for(const f of assets)assertHash(path.join(root,'apps/web/dist',f.path.slice(4)),f.sha256);
// Preserve only independently retained previous hashed assets for already-open tabs.
for(const f of backup.files.filter(f=>f.path.startsWith('rollback/web-dist/assets/'))){const rel=f.path.slice('rollback/web-dist/'.length);assertHash(path.join(root,'apps/web/dist',rel),f.sha256);if(!assets.some(a=>a.path==='web/'+rel))assets.push({source:'apps/web/dist/'+rel,path:'web/'+rel,sha256:f.sha256});}
let m,pin;
if(!finish){
assert(!fs.existsSync(destination),'NEW_WEBSITE_ARTIFACT_REQUIRED');
for(const f of scripts)copy(path.join(root,f.path),path.join(destination,'runtime',f.path));
for(const f of assets)copy(path.join(root,f.source),path.join(destination,f.path));
for(const f of dependencies)copy(path.join(root,apiRelative,f.path),path.join(destination,f.path));
copy(path.join(root,reviewFile),path.join(destination,'provenance/website-review.json'));
copy(path.join(root,'scripts/operator/verify-web-cold-release.mjs'),path.join(destination,'provenance/verify-web-cold-release.mjs'));
copy(path.join(root,'scripts/operator/launcher.ps1'),path.join(out,'launcher.before.ps1'));
copy(path.join(root,'scripts/operator/verify-evidence-runtime.mjs'),path.join(out,'verify-evidence-runtime.before.mjs'));
const data=path.join(destination,'runtime/artifacts/operator');fs.mkdirSync(path.dirname(data),{recursive:true});fs.symlinkSync(path.join(root,'artifacts/operator'),data,'junction');
m={schema:'PAPERFUND_WEBSITE_COLD_RELEASE_V1',status:'PREPARED_REQUIRES_OWNER_ACTIVATION',createdAt:new Date().toISOString(),destination,repositoryRoot:root,entry:'runtime/scripts/serve-web.mjs',webRoot:'web',host:'127.0.0.1',port:5173,
 configFile,configSHA256:hash(configFile),node:api.node,apiManifest:apiRelative+'/release.json',apiManifestSHA256:apiPin,apiEntry:apiRelative+'/'+api.entry,apiEntrySHA256:hash(path.join(root,apiRelative,api.entry)),
 provenance:{websiteReview:reviewFile,websiteReviewSHA256:reviewPin,protectedPreparationManifestSHA256:prep.protectedBackupManifestSha256,unchangedCurrentIndexSHA256:hash(path.join(root,'apps/web/dist/index.html')),scripts,assets},
 packages:[...packages].sort(),dependencyEdges:edges,evidenceAccess:'EXACT_EXISTING_OPERATOR_EVIDENCE_DIRECTORY_READ_ONLY_PUBLIC_PROJECTION',financialAuthority:'NONE',...inventory(destination)};
put(path.join(destination,'release.json'),JSON.stringify(m,null,2)+'\n');
}else{assertHash(path.join(out,'launcher.before.ps1'),hash(path.join(root,'scripts/operator/launcher.ps1')));assertHash(path.join(out,'verify-evidence-runtime.before.mjs'),hash(path.join(root,'scripts/operator/verify-evidence-runtime.mjs')));}
pin=hash(path.join(destination,'release.json'));m=verifyWebRelease(destination,pin);
let launcher=fs.readFileSync(path.join(root,'scripts/operator/launcher.ps1'),'utf8');
const patch=(a,b)=>{assert(launcher.split(a).length===2,'LAUNCHER_PATCH_ANCHOR');launcher=launcher.replace(a,b)};
const functions=fs.readFileSync(path.join(out,'web-functions.proposed.ps1'),'utf8').replaceAll('__WEB_MANIFEST_SHA256__',pin).replaceAll('__WEB_VERIFIER_SHA256__',hash(path.join(root,'scripts/operator/verify-web-cold-release.mjs'))).replaceAll('\n','\r\n');
patch('function Get-GuardedWorkerProfile {',functions+'\r\nfunction Get-GuardedWorkerProfile {');
patch('function Confirm-RepositoryWebListener($Connections) {','function Confirm-RepositoryWebListener($Connections) {\r\n $coldProfile=Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA \'PaperfundOperator\\runtime.json\') -Raw|ConvertFrom-Json\r\n if($coldProfile.web.buildManifest -eq \'docs/operator-candidate/artifact-releases/website-cold-start-20261024-v1/release.json\'){Confirm-ColdWebListener $Connections;return}');
patch(" }elseif($Name -in @('fees','operator')){"," }elseif($Name -eq 'web'){\r\n  $coldWeb=Get-ColdWebProfile\r\n  & $coldWeb.Node $coldWeb.Verifier qualify $coldWeb.Release $coldWeb.Pin\r\n  if($LASTEXITCODE -ne 0){throw 'WEB_READ_ONLY_QUALIFICATION_FAILED'}\r\n }elseif($Name -in @('fees','operator')){");
patch("web='scripts\\serve-web.mjs'","web='docs\\operator-candidate\\artifact-releases\\website-cold-start-20261024-v1\\runtime\\scripts\\serve-web.mjs'");
patch("  if($Name -eq 'worker'){\n   foreach($override", "  if($Name -eq 'web'){\n   foreach($override in @{PAPERFUND_WEB_ROOT=(Join-Path $coldWeb.Release 'web');PAPERFUND_WEB_PORT='5173'}.GetEnumerator()){\n    if(-not $saved.ContainsKey($override.Key)){$saved[$override.Key]=[Environment]::GetEnvironmentVariable($override.Key,'Process')}\n    [Environment]::SetEnvironmentVariable($override.Key,$override.Value,'Process')\n   }\n  }\n  if($Name -eq 'worker'){\n   foreach($override");
patch("  if($Name -eq 'worker'){\n   $fresh=$null", "  if($Name -eq 'web'){\n   & $coldWeb.Node $coldWeb.Verifier receipt $coldWeb.Release $coldWeb.Pin $p.Id ($p.StartTime.ToUniversalTime().ToString('o'))\n   if($LASTEXITCODE -ne 0){throw 'WEB_RECEIPT_FAILED_PRESERVE_PROCESS'}\n   Confirm-ColdWebListener @(Listeners 5173)\n  }\n  if($Name -eq 'worker'){\n   $fresh=$null");
put(path.join(out,'launcher.proposed.ps1'),launcher);
const workerManifest='docs/operator-candidate/evidence-runtime-worker-20261024.json',workerPin='e1ee20de4b10bf0571664f9a6a85b0a048bcf1e82ad8a814ccd9c456db94a115';assertHash(path.join(root,workerManifest),workerPin);
const newEvidenceRelative='docs/operator-candidate/evidence-runtime-web-cold-20261024.json';
let verifier=fs.readFileSync(path.join(root,'scripts/operator/verify-evidence-runtime.mjs'),'utf8');
verifier=verifier.replace("const workerRevision=", "const webRevision='"+newEvidenceRelative+"';\nconst workerRevision=")
 .replaceAll('[legacy,revision,workerRevision]','[legacy,revision,workerRevision,webRevision]')
 .replace("if(file===revision||file===workerRevision){","if(file===revision||file===workerRevision||file===webRevision){")
 .replace("if(file===workerRevision){","if(file===workerRevision){")
 .replace('if(m.files.length!==old.files.length)',"if(file===webRevision){const preceding=fs.readFileSync(workerRevision);if(sha(preceding)!=='"+workerPin+"'||m.previousRevisionSHA256!==sha(preceding))throw Error('EVIDENCE_WEB_PREDECESSOR_CHANGED');old=JSON.parse(preceding);}\nif(m.files.length!==old.files.length)");
put(path.join(out,'verify-evidence-runtime.proposed.mjs'),verifier);
const old=read(path.join(root,workerManifest)),next={...old,scope:'WEBSITE_COLD_START_LAUNCHER_ONLY_NO_FINANCIAL_RUNTIME_CHANGE',previousRevisionSHA256:workerPin,files:old.files.map(f=>({...f,sha256:f.path==='scripts/operator/launcher.ps1'?hash(path.join(out,'launcher.proposed.ps1')):f.path==='scripts/operator/verify-evidence-runtime.mjs'?hash(path.join(out,'verify-evidence-runtime.proposed.mjs')):f.sha256}))};
put(path.join(out,'evidence-runtime-web-cold.proposed.json'),JSON.stringify(next,null,2)+'\n');
const nextPin=hash(path.join(out,'evidence-runtime-web-cold.proposed.json')),proposed=structuredClone(before);
proposed.web={...before.web,script:path.relative(root,path.join(destination,m.entry)),sha256:hash(path.join(destination,m.entry)),buildManifest:path.relative(root,path.join(destination,'release.json')).replaceAll('\\','/'),buildManifestSha256:pin};
for(const role of ['fees','operator']){proposed[role].buildManifest=newEvidenceRelative;proposed[role].buildManifestSha256=nextPin;}
const privateStage=path.join(process.env.LOCALAPPDATA,'PaperfundOperator/website-cold-start-20261024');fs.mkdirSync(privateStage,{recursive:true});
const proposedFile=path.join(privateStage,'runtime.proposed.json');put(proposedFile,JSON.stringify(proposed,null,2)+'\n');copy(profileFile,path.join(privateStage,'runtime.before.json'));
const approval={scope:'WEBSITE_COLD_START_PROFILE_AND_LAUNCHER_ONLY',productionActivated:false,release:destination,releaseSHA256:pin,verifierSHA256:hash(path.join(root,'scripts/operator/verify-web-cold-release.mjs')),launcherBeforeSHA256:hash(path.join(root,'scripts/operator/launcher.ps1')),launcherProposedSHA256:hash(path.join(out,'launcher.proposed.ps1')),evidenceVerifierBeforeSHA256:hash(path.join(root,'scripts/operator/verify-evidence-runtime.mjs')),evidenceVerifierProposedSHA256:hash(path.join(out,'verify-evidence-runtime.proposed.mjs')),evidenceRevisionPath:newEvidenceRelative,evidenceRevisionSHA256:nextPin,profileFile,profileBeforeSHA256:profileBefore,profileProposedFile:proposedFile,profileProposedSHA256:hash(proposedFile),apiEntrySHA256:m.apiEntrySHA256,apiManifestSHA256:apiPin,webEntrySHA256:hash(path.join(destination,m.entry)),indexSHA256:hash(path.join(destination,'web/index.html')),files:m.files.length,packages:m.packages.length};
put(path.join(out,'approval.json'),JSON.stringify(approval,null,2)+'\n');console.log(JSON.stringify(approval));
