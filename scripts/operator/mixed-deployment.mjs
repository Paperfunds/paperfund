// Reviewed deployment validation only. No process creation, SQL writes, or authorization grants.
import fs from 'node:fs';import path from 'node:path';import{createHash}from'node:crypto';import{createRequire}from'node:module';
export const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function requireCondition(value,reason){if(!value)throw Error('MIXED_DEPLOY_'+reason)}
export function pinned(file,pin){requireCondition(path.isAbsolute(file)&&/^[a-f0-9]{64}$/.test(pin??'')&&sha(file)===pin,'FILE_PIN');return JSON.parse(fs.readFileSync(file,'utf8'))}
export function validatePlan(p,now=Date.now()){
 requireCondition(p?.schema==='PAPERFUND_MIXED_CUTOVER_V1'&&typeof p.approvalReference==='string'&&p.approvalReference.length>0,'APPROVAL');
 requireCondition(Number.isFinite(Date.parse(p.notBefore))&&now>=Date.parse(p.notBefore)&&Number.isFinite(Date.parse(p.expiresAt))&&now<Date.parse(p.expiresAt),'WINDOW');
 requireCondition(p.mode==='EXIT_ONLY'&&p.buyAdmission==='DENY_ALL_BUY','ENTRY_REFUSED');
 for(const f of ['releaseDirectory','scopeFile','runtimeScopeFile','receiptDirectory','baselineHeartbeat'])requireCondition(path.isAbsolute(p[f]??''),'ABSOLUTE_'+f);
 requireCondition(Array.isArray(p.baseline)&&p.baseline.length===2&&p.baseline.some(x=>x.role==='api')&&p.baseline.some(x=>x.role==='worker'),'BASELINE');
 for(const b of p.baseline)requireCondition(Number.isSafeInteger(b.pid)&&b.pid>0&&path.isAbsolute(b.entry)&&Number.isFinite(Date.parse(b.createdAt))&&/^[a-f0-9]{64}$/.test(b.entrySHA256??'')&&/^[a-f0-9]{64}$/.test(b.nodeSHA256??''),'BASELINE_IDENTITY');
 requireCondition(Array.isArray(p.acls)&&p.acls.length>0&&p.acls.every(a=>path.isAbsolute(a.path)&&/^[a-f0-9]{64}$/.test(a.sha256??'')),'ACL_PINS');
 requireCondition(Array.isArray(p.captures)&&p.captures.length>0,'CAPTURES');return p;
}
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
export function assertScopeProjection(template,derived){
 const project=s=>{const x=structuredClone(s);for(const a of x.scopes)a.initialBankSHA256='0'.repeat(64);return stable(x)};
 requireCondition(project(template)===project(derived),'SCOPE_PROJECTION');
 for(const s of derived.scopes)requireCondition(/^[a-f0-9]{64}$/.test(s.initialBankSHA256??''),'DERIVED_BANK_PIN');
}
export function publishJson(file,value){const bytes=JSON.stringify(value,null,2)+'\n',temp=file+'.'+process.pid+'.pending';fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});try{fs.linkSync(temp,file)}catch(e){if(e.code!=='EEXIST'||fs.readFileSync(file,'utf8')!==bytes)throw e}finally{fs.unlinkSync(temp)}}
export function readPreparedScope(plan,template,planPin){
 requireCondition(path.dirname(plan.runtimeScopeFile)===template.controlDirectory,'RUNTIME_SCOPE_DIRECTORY');
 const receipt=JSON.parse(fs.readFileSync(plan.runtimeScopeFile+'.receipt.json','utf8'));
 requireCondition(receipt.schema==='PAPERFUND_PREPARED_SCOPE_V1'&&receipt.planSHA256===planPin&&receipt.templateSHA256===plan.scopeSHA256&&receipt.manifestSHA256===plan.manifestSHA256,'PREPARED_SCOPE_RECEIPT');
 const scope=pinned(plan.runtimeScopeFile,receipt.scopeSHA256);assertScopeProjection(template,scope);return{scope,receipt};
}
export function verifyRelease(directory,pin,{checkConfiguration=true}={}){
 const m=pinned(path.join(directory,'release.json'),pin);
 requireCondition(m.schema==='PAPERFUND_MIXED_OPERATIONAL_RELEASE_V1'&&m.destination===directory&&m.mode==='EXIT_ONLY'&&m.buyAdmission==='DENY_ALL_BUY','RELEASE_CONTRACT');
 requireCondition(m.api==='runtime/api.mjs'&&m.worker==='runtime/worker.mjs'&&m.shared==='runtime/shared-runtime.mjs','ENTRY_CONTRACT');
 const actualFiles=[],actualLinks=[];function visit(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name),rel=path.relative(directory,f).replaceAll('\\','/');if(e.isSymbolicLink()){const target=fs.realpathSync(f);requireCondition(target.startsWith(directory+path.sep),'EXTERNAL_LINK');actualLinks.push({path:rel,target:path.relative(directory,target).replaceAll('\\','/')})}else if(e.isDirectory())visit(f);else if(rel!=='release.json')actualFiles.push({path:rel,sha256:sha(f)})}}visit(directory);
 const sort=a=>a.sort((a,b)=>a.path.localeCompare(b.path));requireCondition(JSON.stringify(sort(actualFiles))===JSON.stringify(m.files)&&JSON.stringify(sort(actualLinks))===JSON.stringify(m.links),'RUNTIME_INTEGRITY');
 for(const e of m.dependencyEdges){const req=createRequire(path.join(directory,e.from,'__verify__.cjs'));let found;for(const dir of req.resolve.paths(e.name)??[]){if(fs.existsSync(path.join(dir,e.name,'package.json'))){found=fs.realpathSync(path.join(dir,e.name));break}}requireCondition(found===fs.realpathSync(path.join(directory,e.to)),'DEPENDENCY_EDGE');}
 requireCondition(process.execPath===m.node.executable&&sha(process.execPath)===m.node.sha256,'NODE_IDENTITY');
 if(checkConfiguration)for(const c of m.configurations)requireCondition(sha(c.file)===c.sha256,'PROTECTED_CONFIG');
 const runtime=fs.readFileSync(path.join(directory,m.shared),'utf8');requireCondition(runtime.includes('authorizePaperBuy: async () => false')&&runtime.includes('mode: "EXIT_ONLY"'),'COMPILED_BUY_CEILING');return m;
}
export function verifyCapture(scope,record,bankFile,now=Date.now(),initialization=true){
 const receipt=pinned(record.file,record.sha256);requireCondition(receipt.schema==='PAPERFUND_NATIVE_CAPTURE_RESULT_V1'&&receipt.prospectiveSimulationOnly===true&&receipt.bankFile===bankFile&&receipt.bankSHA256===sha(bankFile),'CAPTURE_COMMIT');
 const bank=JSON.parse(fs.readFileSync(bankFile));requireCondition(Number.isFinite(Date.parse(bank.observedAt))&&now>=Date.parse(bank.observedAt)&&(!initialization||now-Date.parse(bank.observedAt)<=10000),'STALE_CAPTURE');
 const routes=bank.linkedRoutes??[{mint:bank.mint,quoteMint:bank.quoteMint,targetPool:bank.targetPool,bridgePool:bank.bridgePool}];
 requireCondition(routes.length>0&&receipt.quotes?.length===routes.length&&new Set(routes.map(r=>r.mint)).size===scope.mints.length&&scope.mints.every(m=>routes.some(r=>r.mint===m)),'CAPTURE_SCOPE');
 const key=r=>[r.mint,r.quoteMint,r.targetPool,r.bridgePool].join(':');requireCondition(JSON.stringify(routes.map(key).sort())===JSON.stringify(receipt.quotes.map(q=>key(q.route)).sort()),'CAPTURE_ROUTES');
 requireCondition(receipt.quotes.every(q=>['buy','reverse','partial','fullResidual'].every(k=>BigInt(q[k].quote.output)>0n)),'CAPTURE_EXECUTION');return bank;
}
