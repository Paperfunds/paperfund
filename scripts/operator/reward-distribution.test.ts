import {it,expect} from 'vitest';import {Keypair,Transaction,SystemInstruction} from '@solana/web3.js';import bs58 from 'bs58';import {writeFileSync} from 'node:fs';
import {fixture,fundAndApprove} from '../../packages/db/test/legacy-beta-fixture.js';
import {createUser,initializeCompetitionAccount,executePaperBuy} from '../../packages/db/src/financial-service.js';
import {getPayoutPlanAudit,generateHourlyShadowPayoutPlan} from '../../packages/db/src/payout-service.js';
import {executeApprovedPayoutPlan,reconcilePayoutExecution,retryPayoutExecution} from '../../packages/db/src/payout-execution.js';
import {createIsolatedPayoutSigner} from '../../packages/payout-signer/src/isolated-signer.js';
import {changePayoutStop} from '../../packages/db/src/payout-security.js';
const observations:any[]=[];
it('existing engine creates three exact recipients including a genuine fill-derived tie and underfilled top ten; lost ACK reconciles once',async()=>{
 const f=await fixture(),key=Keypair.generate();try{
  await createUser(f.db,{id:'carol',walletAddress:Keypair.generate().publicKey.toBase58()});await initializeCompetitionAccount(f.db,{accountId:'carol',userId:'carol',hourlyRoundId:f.round,idempotencyKey:'start-carol'});await executePaperBuy(f.db,f.router,{competitionAccountId:'carol',marketId:f.state.identity.marketId,requestedPaperSolLamports:1000000000n,idempotencyKey:'buy-carol',authoritativeTimestamp:new Date(+f.start+60000)});
  await f.close();const p=await fundAndApprove(f,undefined,key.publicKey.toBase58());await p.release();await p.approve();await p.dry();
  const audit=(await getPayoutPlanAudit(f.db,p.plan.id))!;expect(audit.allocations.length).toBe(3);const bob=audit.allocations.find(a=>a.userId==='bob')!,carol=audit.allocations.find(a=>a.userId==='carol')!;expect(bob.tieGroupSize).toBe(2);expect(carol.allocatedLamports).toBe(bob.allocatedLamports);expect(audit.allocations.reduce((n,a)=>n+a.allocatedLamports,0n)).toBe(6300n);
  const hash=(await f.db.pool.query('select plan_snapshot_hash from payout_plan_approvals where payout_plan_id=$1',[p.plan.id])).rows[0].plan_snapshot_hash;
  let signs=0,sends=0;let sent:Transaction|null=null;
  const signer=createIsolatedPayoutSigner(p.treasury,{open:async()=>({publicKey:p.treasury,signTransaction:async bytes=>{signs++;const tx=Transaction.from(bytes);tx.partialSign(key);return {signedTransaction:tx.serialize(),signature:bs58.encode(tx.signature!)};}})});
  const rpc={...p.rpc,sendSignedTransaction:async(bytes:Uint8Array)=>{sends++;sent=Transaction.from(bytes);throw Error('LOST_ACK_TEST_ONLY');},getSignatureStatus:async()=>sent?{confirmationStatus:'finalized' as const,error:null,slot:20n}:null,getFinalizedTransfers:async()=>sent?{error:null,slot:20n,feeLamports:5n,transfers:sent.instructions.map(ix=>{const t=SystemInstruction.decodeTransfer(ix);return {source:t.fromPubkey.toBase58(),destination:t.toPubkey.toBase58(),lamports:BigInt(t.lamports)};})}:null};
  await executeApprovedPayoutPlan(f.db,{planId:p.plan.id,config:{...p.config,enabled:true},rpc,signer,now:p.now,authority:p.request('EXECUTE',p.plan.id,hash)});
  const execution=(await f.db.pool.query('select id from payout_executions')).rows[0];await reconcilePayoutExecution(f.db,{executionId:execution.id,rpc,now:p.now});await reconcilePayoutExecution(f.db,{executionId:execution.id,rpc,now:p.now});
  expect(signs).toBe(1);expect(sends).toBe(1);expect((await f.db.pool.query('select count(*)::int n from payout_treasury_settlements')).rows[0].n).toBe(1);
  expect((await f.db.pool.query('select state from payout_plans where id=$1',[p.plan.id])).rows[0].state).toBe('VERIFIED');
  observations.push({case:'three-winners-tie-underfilled',snapshot:audit.sourceLeaderboard,allocations:audit.allocations,signs,sends,signatureCryptographicallyValid:sent!.verifySignatures(),chainReceipt:'SYNTHETIC_LOCALNET_NOT_ON_CHAIN',duplicateReconciliation:'ONE_SETTLEMENT',realTransfers:0});
 }finally{key.secretKey.fill(0);await f.cleanup();}
},30000);
it('changed wallet cannot redirect approved snapshot, STOP and insufficient funds prevent signing',async()=>{
 const f=await fixture();try{await f.close();const p=await fundAndApprove(f);await p.release();await p.approve();const audit=(await getPayoutPlanAudit(f.db,p.plan.id))!,hash=(await f.db.pool.query('select plan_snapshot_hash from payout_plan_approvals where payout_plan_id=$1',[p.plan.id])).rows[0].plan_snapshot_hash;
  let signs=0;let destinations:string[]=[];const signer={type:'NO_SIGN_TRAP',publicKey:p.treasury,signTransaction:async(bytes:Uint8Array)=>{signs++;destinations=Transaction.from(bytes).instructions.map(ix=>SystemInstruction.decodeTransfer(ix).toPubkey.toBase58());throw Error('NO_SIGN_TEST_TRAP');}};
  await f.db.pool.query('update users set wallet_address=$1 where id=$2',[Keypair.generate().publicKey.toBase58(),'alice']);expect((await getPayoutPlanAudit(f.db,p.plan.id))!.sourceLeaderboard).toEqual(audit.sourceLeaderboard);
  await expect(executeApprovedPayoutPlan(f.db,{planId:p.plan.id,config:{...p.config,enabled:true},rpc:p.rpc,signer,now:p.now,authority:p.request('EXECUTE',p.plan.id,hash)})).rejects.toThrow();expect(signs).toBe(1);expect(destinations.sort()).toEqual(audit.sourceLeaderboard.map((r:any)=>r.walletAddress).sort());
  await f.db.pool.query('update users set wallet_address=$1 where id=$2',[audit.sourceLeaderboard.find((a:any)=>a.userId==='alice')!.walletAddress,'alice']);p.state.received=0n;await expect(p.dry()).rejects.toThrow();
  p.state.received=10100n;await changePayoutStop(f.db,p.request('STOP','*','0'.repeat(64),'1'));await expect(executeApprovedPayoutPlan(f.db,{planId:p.plan.id,config:{...p.config,enabled:true},rpc:p.rpc,signer,now:p.now,authority:p.request('EXECUTE',p.plan.id,hash)})).rejects.toThrow();expect(signs).toBe(1);
  observations.push({case:'redirect-funding-STOP',redirectBlocked:true,insufficientFundsBlocked:true,STOPBlocked:true,signs});
 }finally{await f.cleanup();}
},30000);
it('spending cap below exact principal blocks reservation and immutable plan cannot duplicate',async()=>{const f=await fixture();try{await f.close();const p=await fundAndApprove(f,{recipient:10000n,plan:6299n,outstanding:20000n,daily:20000n,pilot:20000n,maxFeePerTransaction:10n,maxEvidenceAgeMs:60000});await p.release();await expect(p.approve()).rejects.toThrow();expect((await f.db.pool.query('select count(*)::int n from payout_treasury_reservations')).rows[0].n).toBe(0);const again=await generateHourlyShadowPayoutPlan(f.db,{hourlyRoundId:f.round,now:p.now});expect(again.id).toBe(p.plan.id);observations.push({case:'caps-and-plan-retry',capBlocked:true,duplicatePlan:false});}finally{await f.cleanup();}},30000);
it('retain explicit fixture evidence without claiming a live transfer',()=>{writeFileSync('artifacts/operator/reward-distribution-tests.json',JSON.stringify(observations,(_k,v)=>typeof v==='bigint'?String(v):v,2));});
