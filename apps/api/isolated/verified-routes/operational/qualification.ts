/** Versioned qualification: exact old 945 requirements plus one reviewed function change and candidate objects. */
import {readFile}from'node:fs/promises';import type{DatabaseService}from'../../../../../packages/db/src/database.js';
export async function qualifySuccessor(database:DatabaseService,role:'api'|'worker',file:URL|string=new URL('./worker-qualification.json',import.meta.url)) {
 const q=JSON.parse(await readFile(file,'utf8'));
 if(q.schema!=='PAPERFUND_MIXED_WORKER_QUALIFICATION_V1'||q.predecessorSHA256!=='d833b4b6db9bbde9b4b5ddedd3d61bc4422494bb5cedc1ba2a8d8ffa449c0df8')throw Error('MIXED_QUALIFICATION_PREDECESSOR');
 const c=await database.pool.connect();let checked=0;
 try{await c.query('begin isolation level repeatable read read only');
 const member=role==='api'?'paperfund_beta_api':'paperfund_beta_worker';
 const r=(await c.query('select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,pg_has_role(current_user,$1,\'member\') member,pg_has_role(current_user,\'paperfund_beta_api\',\'member\') api_member,pg_has_role(current_user,\'paperfund_beta_worker\',\'member\') worker_member from pg_roles where rolname=current_user',[member])).rows[0];
 if(!r.member||(role==='api'?r.worker_member:r.api_member)||['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'].some(k=>r[k]))throw Error('MIXED_RUNTIME_ROLE');
 for(const [kind,sql]of Object.entries(q.queries) as [string,string][]){const actual=new Map((await c.query(sql)).rows.map(r=>[r.key,r.value.replaceAll('\r\n','\n')]));if(kind.startsWith('linked_')&&actual.size!==q.expected[kind].length)throw Error('MIXED_UNREVIEWED_SCHEMA_OBJECT:'+kind);for(const row of q.expected[kind]){if(actual.get(row.key)!==row.value)throw Error('MIXED_SCHEMA_MISMATCH:'+kind+':'+row.key);checked++;}}
 for(const t of ['branches','provider_evidence','receipts','cutoff_seals','settlement_steps','route_quarantine','route_status']){
  const row=(await c.query("select (has_table_privilege(current_user,$1,'SELECT') and has_table_privilege(current_user,$1,'INSERT')) allowed,has_table_privilege(current_user,$1,'DELETE,TRUNCATE') forbidden",['linked_candidate.'+t])).rows[0];
  if(!row.allowed||row.forbidden)throw Error('MIXED_RUNTIME_GRANTS:'+t);
 }
 for(const [table,columns]of [['branches',['revision','document','state_hash']],['route_status',['quarantined']]] as const){for(const col of columns)if(!(await c.query("select has_column_privilege(current_user,$1,$2,'UPDATE') allowed",['linked_candidate.'+table,col])).rows[0].allowed)throw Error('MIXED_UPDATE_GRANTS');}
 const schema=(await c.query("select has_schema_privilege(current_user,'linked_candidate','USAGE') allowed,has_schema_privilege(current_user,'linked_candidate','CREATE') forbidden")).rows[0];if(!schema.allowed||schema.forbidden)throw Error('MIXED_SCHEMA_ROLE_PRIVILEGE');
 const updates=(await c.query("select t.relname,a.attname from pg_class t join pg_namespace n on n.oid=t.relnamespace join pg_attribute a on a.attrelid=t.oid where n.nspname='linked_candidate' and t.relkind='r' and a.attnum>0 and not a.attisdropped and has_column_privilege(current_user,t.oid,a.attnum,'UPDATE')")).rows;
 for(const u of updates)if(!(u.relname==='branches'&&['revision','document','state_hash'].includes(u.attname))&&!(u.relname==='route_status'&&u.attname==='quarantined'))throw Error('MIXED_UNREVIEWED_COLUMN_UPDATE');
 const disabled=(await c.query("select t.tgname from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname in ('public','linked_candidate') and not t.tgisinternal and t.tgenabled<>'O' limit 1")).rows;if(disabled.length)throw Error('MIXED_DISABLED_INTEGRITY_TRIGGER');
 for(const t of ['payout_plans','payout_batches','payout_batch_allocations','payout_signed_transactions','payout_plan_approvals','payout_stop_state'])if((await c.query("select has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE') writable",[t])).rows[0].writable)throw Error('MIXED_PAYOUT_PRIVILEGE');
 if(!(await c.query("select has_function_privilege(current_user,'linked_candidate.assert_forced_fill(text)','EXECUTE') allowed")).rows[0].allowed)throw Error('MIXED_PROOF_FUNCTION_GRANT');
 await c.query('rollback');return{qualified:true,checked,role,payouts:false};
 }finally{await c.query('rollback').catch(()=>{});c.release();}
}
