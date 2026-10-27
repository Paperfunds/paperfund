import fs from 'node:fs';import path from 'node:path';import pg from 'pg';
import {inspectBetaHour} from './beta-payout-policy.mjs';import {makeWinnerTestPlan,prepareWinnerTest,winnerPermit,assertWinnerPermit,executeWinnerTest,reconcileWinnerTest,TEST_SCOPE,WALLET,PROTECTED_HISTORICAL_REWARDS} from './winner-test-core.mjs';
import {keyHandle,createClaimJournal} from './claim-runtime.mjs';import {protectedDeveloperRpc} from './developer-transfer-review.mjs';
const installation=()=>path.join(process.env.ProgramFiles,'PaperfundSigner');
const root=()=>path.join(process.env.LOCALAPPDATA,'PaperfundSigner','winner-tests',TEST_SCOPE);
const read=name=>JSON.parse(fs.readFileSync(path.join(installation(),name),'utf8').replace(/^\uFEFF/,''));
export async function loadWinnerTestSource({intent,config,client:injected,transactionOpen=false,now=Date.now()}){
 let pool,client=injected;
 try{
 if(!client){if(!config.readonlyDatabaseUrl)throw Error('WINNER_READONLY_DATABASE_ENROLLMENT_REQUIRED');pool=new pg.Pool({connectionString:config.readonlyDatabaseUrl,max:1,connectionTimeoutMillis:3000,statement_timeout:15000,application_name:'paperfund-isolated-winner-test-readonly'});client=await pool.connect();}
 if(!transactionOpen)await client.query('begin isolation level repeatable read read only');
 const role=(await client.query('select rolsuper,rolcreatedb,rolcreaterole from pg_roles where rolname=current_user')).rows[0];if((role.rolsuper||role.rolcreatedb||role.rolcreaterole)&&!transactionOpen)throw Error('WINNER_DEDICATED_READONLY_ROLE_REQUIRED');if((await client.query("select current_setting('transaction_read_only') mode")).rows[0].mode!=='on')throw Error('WINNER_READONLY_TRANSACTION_REQUIRED');
 const stop=(await client.query('select stopped,generation::text from payout_stop_state where singleton=true')).rows[0];if(stop?.stopped!==true)throw Error('WINNER_TEST_REQUIRES_PRODUCTION_STOP');
 if(!intent.roundId){const selected=(await client.query("select r.id from hourly_rounds r join hourly_results h on h.hourly_round_id=r.id join users u on u.id=h.user_id where r.state='FINALIZED' and r.starts_at >= $1 group by r.id having count(*)=$2 and bool_and(u.wallet_address=any($3)) order by r.starts_at desc limit 1",[intent.notBefore,intent.invitedWallets.length,intent.invitedWallets])).rows[0];if(!selected)throw Error('WINNER_WAITING_FOR_INVITED_FINALIZED_RESULTS');intent={...intent,roundId:selected.id};}
 const source=await inspectBetaHour(client,intent.roundId,{effectiveFrom:intent.notBefore,now}),plan=makeWinnerTestPlan(source,intent);
 const pending=(await client.query("select count(*)::int n from payout_executions where state<>'VERIFIED'")).rows[0];if(pending.n)throw Error('WINNER_UNRESOLVED_PRODUCTION_EXECUTION');
 const obligations=(await client.query("select coalesce(sum(principal),0)::text principal,coalesce(sum(fee_budget),0)::text fees from payout_treasury_reservations")).rows[0];
 const floor=PROTECTED_HISTORICAL_REWARDS+BigInt(obligations.principal)+BigInt(obligations.fees);
 if(!transactionOpen)await client.query('rollback');return {source,plan,protectedFloor:floor,financialStop:stop};
 }catch(e){if(!transactionOpen)await client?.query('rollback').catch(()=>{});throw e;}finally{if(!injected)client?.release();await pool?.end();}
}
async function main(){
 if(process.argv[2]==='Prepare'){const config=read('automation-config.json'),intent=read('winner-test-intent.json'),s=await loadWinnerTestSource({intent,config}),r=await prepareWinnerTest(s.plan,protectedDeveloperRpc(),{protectedFloor:s.protectedFloor});console.log(JSON.stringify({review:r,reviewSha256:winnerPermit(r,'LOCAL_REVIEW_ONLY').reviewSha256}));return;}
 let input='';for await(const c of process.stdin){input+=c;if(input.length>200000)throw Error('WINNER_INPUT_LIMIT');}const req=JSON.parse(input||'{}');input='';
 if(req.mode==='ApprovalTemplate'){console.log(JSON.stringify(winnerPermit(req.review,req.operator)));return;}
 const rpc=protectedDeveloperRpc({allowSend:req.mode==='Execute'});
 if(req.mode==='Reconcile'){console.log(JSON.stringify(await reconcileWinnerTest(root(),rpc)));return;}
 if(fs.existsSync(path.join(installation(),'standing-policy.json')))throw Error('WINNER_TEST_REQUIRES_NO_STANDING_AUTHORITY');
 const intent=read('winner-test-intent.json'),config=read('automation-config.json');
 const load=()=>loadWinnerTestSource({intent,config});
 if(req.mode==='Prepare'){const s=await load(),r=await prepareWinnerTest(s.plan,rpc,{protectedFloor:s.protectedFloor});console.log(JSON.stringify({review:r,reviewSha256:winnerPermit(r,'LOCAL_REVIEW_ONLY').reviewSha256}));return;}
 if(req.mode!=='Execute')throw Error('WINNER_MODE_FORBIDDEN');assertWinnerPermit(req.review,req.permit);
 const current=await load();if(current.plan.planHash!==req.review.plan.planHash||String(current.protectedFloor)!==req.review.protectedRewardFloorLamports)throw Error('WINNER_SOURCE_OR_FUNDING_CHANGED');
 const handle=keyHandle(req.key);req.key='';fs.mkdirSync(root(),{recursive:true});
 const result=await executeWinnerTest({review:req.review,permit:req.permit,handle,rpc,journal:createClaimJournal(root()),verifySourceAndFunding:async p=>{const s=await load();if(s.plan.planHash!==p.planHash||String(s.protectedFloor)!==req.review.protectedRewardFloorLamports)throw Error('WINNER_SOURCE_OR_FUNDING_CHANGED');}});
 try{for(let n=0;n<12;n++){result.reconciliation=await reconcileWinnerTest(root(),rpc);if(result.reconciliation.status==='PAID')break;await new Promise(r=>setTimeout(r,1500));}}catch{result.reconciliationError='WINNER_RECONCILE_PERSISTED_SIGNATURE_ONLY';}console.log(JSON.stringify(result));
}
if(process.argv[1]?.endsWith('winner-test.bundle.cjs'))main().catch(e=>{console.error(/^(WINNER|AUTO|TRANSFER)_[A-Z0-9_:]+$/.test(e.message)?e.message:'WINNER_RUNTIME_BLOCKED_NO_AUTOMATIC_RETRY');process.exitCode=1;});
