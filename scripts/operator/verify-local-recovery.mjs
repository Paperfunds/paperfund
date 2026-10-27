// Local recovery rehearsal only: production reads; no services restarted and no production SQL writes.
import fs from'node:fs';import path from'node:path';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';
const root=path.resolve(import.meta.dirname,'../..'),stamp=new Date().toISOString().replace(/[-:.TZ]/g,''),backup=process.argv[2]?path.resolve(process.argv[2]):path.join(process.env.LOCALAPPDATA,'PaperfundOperator/backups','public-paper-local-'+stamp),container='paperfund-recovery-'+stamp.toLowerCase(),admin='paperfund',source='paperfund-postgres-1';
if(!backup.startsWith(path.join(process.env.LOCALAPPDATA,'PaperfundOperator/backups')+path.sep))throw Error('BACKUP_SCOPE');
if(!process.argv[2])fs.mkdirSync(backup,{recursive:false});
const run=(args,options={})=>{try{return execFileSync('docker',args,{encoding:'utf8',maxBuffer:32*1024*1024,timeout:900000,...options});}catch(e){throw Error('RECOVERY_OPERATION_FAILED:'+args.slice(0,2).join(' ')+':'+(e.code??e.status??'UNKNOWN'));}};
const sql=(c,u,d,q)=>run(['exec',c,'psql','-X','-q','-U',u,'-d',d,'-At','-v','ON_ERROR_STOP=1','-c',q]).trim();
const digest=data=>createHash('sha256').update(data).digest('hex');
const rolesSql="select coalesce(jsonb_agg(to_jsonb(r)-'oid' order by rolname),'[]'::jsonb)::text from pg_authid r where rolname not like 'pg_%' and rolname<>'recovery_admin'";
const membershipsSql="select coalesce(jsonb_agg(jsonb_build_array(r.rolname,m.rolname,g.rolname,a.admin_option,a.inherit_option,a.set_option) order by r.rolname,m.rolname,g.rolname),'[]'::jsonb)::text from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member join pg_roles g on g.oid=a.grantor";
let created=false;
try{
 if(!process.argv[2])execFileSync('pwsh.exe',['-NoProfile','-File',path.join(root,'scripts/db-backup.ps1'),'-OutputDirectory',path.relative(root,backup)],{cwd:root,encoding:'utf8',timeout:300000,maxBuffer:1024*1024});
 const archive=fs.readdirSync(backup).filter(n=>n.endsWith('.dump'));if(archive.length!==1)throw Error('BACKUP_ARCHIVE');
 const globals=process.argv[2]?fs.readFileSync(path.join(backup,'globals.sql')):run(['exec',source,'pg_dumpall','-U','paperfund','--globals-only'],{encoding:null});if(!process.argv[2])fs.writeFileSync(path.join(backup,'globals.sql'),globals);
 if(sql(source,'paperfund','postgres',"select oid from pg_roles where rolname='paperfund'")!=='10')throw Error('BOOTSTRAP_ROLE_IDENTITY');
 const globalsText=globals.toString('utf8');if(globalsText.split('CREATE ROLE paperfund;').length!==2)throw Error('BOOTSTRAP_PREIMAGE');
 fs.writeFileSync(path.join(backup,'globals.restore.sql'),globalsText.replace('CREATE ROLE paperfund;','-- Original bootstrap role already created by initdb, OID 10; ALTER and grants retained.'));
 const operator=path.join(process.env.LOCALAPPDATA,'PaperfundOperator'),runtime=JSON.parse(fs.readFileSync(path.join(operator,'runtime.json')));
 for(const name of['runtime.json','api.json','worker.json','observer.json','fees.json','operator.json']){const p=path.join(operator,name);if(fs.existsSync(p))fs.copyFileSync(p,path.join(backup,name));}
 fs.copyFileSync(path.join(root,'scripts/operator/launcher.ps1'),path.join(backup,'launcher.ps1'));fs.copyFileSync(path.join(root,'START_PAPERFUND_BETA.cmd'),path.join(backup,'START_PAPERFUND_BETA.cmd'));
 const sourceRoles=digest(sql(source,'paperfund','postgres',rolesSql)),sourceMemberships=digest(sql(source,'paperfund','postgres',membershipsSql));
 const image=run(['inspect',source,'--format','{{.Image}}']).trim();
 run(['run','-d','--pull=never','--name',container,'--network','none','--label','paperfund.scope=disposable-local-recovery','-e','POSTGRES_USER='+admin,'-e','POSTGRES_DB=postgres','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);created=true;
 for(let i=0;i<60;i++){try{run(['exec',container,'pg_isready','-U',admin]);break;}catch{if(i===59)throw Error('RECOVERY_NOT_READY');await new Promise(r=>setTimeout(r,500));}}
 run(['cp',path.join(backup,'globals.restore.sql'),container+':/tmp/globals.sql']);run(['exec',container,'psql','-X','-U',admin,'-d','postgres','-v','ON_ERROR_STOP=1','-f','/tmp/globals.sql']);
 run(['cp',path.join(backup,archive[0]),container+':/tmp/recovery.dump']);run(['exec',container,'pg_restore','-U',admin,'--exit-on-error','--create','-d','postgres','/tmp/recovery.dump']);
 const restoredRoles=digest(sql(container,admin,'postgres',rolesSql)),restoredMemberships=digest(sql(container,admin,'postgres',membershipsSql));
 if(sourceRoles!==restoredRoles||sourceMemberships!==restoredMemberships)throw Error('ROLE_RESTORE_MISMATCH');
 if(sourceRoles!==digest(sql(source,'paperfund','postgres',rolesSql))||sourceMemberships!==digest(sql(source,'paperfund','postgres',membershipsSql)))throw Error('SOURCE_ROLES_CHANGED_DURING_REHEARSAL');
 const checks=JSON.parse(sql(container,admin,'paperfund',"select json_build_object('publicTables',(select count(*) from pg_tables where schemaname='public'),'fills',(select count(*) from fills),'orders',(select count(*) from orders),'migrations',(select count(*) from drizzle.__drizzle_migrations),'unvalidatedConstraints',(select count(*) from pg_constraint where not convalidated),'unbalancedJournals',(select count(*) from(select journal_transaction_id from ledger_entries group by journal_transaction_id having sum(case when direction='DEBIT' then amount_lamports else -amount_lamports end)<>0)t),'stopAsserted',(select stopped from payout_stop_state where singleton=true))"));
 if(checks.publicTables<1||checks.unvalidatedConstraints!==0||checks.unbalancedJournals!==0||checks.stopAsserted!==true)throw Error('RESTORED_FINANCIAL_SAFETY');
 const workerCfg=JSON.parse(fs.readFileSync(runtime.worker.environmentFile)),apiCfg=JSON.parse(fs.readFileSync(runtime.api.environmentFile));
 const roles=[['api',new URL(apiCfg.DATABASE_URL).username],['worker',new URL(workerCfg.DATABASE_URL).username]];
 const grants={};for(const[label,role]of roles){const q="select json_build_object('privileged',(select rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls from pg_roles where rolname=current_user),'stopWritable',has_table_privilege(current_user,'payout_stop_state','INSERT,UPDATE,DELETE,TRUNCATE'),'payoutWritable',has_table_privilege(current_user,'payout_signed_transactions','INSERT,UPDATE,DELETE,TRUNCATE'),'fillsReadable',has_table_privilege(current_user,'fills','SELECT'))";const a=sql(source,role,'paperfund',q),b=sql(container,role,'paperfund',q);if(a!==b)throw Error('ROLE_GRANT_MISMATCH:'+label);grants[label]=JSON.parse(b);if(grants[label].privileged||grants[label].stopWritable||grants[label].payoutWritable||!grants[label].fillsReadable)throw Error('ROLE_SAFETY:'+label);}
 const files=fs.readdirSync(backup).map(name=>({name,bytes:fs.statSync(path.join(backup,name)).size,sha256:digest(fs.readFileSync(path.join(backup,name)))}));
 const report={status:'PASS',createdAt:new Date().toISOString(),backupDirectory:backup,restoreImage:image,productionMutated:false,isolatedNetwork:'none',publishedPorts:[],rolesRestored:true,ownersAndPrivilegesRestored:true,roleMetadataMatch:true,membershipsMatch:true,checks,grants,files,offHostCopy:false,encryption:false,riskException:'OWNER_ACCEPTED_LOCAL_ONLY_FOR_NONPAYING_PUBLIC_PAPER_RELEASE',limitations:['No protection against host/disk loss or compromise','Redis sessions/caches are not restored; users must authenticate again','No signer/private-key store copied or restored','Production continues after snapshot; refresh if later changes invalidate cutover recovery point','Not a qualification of real-SOL rewards or original-fill financial replay']};
 fs.writeFileSync(path.join(backup,'RECOVERY_VERIFICATION.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(backup,'SHA256SUMS.txt'),files.map(f=>f.sha256+'  '+f.name).join('\n')+'\n');
 console.log(JSON.stringify(report));
}finally{if(created)run(['rm','-f','-v',container]);}
