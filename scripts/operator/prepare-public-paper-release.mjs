// Derive a new immutable public-admission artifact from the verified complete canary closure.
import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
import{verifyCurrentRelease}from'./prepare-current-quote-release.mjs';
const root=path.resolve(import.meta.dirname,'../..'),base=path.join(root,'docs/operator-candidate/artifact-releases/current-quotes-paper-20261026-v1'),pin='f48da904bf5cac7e48c563e0ba0c18cb8af535c1545a4ee5f19a321f511cecf1';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),slash=p=>p.replaceAll('\\','/');
const[mode,dest,argPin]=process.argv.slice(2),d=path.resolve(dest??'.');
if(mode==='verify'){const m=verifyCurrentRelease(d,argPin);if(!m.publicPaper)throw Error('NOT_PUBLIC_RELEASE');console.log(JSON.stringify({status:'PASS',files:m.files.length,releaseSHA256:sha(d+'/release.json')}));}
else if(mode==='prepare'){
 if(!d.startsWith(path.join(root,'docs/operator-candidate/artifact-releases')+path.sep)||fs.existsSync(d))throw Error('NEW_RELEASE_ONLY');
 const m=verifyCurrentRelease(base,pin);
 for(const f of m.files){const to=path.join(d,f.path);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(base,f.path),to,fs.constants.COPYFILE_EXCL);}
 for(const l of m.links){const to=path.join(d,l.path);fs.mkdirSync(path.dirname(to),{recursive:true});fs.symlinkSync(path.join(d,l.target),to,'junction');}
 const inputs=[...m.sourceInputs],put=(p,data)=>fs.writeFileSync(path.join(d,p),data),keep=p=>{const rel=slash(path.relative(root,p));inputs.push({path:rel,sha256:sha(p)});};
 const source=path.join(root,'apps/api/isolated/current-quotes/production-public');
 for(const[from,to]of[['api-entry.mjs','api.mjs'],['worker-entry.mjs','worker.mjs'],['policy.mjs','policy.mjs'],['discovery.mjs','discovery.mjs']]){keep(path.join(source,from));put('runtime/'+to,fs.readFileSync(path.join(source,from)));}
 const starter=fs.readFileSync(base+'/operator/start-current-quote-reviewed.ps1','utf8');
 const old="$scope.schema -ne 'PAPERFUND_SCOPED_CURRENT_QUOTES_V1'";
 if(!starter.includes(old))throw Error('STARTER_PREIMAGE');
 const heartbeat='$heartbeatPath=$heartbeatCfg.WORKER_HEARTBEAT_FILE';
 if(starter.split(heartbeat).length!==2)throw Error('HEARTBEAT_DEFAULT_PREIMAGE');
 put('operator/start-current-quote-reviewed.ps1',starter.replace(old,"$scope.schema -ne 'PAPERFUND_PUBLIC_CURRENT_QUOTES_V1'").replace(heartbeat,heartbeat+";if(-not $heartbeatPath){$heartbeatPath='logs/worker-heartbeat.json'}"));
 keep(fileURLToPath(import.meta.url));put('operator/prepare-public-paper-release.mjs',fs.readFileSync(fileURLToPath(import.meta.url)));
 const profile={schema:'PAPERFUND_PUBLIC_CURRENT_QUOTES_V1',approvalReference:'REQUIRES_FINAL_OWNER_PUBLIC_PAPER_ACTIVATION',authorizationId:'paperfund-public-paper-20261026-v1',nonPaying:true,admission:'EXIT_ONLY',rewardHoldFrom:'2026-10-26T00:00:00.000Z',archiveDirectory:path.join(root,'logs/current-quote-evidence'),controlDirectory:path.join(process.env.LOCALAPPDATA,'PaperfundOperator/current-quote-control')};
 put('review/production-profile.exit-only.json',JSON.stringify(profile,null,2)+'\n');
 put('review/production-profile.public-paper.json',JSON.stringify({...profile,admission:'PUBLIC_PAPER'},null,2)+'\n');
 const files=[],links=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name),rel=slash(path.relative(d,p));if(e.isSymbolicLink())links.push({path:rel,target:slash(path.relative(d,fs.realpathSync(p)))});else if(e.isDirectory())walk(p);else if(rel!=='release.json')files.push({path:rel,sha256:sha(p)});}}walk(d);
 const result={...m,createdAt:new Date().toISOString(),destination:d,publicPaper:true,parentReleaseSHA256:pin,defaultBuyAdmission:'DENY_UNLESS_PUBLIC_PROFILE_AND_EXPLICIT_PUBLIC_CONTROL',sourceInputs:inputs,productionDeployed:false,files:files.sort((a,b)=>a.path.localeCompare(b.path)),links:links.sort((a,b)=>a.path.localeCompare(b.path))};
 put('release.json',JSON.stringify(result,null,2)+'\n');verifyCurrentRelease(d,sha(d+'/release.json'));
 console.log(JSON.stringify({status:'PASS',files:files.length,release:d,releaseSHA256:sha(d+'/release.json'),apiSHA256:sha(d+'/runtime/api.mjs'),workerSHA256:sha(d+'/runtime/worker.mjs'),productionDeployed:false}));
}else throw Error('MODE');
