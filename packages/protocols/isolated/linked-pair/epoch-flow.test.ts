// Real retained pool mechanics with explicitly CONTROLLED epoch metadata/schedules.
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import bs58 from 'bs58';
import { CLOCK_ACCOUNT } from './epoch-flow.js';
import { newLinkedBranch, reconcileLinkedInterval, digest, type ProviderInterval } from './external-flow.js';
import { feePolicies } from './token-2022-flow.js';
import { transitionLinkedSnapshot } from './native-transition.js';
const owner='Sysvar1111111111111111111111111111111111111';
const retained=JSON.parse(gunzipSync(readFileSync('docs/linked-pair-20261021/external-flow-completion/provider-459758217-459758224.json.gz')).toString()) as ProviderInterval;
function fixture() {
  const p=structuredClone(retained), length=8;
  for(const s of [p.before,p.after]){const b=Buffer.from(s.accounts[CLOCK_ACCOUNT]!.base64,'base64'),epoch=Math.floor(s.slot/length);
    b.writeBigUInt64LE(BigInt(epoch),16);b.writeBigUInt64LE(BigInt(epoch+1),24);
    const seconds=Number(b.readBigInt64LE(32));s.observedAt=new Date(seconds*1000).toISOString();
    b.writeBigInt64LE(BigInt(s===p.before?seconds-10:seconds),8);
    s.accounts[CLOCK_ACCOUNT]!.base64=b.toString('base64');}
  const schedule=Buffer.alloc(33);schedule.writeBigUInt64LE(8n,0);schedule.writeBigUInt64LE(8n,8);
  p.epochWitness={schema:'FINALIZED_EPOCH_SCHEDULE_V1',contextSlot:p.after.slot,clock:structuredClone(p.after.accounts[CLOCK_ACCOUNT]!),schedule:{owner,base64:schedule.toString('base64')}};
  return p;
}
const run=(p:ProviderInterval,b=newLinkedBranch('controlled-epoch','controlled-epoch',p.before))=>reconcileLinkedInterval(b,p,Date.parse(p.after.observedAt),10000);
it('progresses controlled normal epoch metadata through genuine pool effects and survives duplicate/restart replay',async()=>{
  const p=fixture(),r=await run(p);expect(r.branch.real).toEqual(p.after);expect(r.branch.simulated.accounts).toEqual(p.after.accounts);
  const restore=JSON.parse(JSON.stringify(r.branch));expect((await run(p,restore)).replay).toBe(true);expect(digest((await run(p,restore)).branch)).toBe(digest(r.branch));
});
it('preserves controlled prior PAPER impact across the epoch and prices partial/full exits without ledger mutations',async()=>{
  const p=fixture(),branch=newLinkedBranch('paper-epoch','paper-epoch',p.before),policy={nowMs:Date.parse(p.before.observedAt),maxAgeMs:10000};
  const buy=await transitionLinkedSnapshot(p.before,10000000n,true,policy);branch.simulated=buy.next;
  const r=await run(p,branch);expect(r.branch.real).toEqual(p.after);expect(digest(r.branch.simulated)).not.toBe(digest(p.after));
  const exitPolicy={nowMs:Date.parse(p.after.observedAt),maxAgeMs:10000},partial=await transitionLinkedSnapshot(r.branch.simulated,buy.quote.output/4n,false,exitPolicy),full=await transitionLinkedSnapshot(partial.next,buy.quote.output-buy.quote.output/4n,false,exitPolicy);
  expect(partial.quote.output).toBeGreaterThan(0n);expect(full.quote.output).toBeGreaterThan(0n);
});
it.each(['missing-witness','bad-context','bad-owner','bad-schedule','bad-epoch','bad-start','missing-boundary','regression'])('fails closed for controlled %s',async variant=>{
  const p=fixture();
  if(variant==='missing-witness')delete p.epochWitness;
  if(variant==='bad-context')p.epochWitness!.contextSlot++;
  if(variant==='bad-owner')p.epochWitness!.schedule.owner='11111111111111111111111111111111';
  if(variant==='bad-schedule'){const b=Buffer.from(p.epochWitness!.schedule.base64,'base64');b.writeBigUInt64LE(7n);p.epochWitness!.schedule.base64=b.toString('base64')}
  if(variant==='bad-epoch'){const b=Buffer.from(p.after.accounts[CLOCK_ACCOUNT]!.base64,'base64');b.writeBigUInt64LE(1n,16);p.after.accounts[CLOCK_ACCOUNT]!.base64=b.toString('base64')}
  if(variant==='bad-start'){const b=Buffer.from(p.after.accounts[CLOCK_ACCOUNT]!.base64,'base64');b.writeBigInt64LE(b.readBigInt64LE(8)-1n,8);p.after.accounts[CLOCK_ACCOUNT]!.base64=b.toString('base64')}
  if(variant==='missing-boundary')p.blocks.pop();
  if(variant==='regression'){const b=Buffer.from(p.after.accounts[CLOCK_ACCOUNT]!.base64,'base64');b.writeBigInt64LE(0n,32);p.after.accounts[CLOCK_ACCOUNT]!.base64=b.toString('base64')}
  const branch=newLinkedBranch('fail','fail',p.before),hash=digest(branch);await expect(run(p,branch)).rejects.toThrow();expect(digest(branch)).toBe(hash);
});
it('selects native old/new transfer fees by the proven execution epoch and rejects policy mutations',()=>{
  const p=fixture(),feePacket=JSON.parse(gunzipSync(readFileSync('docs/linked-pair-20261024/local-extension-test/provider-461064713-461064721-token2022.json.gz')).toString()) as ProviderInterval;
  const mint='imE1nbjWM9QGUzxH2WHYNjcrUqgh9tT8RFYoj9UnMj3', witness=structuredClone(feePacket.token2022!);
  witness.contextSlot=p.after.slot;witness.clock=structuredClone(p.after.accounts[CLOCK_ACCOUNT]!);
  const raw=Buffer.from(witness.mints[mint]!.base64,'base64'),dataOffset=170,oldEpoch=BigInt(Math.floor(p.before.slot/8)),newEpoch=oldEpoch+1n;
  raw.writeBigUInt64LE(oldEpoch,dataOffset+72);raw.writeUInt16LE(100,dataOffset+88);
  raw.writeBigUInt64LE(newEpoch,dataOffset+90);raw.writeUInt16LE(300,dataOffset+106);witness.mints[mint]!.base64=raw.toString('base64');
  const policy=feePolicies(witness,p.before,p.after,p.blocks,p.epochWitness).get(mint)!;
  expect(policy.fee(10000n,oldEpoch)).toBe(100n);expect(policy.fee(10000n,newEpoch)).toBe(300n);
  expect(()=>policy.fee(10000n,newEpoch+1n)).toThrow('OUTSIDE_PROOF');
  const mutated=structuredClone(p.blocks);mutated[0]!.result.transactions.push({version:'legacy',transaction:{signatures:['controlled-mutation'],message:{accountKeys:['TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',mint],instructions:[{programIdIndex:0,accounts:[1],data:bs58.encode(Buffer.from([26,5]))}]}},meta:{err:null,innerInstructions:[],preTokenBalances:[],postTokenBalances:[]}});
  expect(()=>feePolicies(witness,p.before,p.after,mutated,p.epochWitness)).toThrow('POLICY_CHANGED_IN_INTERVAL');
});
