// Public PAPER composition: same ledger/router, explicit nonpaying release authority.
export const MODEL='paper-current-executable-v1';
export const CONTROL='generic_pumpswap_operator_control_v1';
const fail=reason=>{const error=Error('PUBLIC_PAPER_'+reason);error.statusCode=403;throw error;};
export function validateProfile(p){
 if(p?.schema!=='PAPERFUND_PUBLIC_CURRENT_QUOTES_V1'||p.nonPaying!==true||!p.approvalReference||!p.authorizationId||!['EXIT_ONLY','PUBLIC_PAPER'].includes(p.admission)||!Number.isFinite(Date.parse(p.rewardHoldFrom))||'grants'in p||'routes'in p)fail('PROFILE');
 return p;
}
export function publicCapability(database,profile,{operatorIds=[],actor=()=>null,now=Date.now}={}){
 validateProfile(profile);
 async function mode(client=database.pool,lock=false){
  const r=await client.query('select value from app_meta where key=$1'+(lock?' for share':''),[CONTROL]);
  let c;try{c=JSON.parse(r.rows[0]?.value)}catch{return 'HARD_STOP'}
  if(c?.schema!=='GENERIC_OPERATOR_CONTROL_V1')return 'HARD_STOP';
  if(c.mode==='HARD_STOP'||c.mode==='EXIT_ONLY')return c.mode;
  // Old grants/expired records cannot authorize this public release.
  if(c.mode!=='ENTRY'||c.publicPaper!==true||c.authorizationId!==profile.authorizationId||c.expiresAt!==null)return 'EXIT_ONLY';
  return profile.admission==='PUBLIC_PAPER'?'ENTRY':'EXIT_ONLY';
 }
 async function owner(context={},client=database.pool){
  const r=context.accountId?await client.query('select a.user_id id,u.wallet_address,a.hourly_round_id,h.state,h.starts_at,h.ends_at_exclusive from competition_accounts a join users u on u.id=a.user_id join hourly_rounds h on h.id=a.hourly_round_id where a.id=$1',[context.accountId]):context.userId?await client.query('select id,wallet_address from users where id=$1',[context.userId]):{rows:[]};
  const u=r.rows[0];if(!u||!u.wallet_address||(context.userId&&u.id!==context.userId))return null;
  if(context.accountId&&(u.state!=='OPEN'||+new Date(u.starts_at)>now()||+new Date(u.ends_at_exclusive)<=now()))return null;
  return u;
 }
 const cap={currentActor:actor,options:Object.freeze({armed:true,entries:profile.admission==='PUBLIC_PAPER',normalUserAccess:true,operatorIds:[...operatorIds]}),mode,owner,async status(userId){const m=await mode();return{userId,armed:true,entitled:true,canControl:operatorIds.includes(userId),mode:m,entriesEnabled:m==='ENTRY',exitPolicy:'OWNED_IMMUTABLE_FILL_AND_FRESH_ROUTE'};},
 async control(userId,m){if(!operatorIds.includes(userId))fail('OPERATOR_REQUIRED');if(!['ENTRY','EXIT_ONLY','HARD_STOP'].includes(m))fail('CONTROL');if(m==='ENTRY'&&profile.admission!=='PUBLIC_PAPER')fail('EXIT_ONLY');await database.pool.query('insert into app_meta(key,value) values($1,$2) on conflict(key) do update set value=excluded.value,updated_at=now()',[CONTROL,JSON.stringify({schema:'GENERIC_OPERATOR_CONTROL_V1',mode:m,actorUserId:userId,at:new Date(now()).toISOString(),expiresAt:null,publicPaper:true,authorizationId:profile.authorizationId})]);return cap.status(userId);},
 async resolve(mint,quote,settlement){const a=actor();if(settlement||a?.systemRead||!a?.userId)return{discover:false,buy:false};if(!await owner(a))return{discover:false,buy:false};const m=await mode();if(m==='HARD_STOP')fail('HARD_STOP');return{discover:true,buy:m==='ENTRY',authorizeLive:async kind=>{if(actor()?.intent!==kind)fail('INTENT');const current=await mode();if(current==='HARD_STOP'||(kind==='BUY'&&current!=='ENTRY'))fail(current);if(!await owner(a))fail('OWNER');if(kind==='SELL'){const r=await database.pool.query('select 1 from positions p join competition_accounts a on a.id=p.competition_account_id join assets b on b.id=p.asset_id where a.user_id=$1 and b.mint_address=$2 and p.status=\'OPEN\' and p.remaining_base_units>0 and ($3::text is null or a.id=$3)',[a.userId,mint,a.accountId??null]);if(!r.rows.length)fail('OWNED_EXIT_REQUIRED');}}};}};
 return cap;
}
export function productionAdmission(database,profile,capability){
 validateProfile(profile);
 return{async authorizePaperBuy(context={}){const client=context.client??database.pool;
  const a=capability.currentActor();
  if(!a?.userId||(context.userId&&context.userId!==a.userId)||(context.client&&a.intent!=='BUY'))return false;
  // Preserve the former gate's transaction serialization before FK/idempotency lock upgrades.
  if(context.client&&context.accountId)await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['paperfund-paper-entry:'+context.accountId]);
  return !!(await capability.owner({...context,userId:a.userId},client))&&(await capability.mode(client,!!context.client))==='ENTRY';},
 request(user){if(!user?.id||!user.walletAddress)fail('AUTHENTICATION_REQUIRED');}};
}
export function withQuoteRewardHold(database,ErrorClass=Error){return{...database,prepareMarketSettlement:async(roundId,cutoff)=>{
 // Public baseline/direct fills also remain nonpayable. No dependency on a grant or remaining position.
 const r=await database.pool.query('select 1 from fills f join orders o on o.id=f.order_id join competition_accounts a on a.id=o.competition_account_id where a.hourly_round_id=$1 limit 1',[roundId]);
 if(r.rows.length){if(ErrorClass===Error)throw Error('SETTLEMENT_REVIEW: PUBLIC_PAPER_REWARD_QUALIFICATION_REQUIRED');throw new ErrorClass('SETTLEMENT_REVIEW','PUBLIC_PAPER_REWARD_QUALIFICATION_REQUIRED');}
 await database.prepareMarketSettlement?.(roundId,cutoff);
}};}
export function installPublicOnboarding(app,competition){
 app.addHook('onSend',async(req,reply,payload)=>{
  if(req.method==='POST'&&req.url.split('?')[0]==='/api/v1/auth/verify'&&reply.statusCode===200){
   const result=JSON.parse(String(payload));if(!result.user?.id)fail('AUTH_RESULT');
   // The verified signature handler supplies this identity. Existing admission is atomic/idempotent.
   await competition.enterRound(result.user.id);
  }
  return payload;
 });
}
export function composeProduction(h,{database,baseline,profile,capability,actor,snapshots,now=Date.now}){
 validateProfile(profile);const admission=productionAdmission(database,profile,capability),db=withQuoteRewardHold({...database,authorizePaperBuy:admission.authorizePaperBuy});
 const mints=['__PUBLIC_DYNAMIC_ROUTE_REGISTRY__'];
 const register=mint=>{if(!mints.includes(mint)){if(mints.length>=1024)mints.splice(1,1);mints.push(mint);}};
 async function account(){const a=actor();if(!a?.userId)fail('OWNER_CONTEXT');const r=a.accountId?await database.pool.query('select id,user_id,hourly_round_id from competition_accounts where id=$1 and user_id=$2',[a.accountId,a.userId]):await database.pool.query("select a.id,a.user_id,a.hourly_round_id from competition_accounts a join hourly_rounds r on r.id=a.hourly_round_id where a.user_id=$1 and r.state='OPEN' and r.starts_at<=$2 and r.ends_at_exclusive>$2",[a.userId,new Date(now())]);if(!r.rows[0])fail('ACCOUNT_CONTEXT');return r.rows[0];}
 const scoped=h.currentQuoteRouter({enabled:true,baseline,mints,snapshots,now,
 permission:async()=>{const a=await account(),s=await capability.status(a.user_id);if(s.mode==='HARD_STOP')fail('HARD_STOP');return{discover:true,buy:await admission.authorizePaperBuy({userId:a.user_id,accountId:a.id})};},
 peakQuantity:async mint=>{const a=await account();const r=await database.pool.query("with q as(select sum(case when f.side='BUY' then f.base_quantity else -f.base_quantity end) over(order by f.executed_at,f.id rows unbounded preceding) n from fills f join orders o on o.id=f.order_id join markets m on m.id=f.market_id join assets b on b.id=m.base_asset_id where o.competition_account_id=$1 and b.mint_address=$2)select coalesce(max(n),0)::text n from q",[a.id,mint]);return BigInt(r.rows[0].n);},
 priorReference:async mint=>{const a=await account();const r=await database.pool.query("select e.chain_slot,e.normalized_state->>'referenceBuyOutput' output from market_state_evidence e where e.adapter_version=$1 and e.normalized_state->'stage1Snapshot'->>'mint'=$2 and exists(select 1 from fills f join orders o on o.id=f.order_id where f.market_state_evidence_id=e.id and o.competition_account_id=$3) order by e.created_at desc limit 1",[MODEL,mint,a.id]);return r.rows[0]?{slot:Number(r.rows[0].chain_slot),output:r.rows[0].output}:null;}});
 const resolve=scoped.router.resolvePositionRoute.bind(scoped.router),load=scoped.router.loadPositionRoute.bind(scoped.router),mintResolver=scoped.router.mintResolver;
 const native=id=>String(id.marketId).startsWith('paper-current-quote:');
 scoped.router.resolvePositionRoute=async(id,s)=>{if(!native(id))return baseline.resolvePositionRoute(id,s);register(id.tokenMint);if(s)return resolve(id,s);
  const candidates=await snapshots(id.tokenMint);if(candidates.length)return resolve(id,s);
  const current=await baseline.mintResolver(id.tokenMint),r=await baseline.resolvePositionRoute(current,s);
  return{...r,route:{...r.route,originIdentity:id,migrated:true}};
 };
 scoped.router.loadPositionRoute=async(id,s)=>{if(!native(id))return baseline.loadPositionRoute(id,s);const r=await scoped.router.resolvePositionRoute(id,s);return{...r,state:await r.adapter.loadMarketState(r.route.executionIdentity)};};
 scoped.router.mintResolver=async mint=>{const routes=await snapshots(mint);if(routes.length){register(mint);return mintResolver(mint);}return baseline.mintResolver(mint);};
 return{database:db,router:scoped.router,admission};
}
