// Local canary only; called through the existing central admission callback.
export class LocalCanaryError extends Error {
 constructor(code,message){super(message);this.name='LocalCanaryError';this.code=code;this.statusCode=403;}
}
export function localAdmission({userId,mints,notBefore,expiresAt,pool,now=Date.now,maxBuys=6,maxAggregateLamports='60000000',roundId,roundEndsAt}) {
 if(!Number.isInteger(maxBuys)||maxBuys<1||maxBuys>6||typeof maxAggregateLamports!=='string'||!/^\d+$/.test(maxAggregateLamports)||BigInt(maxAggregateLamports)<10000000n||BigInt(maxAggregateLamports)>60000000n)throw Error('LOCAL_CANARY_INVALID_BUDGET');
 const ceiling=BigInt(maxAggregateLamports);
 if(roundId!==undefined&&(typeof roundId!=='string'||!roundId||!Number.isFinite(roundEndsAt)))throw Error('LOCAL_CANARY_INVALID_ROUND');
 const inWindow=()=>now()>=notBefore&&now()<expiresAt&&(roundId===undefined||now()<roundEndsAt);
 const request=(mint,amount)=>{
  if(!inWindow())throw new LocalCanaryError('LOCAL_CANARY_WINDOW_CLOSED','The local PAPER BUY allowance is not currently active.');
  if(!mints.includes(mint))throw new LocalCanaryError('LOCAL_CANARY_MINT_DENIED','This token is outside the approved local PAPER test scope.');
  if(typeof amount!=='string'||!/^0\.01(?:0{0,7})?$/.test(amount))throw new LocalCanaryError('LOCAL_CANARY_AMOUNT_DENIED','Enter exactly 0.01 PAPER SOL for this local test.');
 };
 const authorizePaperBuy=async({userId:actor,accountId,client}={})=>{
  if(!inWindow()||(actor&&actor!==userId)||(!actor&&!accountId))return false;
  const db=client??pool;
  if(client)await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",['paperfund-local-canary:'+userId]);
  if(accountId){const own=(await db.query("select a.user_id,a.hourly_round_id,h.state,h.starts_at,h.ends_at_exclusive from competition_accounts a join hourly_rounds h on h.id=a.hourly_round_id where a.id=$1",[accountId])).rows[0];if(own?.user_id!==userId||(roundId!==undefined&&own.hourly_round_id!==roundId)||own.state!=='OPEN'||+new Date(own.starts_at)>now()||+new Date(own.ends_at_exclusive)<=now())return false;}
  else if(roundId!==undefined){const h=(await db.query('select id,state,starts_at,ends_at_exclusive from hourly_rounds where id=$1',[roundId])).rows[0];if(h?.id!==roundId||h.state!=='OPEN'||+new Date(h.starts_at)>now()||+new Date(h.ends_at_exclusive)<=now())return false;}
  const row=(await db.query("select count(*)::int n,coalesce(sum(f.actual_input_lamports),0)::text spent from fills f join orders o on o.id=f.order_id join competition_accounts a on a.id=o.competition_account_id where a.user_id=$1 and f.side='BUY' and f.executed_at >= $2",[userId,new Date(notBefore)])).rows[0];
  return inWindow()&&Number.isInteger(row?.n)&&row.n>=0&&row.n<maxBuys&&/^\d+$/.test(row.spent)&&BigInt(row.spent)+10000000n<=ceiling;
 };
 return {request,authorizePaperBuy};
}
