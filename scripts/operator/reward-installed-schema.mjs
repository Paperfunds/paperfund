// Catalog-only reconciliation of the already committed four-script installation.
import {createHash} from 'node:crypto';
export async function installedSchema(p,run){
 const rows=await run(p,`begin read only;
 select json_build_object(
 'functions',(select coalesce(json_agg(json_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text),'[]'::json) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'current_quote_%' or p.proname like 'stamp_current_quote_%' or p.proname like 'legacy_hour_digest%' or p.proname in ('certify_current_quote_capture','verify_legacy_forced_fill','reject_payout_detail_change'))),
 'tables',(select coalesce(json_agg(json_build_object('name',c.relname,'rls',c.relrowsecurity,
 'columns',(select json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'identity',a.attidentity,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(json_agg(json_build_object('name',conname,'definition',pg_get_constraintdef(oid),'valid',convalidated) order by conname),'[]'::json) from pg_constraint where conrelid=c.oid),
 'triggers',(select coalesce(json_agg(pg_get_triggerdef(oid) order by tgname),'[]'::json) from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname),'[]'::json) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and (c.relname like 'current_quote_%' or c.relname='payout_creator_distribution_evidence')),
 'grants',(select coalesce(json_agg(json_build_object('role',r,'table',c.relname,'select',has_table_privilege(r,c.oid,'SELECT'),'insert',has_table_privilege(r,c.oid,'INSERT'),'update',has_table_privilege(r,c.oid,'UPDATE'),'delete',has_table_privilege(r,c.oid,'DELETE'),'truncate',has_table_privilege(r,c.oid,'TRUNCATE'),'update_id',case when c.relname='current_quote_cutoff_seals' then has_column_privilege(r,c.oid,'id','UPDATE') else false end) order by r,c.relname),'[]'::json) from unnest(array['paperfund_beta_api','paperfund_beta_worker','paperfund_beta_observer','paperfund_mainnet_signer','paperfund_mainnet_acceptance_publisher']) r cross join pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and (c.relname like 'current_quote_%' or c.relname='payout_creator_distribution_evidence' or c.relname='payout_stop_state')),
 'certifier',(select json_agg(json_build_object('role',r,'execute',has_function_privilege(r,'certify_current_quote_capture(text)','EXECUTE')) order by r) from unnest(array['paperfund_beta_api','paperfund_beta_worker','paperfund_beta_observer','paperfund_mainnet_signer','paperfund_mainnet_acceptance_publisher']) r),
 'sequence',(select json_build_object('usage',has_sequence_privilege('paperfund_beta_worker','current_quote_capture_faults_id_seq','USAGE'),'select',has_sequence_privilege('paperfund_beta_worker','current_quote_capture_faults_id_seq','SELECT')))
 ) value;rollback;`);
 const document=rows[0].value;
 return{document,sha256:createHash('sha256').update(JSON.stringify(document)).digest('hex')};
}
