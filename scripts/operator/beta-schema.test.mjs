import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {fixture,fundAndApprove} from '../../packages/db/test/legacy-beta-fixture.ts';
import {inspectBetaHour} from './beta-payout-policy.mjs';
test('staged beta schema preserves strict branch, rejects historical source, retains immutable evidence and STOP',async()=>{
 const f=await fixture();try{await f.db.pool.query(fs.readFileSync('scripts/operator/beta-payout-acceptance.sql','utf8'));
 const old=(await f.db.pool.query("select strict_mainnet_hour_allowed($1) a,mainnet_hour_allowed($1) b",[f.round])).rows[0];assert.equal(old.a,false);assert.equal(old.b,false);
 const p='a'.repeat(64),a='b'.repeat(64),digest=(await f.db.pool.query('select legacy_hour_digest($1) h',[f.round])).rows[0].h;
 await f.db.pool.query('insert into beta_payout_policies values($1,$2,$3,$4,clock_timestamp())',[p,new Date(+f.start+3600000),new Date(+f.end+86400000),{}]);
 await f.db.pool.query("insert into beta_source_acceptances(id,hourly_round_id,profile,network,genesis,structural_hash,acceptance_hash,policy_hash,signed_envelope,expires_at) values('test',$1,'BETA_RECORDED_AUTHORITY_V1','mainnet-beta','5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',$2,$3,$4,'{}',$5)",[f.round,digest,a,p,new Date(+f.end+3600000)]);
 assert.equal((await f.db.pool.query('select mainnet_hour_allowed($1) allowed',[f.round])).rows[0].allowed,false);
 await assert.rejects(f.db.pool.query("delete from beta_source_acceptances where id='test'"));
 const out=await inspectBetaHour(f.db.pool,f.round,{effectiveFrom:new Date(+f.start+3600000).toISOString(),now:+f.end+120000});assert.ok(out.reasons.includes('POLICY_FUTURE_ROUNDS_ONLY'));assert.ok(out.reasons.includes('ROUND_NOT_FINALIZED_AFTER_GRACE'));
 assert.equal((await f.db.pool.query('select stopped from payout_stop_state')).rows[0].stopped,true);
 }finally{await f.cleanup();}
});
