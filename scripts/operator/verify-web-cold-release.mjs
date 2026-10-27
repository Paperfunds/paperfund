// Website artifact verification and read-only qualification. Never starts a service or changes a profile.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(import.meta.dirname,'../..');
export const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
export const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const assert=(v,e)=>{if(!v)throw Error(e)};
const inside=(a,b)=>b.startsWith(a+path.sep);
export function inventory(directory){
 const files=[],links=[];
 function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const f=path.join(d,e.name),p=path.relative(directory,f).replaceAll('\\','/');
  if(e.isSymbolicLink())links.push({path:p,target:fs.realpathSync(f)});
  else if(e.isDirectory())walk(f);else if(p!=='release.json')files.push({path:p,sha256:hash(f)});
 }}walk(directory);return{files,links};
}
export function verifyWebRelease(directory,pin){
 directory=path.resolve(directory);assert(/^[a-f0-9]{64}$/.test(pin??'')&&hash(path.join(directory,'release.json'))===pin,'WEB_MANIFEST_CHANGED');
 const m=read(path.join(directory,'release.json'));
 assert(m.schema==='PAPERFUND_WEBSITE_COLD_RELEASE_V1'&&m.destination===directory&&m.repositoryRoot===root,'WEB_RELEASE_IDENTITY');
 assert(JSON.stringify(inventory(directory))===JSON.stringify({files:m.files,links:m.links}),'WEB_ARTIFACT_CHANGED');
 assert(m.links.length===1&&m.links[0].path==='runtime/artifacts/operator'&&m.links[0].target===fs.realpathSync(path.join(root,'artifacts/operator')),'WEB_EVIDENCE_LINK_CHANGED');
 assert(hash(m.configFile)===m.configSHA256,'WEB_PROTECTED_CONFIG_CHANGED');
 assert(process.execPath===m.node.executable&&hash(process.execPath)===m.node.sha256,'WEB_NODE_CHANGED');
 assert(m.host==='127.0.0.1'&&m.port===5173&&m.entry==='runtime/scripts/serve-web.mjs'&&m.webRoot==='web','WEB_SCOPE_CHANGED');
 assert(hash(path.join(root,m.apiManifest))===m.apiManifestSHA256&&hash(path.join(root,m.apiEntry))===m.apiEntrySHA256,'GUARDED_API_IDENTITY_CHANGED');
 const api=read(path.join(root,m.apiManifest));assert(api.defaultBuyAdmission==='DENY_ALL_BUY'&&api.installedEntryAuthorizer===false&&api.mixedBootstrapInstalled===false,'GUARDED_API_SCOPE_CHANGED');
 const code=fs.readFileSync(path.join(root,m.apiEntry),'utf8');assert(code.includes('PAPER_BUY_DISABLED')&&code.includes('PAPER_BUY_DISABLED: 403'),'GUARDED_API_403_MISSING');
 for(const e of m.dependencyEdges){const from=path.join(directory,e.from),req=createRequire(path.join(from,'__web_resolution__.cjs'));let actual;
  for(const base of req.resolve.paths(e.name)??[]){const p=path.join(base,e.name,'package.json');if(fs.existsSync(p)){actual=fs.realpathSync(path.dirname(p));break;}}
  assert(actual===fs.realpathSync(path.join(directory,e.to))&&inside(directory,actual),'WEB_DEPENDENCY_CHANGED:'+e.name);
 }
 const req=createRequire(path.join(directory,m.entry));assert(inside(directory,fs.realpathSync(req.resolve('pg'))),'WEB_HOST_DEPENDENCY_REFUSED');
 const cfg=read(m.configFile);for(const[k,v]of Object.entries({PRIVATE_BETA_NON_PAYING:'true',BETA_INVITE_ONLY:'true',PAYOUT_EXECUTION_ENABLED:'false',PAYOUT_SIGNER_TYPE:'DISABLED'}))assert(cfg[k]===v,'WEB_UNSAFE_CONFIG:'+k);
 return m;
}
export async function qualifyWebRelease(directory,pin){
 const m=verifyWebRelease(directory,pin),req=createRequire(path.join(directory,m.entry)),pg=req('pg'),cfg=read(m.configFile);
 const pool=new pg.Pool({connectionString:cfg.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:5000,options:'-c default_transaction_read_only=on'});
 try{const c=await pool.connect();try{await c.query('begin read only');
  const r=(await c.query('select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user')).rows[0];assert(r&&Object.values(r).every(v=>v===false),'WEB_OBSERVER_ROLE_UNSAFE');
  const tables=['payout_stop_state','payout_plans','payout_batches','payout_batch_allocations','payout_signed_transactions','payout_plan_approvals','competition_accounts','orders','fills','positions','journal_transactions','ledger_entries','hourly_rounds','daily_competitions'];
  const rows=(await c.query("select t,has_table_privilege(current_user,t,'INSERT,UPDATE,DELETE,TRUNCATE') writable from unnest($1::text[]) t",[tables])).rows;assert(rows.every(r=>r.writable===false),'WEB_OBSERVER_FINANCIAL_DML');
  assert((await c.query('select stopped from payout_stop_state where singleton=true')).rows[0]?.stopped===true,'FINANCIAL_STOP_REQUIRED');
  await c.query('rollback');return{status:'PASS',financialStop:true,financialDmlDenied:true,productionMutated:false};
 }finally{c.release()}}finally{await pool.end()}
}
// A receipt is identity evidence only, never permission to start or trade.
export function receipt(directory,pin,pid,startedAt){
 const m=verifyWebRelease(directory,pin),folder=path.join(process.env.LOCALAPPDATA,'PaperfundOperator/website-artifact-services');
 assert(Number.isSafeInteger(pid)&&pid>0&&Number.isFinite(Date.parse(startedAt)),'WEB_PID');fs.mkdirSync(folder,{recursive:true});
 const value={schema:'PAPERFUND_WEB_COLD_RECEIPT_V1',pid,startedAt,recordedAt:new Date().toISOString(),entry:path.join(directory,m.entry),entrySHA256:hash(path.join(directory,m.entry)),manifestSHA256:pin,configSHA256:m.configSHA256,indexSHA256:hash(path.join(directory,m.webRoot,'index.html')),host:m.host,port:m.port};
 const file=path.join(folder,'web-cold-'+pid+'-'+randomUUID()+'.json');fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});return value;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[mode,dir,pin,pid,startedAt]=process.argv.slice(2);assert(['verify','qualify','receipt'].includes(mode),'WEB_READ_ONLY_MODE_REQUIRED');
 const result=mode==='qualify'?await qualifyWebRelease(dir,pin):mode==='receipt'?receipt(dir,pin,Number(pid),startedAt):(()=>{const m=verifyWebRelease(dir,pin);return{status:'PASS',files:m.files.length,packages:m.packages.length,manifestSHA256:pin,productionStarted:false}})();console.log(JSON.stringify(result));
}
