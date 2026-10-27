import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';
const webRevision='docs/operator-candidate/evidence-runtime-web-cold-20261024.json';
const workerRevision='docs/operator-candidate/evidence-runtime-worker-20261024.json';
const root=process.cwd(),legacy='docs/operator-candidate/evidence-runtime.json',revision='docs/operator-candidate/evidence-runtime-guarded-20261024.json',legacyPin='5416da4a95d02bff914a9c9189e81bdd8b09265ae74fdb8d6a342e937b3f1c4f',file=process.argv[2],pin=process.argv[3],sha=b=>createHash('sha256').update(b).digest('hex');
try{
 if(![legacy,revision,workerRevision,webRevision].includes(file)||! /^[a-f0-9]{64}$/i.test(pin??''))throw Error('EVIDENCE_RUNTIME_PROFILE_REQUIRED');
 const raw=fs.readFileSync(file);if(sha(raw)!==pin.toLowerCase())throw Error('EVIDENCE_RUNTIME_MANIFEST_CHANGED');const m=JSON.parse(raw);
 if(m.schema!=='paperfund-reviewed-evidence-runtime-v1'||!m.files.length)throw Error('EVIDENCE_RUNTIME_MANIFEST_INVALID');
 if(file===revision||file===workerRevision||file===webRevision){
  const oldRaw=fs.readFileSync(legacy);if(sha(oldRaw)!==legacyPin||m.predecessorSHA256!==legacyPin)throw Error('EVIDENCE_PREDECESSOR_CHANGED');
  let old=JSON.parse(oldRaw);
  if(file===workerRevision){const preceding=fs.readFileSync(revision);if(sha(preceding)!=='d027f4912b744bd84f4c2df1c7ce60d594775ffce340e85f7c9aa318295199ec'||m.previousRevisionSHA256!==sha(preceding))throw Error('EVIDENCE_PREVIOUS_REVISION_CHANGED');old=JSON.parse(preceding);}
if(file===webRevision){const preceding=fs.readFileSync(workerRevision);if(sha(preceding)!=='e1ee20de4b10bf0571664f9a6a85b0a048bcf1e82ad8a814ccd9c456db94a115'||m.previousRevisionSHA256!==sha(preceding))throw Error('EVIDENCE_WEB_PREDECESSOR_CHANGED');old=JSON.parse(preceding);}
if(m.files.length!==old.files.length)throw Error('EVIDENCE_REVISION_SCOPE_CHANGED');
  for(let i=0;i<old.files.length;i++){if(m.files[i].path!==old.files[i].path)throw Error('EVIDENCE_REVISION_PATH_CHANGED');if(!['scripts/operator/launcher.ps1','scripts/operator/verify-evidence-runtime.mjs'].includes(old.files[i].path)&&m.files[i].sha256!==old.files[i].sha256)throw Error('EVIDENCE_UNREVIEWED_RUNTIME_DELTA');}
 }
 for(const f of m.files){
  if(!/^(scripts\/operator\/[a-zA-Z0-9_.-]+|packages\/[^/]+\/(dist\/[^\\]+|package.json)|package-lock.json)$/.test(f.path)||f.path.includes('..'))throw Error('EVIDENCE_RUNTIME_PATH_INVALID');
  const full=path.resolve(root,f.path);if(!fs.realpathSync(full).startsWith(fs.realpathSync(root)+path.sep)||sha(fs.readFileSync(full))!==f.sha256)throw Error('EVIDENCE_REVIEWED_RUNTIME_CHANGED:'+f.path);
 }
 console.log(JSON.stringify({verified:true,files:m.files.length,authority:'NONE',buildPerformed:false,financialStateChanged:false,revision:file!==legacy}));
}catch(e){console.error(e.message);process.exitCode=1;}
