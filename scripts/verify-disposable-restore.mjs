import {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
const root=new URL('../../evidence/',import.meta.url);
const history=JSON.parse(readFileSync(new URL('upgrade-history.json',root)));
if(!/^legacy_beta_[0-9]+_[a-f0-9]{32}$/.test(history.sourceDatabase))throw Error('Unexpected fixture DB');
const tables=['competition_accounts','positions','fills','orders','market_state_evidence','journal_transactions','ledger_entries','hourly_results','daily_results','daily_result_hourly_results'];
const values=[];
for(const name of [history.sourceDatabase,'legacy_restore_20261018']){
 const p=new Pool({connectionString:'postgresql://beta:disposable-beta-only@127.0.0.1:55462/'+name});
 try{
  const data=Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await p.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text data from ${t} t`)).rows[0].data])));
  values.push({database:name,hash:createHash('sha256').update(JSON.stringify(data)).digest('hex'),migrations:(await p.query('select count(*)::int n from drizzle.__drizzle_migrations')).rows[0].n});
 }finally{await p.end();}
}
if(values.some(v=>v.hash!==history.beforeHash||v.migrations!==18))throw Error('RESTORE_MISMATCH');
const dump=readFileSync(new URL('restore-fixture.dump',root));
mkdirSync(new URL('backup-copy/',root),{recursive:true});copyFileSync(new URL('restore-fixture.dump',root),new URL('backup-copy/restore-fixture.dump',root));
writeFileSync(new URL('restore-verification.json',root),JSON.stringify({scope:'DISPOSABLE_ONLY',values,dumpSha256:createHash('sha256').update(dump).digest('hex'),secondCopy:'Same-host only; off-host protected retention remains a deployment requirement.'},null,2));
