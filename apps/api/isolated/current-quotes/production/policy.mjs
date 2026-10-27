// Scoped production PAPER wiring. No grants, trades, migrations or process actions.
import {localAdmission} from './admission.mjs';
export const MODEL='paper-current-executable-v1';
export const F4='F4KqwtJXgAAVPeyJBPZiNe7Ki1RLQDXNfEcUApdrpump';
export const DIRECT='2B9cEbjF2sNmDsfvcgMQGasvP7573GnaTu1s1Dy1pump';
const fail=reason=>{throw Error('PRODUCTION_PAPER_'+reason)};
export function validateProfile(p,now=Date.now()){
 if(p?.schema!=='PAPERFUND_SCOPED_CURRENT_QUOTES_V1'||p.nonPaying!==true||!p.approvalReference||!Array.isArray(p.routes)||p.routes.length!==1||p.routes[0]?.mint!==F4||!Array.isArray(p.grants)||p.grants.length>1)fail('PROFILE');
 const seen=new Set();for(const g of p.grants){
  if(!/^user:[a-f0-9]{64}$/.test(g.userId??'')||typeof g.wallet!=='string'||!g.wallet||seen.has(g.userId)||typeof g.roundId!=='string'||!g.roundId||!Number.isSafeInteger(g.roundEndsAt)||!Number.isSafeInteger(g.notBefore)||!Number.isSafeInteger(g.expiresAt)||g.expiresAt<=g.notBefore||g.expiresAt-g.notBefore>1800000||g.expiresAt>g.roundEndsAt||!Number.isInteger(g.maxBuys)||g.maxBuys<1||g.maxBuys>3||!/^[1-9][0-9]*$/.test(g.maxAggregateLamports??'')||BigInt(g.maxAggregateLamports)>BigInt(g.maxBuys)*10000000n||BigInt(g.maxAggregateLamports)<10000000n||!Array.isArray(g.mints)||!g.mints.length||new Set(g.mints).size!==g.mints.length||g.mints.some(m=>![F4,DIRECT].includes(m)))fail('GRANT');
  seen.add(g.userId);
 }
 return p;
}
export function withQuoteRewardHold(database,ErrorClass=Error){
 return{...database,prepareMarketSettlement:async(roundId,cutoff)=>{
  const r=await database.pool.query("select 1 from fills f join orders o on o.id=f.order_id join competition_accounts a on a.id=o.competition_account_id where a.hourly_round_id=$1 and f.adapter_version=$2 limit 1",[roundId,MODEL]);
  if(r.rows.length){if(ErrorClass===Error)throw Error('SETTLEMENT_REVIEW: CURRENT_QUOTE_REWARD_QUALIFICATION_REQUIRED');throw new ErrorClass('SETTLEMENT_REVIEW','CURRENT_QUOTE_REWARD_QUALIFICATION_REQUIRED');}
  await database.prepareMarketSettlement?.(roundId,cutoff);
 }};
}
export function productionAdmission(database,profile,capability,now=Date.now){
 validateProfile(profile,now());
 const grants=new Map(profile.grants.map(g=>[g.userId,{grant:g,gate:localAdmission({...g,pool:database.pool,now})}]));
 async function authorize(context={}){
  const client=context.client??database.pool;
  const user=context.accountId?(await client.query('select u.id,u.wallet_address from competition_accounts a join users u on u.id=a.user_id where a.id=$1',[context.accountId])).rows[0]:context.userId?(await client.query('select id,wallet_address from users where id=$1',[context.userId])).rows[0]:null;
  const found=grants.get(user?.id);if(!found||found.grant.wallet!==user.wallet_address||(context.userId&&context.userId!==user.id)||(await capability.status(user.id)).mode!=='ENTRY')return false;
  if(context.client){const row=(await client.query('select value from app_meta where key=$1 for share',['generic_pumpswap_operator_control_v1'])).rows[0];let control;try{control=JSON.parse(row?.value)}catch{return false}if(control.schema!=='GENERIC_OPERATOR_CONTROL_V1'||control.mode!=='ENTRY'||!Number.isFinite(control.expiresAt)||control.expiresAt<=now())return false;}
  return found.gate.authorizePaperBuy({...context,userId:user.id});
 }
 return{authorizePaperBuy:authorize,request(user,mint,amount){const found=grants.get(user?.id);if(!found||found.grant.wallet!==user.walletAddress)fail('BUY_NOT_AUTHORIZED');found.gate.request(mint,amount);}};
}
export function composeProduction(h,{database,baseline,profile,capability,actor,snapshots,now=Date.now}){
 validateProfile(profile,now());const admission=productionAdmission(database,profile,capability,now);
 const db=withQuoteRewardHold({...database,authorizePaperBuy:admission.authorizePaperBuy});
 async function account(){const a=actor();if(!a?.userId&&!a?.accountId)fail('OWNER_CONTEXT');const r=a.accountId?await database.pool.query('select id,user_id,hourly_round_id from competition_accounts where id=$1',[a.accountId]):await database.pool.query("select a.id,a.user_id,a.hourly_round_id from competition_accounts a join hourly_rounds r on r.id=a.hourly_round_id where a.user_id=$1 and r.state='OPEN' and r.starts_at<=$2 and r.ends_at_exclusive>$2",[a.userId,new Date(now())]);const row=r.rows[0];if(!row||(a.userId&&row.user_id!==a.userId))fail('ACCOUNT_CONTEXT');return row;}
 const scoped=h.currentQuoteRouter({enabled:true,baseline,mints:profile.routes.map(r=>r.mint),snapshots,now,
  permission:async()=>{const a=await account(),s=await capability.status(a.user_id);if(s.mode==='HARD_STOP')fail('HARD_STOP');return{discover:true,buy:await admission.authorizePaperBuy({userId:a.user_id,accountId:a.id})};},
  peakQuantity:async mint=>{const a=await account();const r=await database.pool.query("with q as(select sum(case when f.side='BUY' then f.base_quantity else -f.base_quantity end) over(order by f.executed_at,f.id rows unbounded preceding) n from fills f join orders o on o.id=f.order_id join markets m on m.id=f.market_id join assets b on b.id=m.base_asset_id where o.competition_account_id=$1 and b.mint_address=$2)select coalesce(max(n),0)::text n from q",[a.id,mint]);return BigInt(r.rows[0].n);},
  priorReference:async mint=>{const a=await account();const r=await database.pool.query("select e.chain_slot,e.normalized_state->>'referenceBuyOutput' output from market_state_evidence e where e.adapter_version=$1 and e.normalized_state->'stage1Snapshot'->>'mint'=$2 and exists(select 1 from fills f join orders o on o.id=f.order_id where f.market_state_evidence_id=e.id and o.competition_account_id=$3) order by e.created_at desc limit 1",[MODEL,mint,a.id]);return r.rows[0]?{slot:Number(r.rows[0].chain_slot),output:r.rows[0].output}:null;},
 });
 // Existing generic positions retain their original market/version routing.
 const oldResolve=scoped.router.resolvePositionRoute.bind(scoped.router),oldLoad=scoped.router.loadPositionRoute.bind(scoped.router);
 const legacy=id=>id.protocolId==='GENERIC_PUMP_SWAP'&&!String(id.marketId).startsWith('paper-current-quote:');
 scoped.router.resolvePositionRoute=(id,s)=>legacy(id)?baseline.resolvePositionRoute(id,s):oldResolve(id,s);
 scoped.router.loadPositionRoute=(id,s)=>legacy(id)?baseline.loadPositionRoute(id,s):oldLoad(id,s);
 return{database:db,router:scoped.router,admission};
}
