/** Owner-approved current-quote PAPER path. No historical store, listener, grant or SQL installer. */
import {identifier,type ProtocolId} from '@paperfund/core';
import {ExecutionRouter,ExecutionEngineError,type MarketIdentity,type MarketState} from '@paperfund/execution';
import {LinkedEngine} from '../../../../packages/protocols/isolated/linked-pair/engine.js';
import {LinkedPoolAdapter,linkedState} from '../../../../packages/protocols/isolated/linked-pair/adapter.js';
import type {Stage1Snapshot} from '../../../../packages/protocols/src/experimental/non-sol-pump-swap.js';
export const CURRENT_QUOTE_VERSION='paper-current-executable-v1';
export const CURRENT_QUOTE_NORMALIZATION='paper-current-accounts-v1';
const protocol=identifier('GENERIC_PUMP_SWAP','ProtocolId');
export const currentQuoteIdentity=(mint:string):MarketIdentity=>({protocolId:protocol,marketId:identifier('paper-current-quote:'+mint,'MarketId'),tokenMint:identifier(mint,'TokenMint')});
const fail=(reason:string):never=>{throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE','CURRENT_QUOTE_'+reason)};
const engine=(s:Stage1Snapshot)=>new LinkedEngine({purpose:'READ_ONLY_STAGE1_VALIDATION',bridgeBinding:{quoteMint:s.quoteMint,pool:s.bridgePool}});
export interface CurrentQuoteOptions {
 enabled:boolean;
 baseline:ExecutionRouter;
 mints:readonly string[];
 snapshots:(mint:string)=>Promise<Stage1Snapshot[]>;
 now?:()=>number;
 /** Retained, committed evidence only; no new financial authority database. */
 priorReference?:(mint:string)=>Promise<{slot:number;output:string}|null>;
 /** Peak held quantity derived from existing fills. Proportional exits prevent splitting impact away. */
 peakQuantity?:(mint:string)=>Promise<bigint>;
 permission:(mint:string)=>Promise<{discover:boolean;buy:boolean}>;
 maxDeviationBps?:bigint;
}
export function currentQuoteRouter(o:CurrentQuoteOptions){
 if(!o.enabled)return{router:o.baseline,source:null,adapter:null};
 const now=o.now??Date.now,maxDeviation=o.maxDeviationBps??1000n;
 if(maxDeviation<=0n||maxDeviation>1000n||!o.mints.length)fail('POLICY');
 const owns=(id:MarketIdentity)=>id.protocolId===protocol&&o.mints.includes(id.tokenMint),snapshots=new WeakMap<MarketState,Stage1Snapshot>();
 const native={
  async quote(s:Stage1Snapshot,input:bigint,buy:boolean,policy:{nowMs:number;maxAgeMs:number}){
   // Native fees and size-dependent slippage are already included; never deduct them twice.
   // Live loads supply server now; immutable adapter replay supplies the saved
   // observation time. Replays must not depend on the audit machine's clock.
   const q=await engine(s).quote(s,input,buy,{...policy,maxAgeMs:10000});
   if(buy){const reverse=await engine(s).quote(s,q.output,false,{...policy,maxAgeMs:10000});if(reverse.output>input)fail('INSTANT_ROUND_TRIP_PROFIT');return q}
   const peak=BigInt((s as Stage1Snapshot&{paperQuotePeakQuantity?:string}).paperQuotePeakQuantity??'0');
   if(peak<input&&peak!==0n)fail('POSITION_CHANGED_RETRY');
   if(peak<=input)return q;
   // Conservative V2-style peak-size exit cost, repriced at this fresh snapshot.
   const full=await engine(s).quote(s,peak,false,{...policy,maxAgeMs:10000}),scale=(n:bigint)=>n*input/peak;
   return{...full,input,output:scale(full.output),target:{...full.target,input:scale(full.target.input),output:scale(full.target.output),fees:Object.fromEntries(Object.entries(full.target.fees).map(([k,v])=>[k,scale(v)])) as typeof full.target.fees},bridge:{...full.bridge,output:scale(full.bridge.output),lp:scale(full.bridge.lp),protocol:scale(full.bridge.protocol),creator:scale(full.bridge.creator)}};
  },
  async exits(s:Stage1Snapshot,quantity:bigint,policy:{nowMs:number;maxAgeMs:number}){return engine(s).exits(s,quantity,{...policy,maxAgeMs:10000})},
 };
 const source={engine:native,async loadMarketState(id:MarketIdentity):Promise<MarketState>{
  if(!owns(id)||id.marketId!==currentQuoteIdentity(id.tokenMint).marketId)fail('IDENTITY');
  const permission=await o.permission(id.tokenMint);if(!permission.discover)fail('DISCOVERY_DISABLED');
  const candidates=await o.snapshots(id.tokenMint);if(candidates.length>16)fail('CANDIDATE_BOUND');
  const outcomes=await Promise.all(candidates.map(async(s):Promise<{state:MarketState;s:Stage1Snapshot;output:bigint}|{error:string}>=>{try{
   if(s.mint!==id.tokenMint)fail('MINT_BINDING');
   const q=await native.quote(s,10000000n,true,{nowMs:now(),maxAgeMs:10000});
   const state=await linkedState(id,s,engine(s),CURRENT_QUOTE_VERSION,CURRENT_QUOTE_NORMALIZATION);
   return{state,s,output:q.output};
  }catch(error){return{error:error instanceof Error?error.message:'UNAVAILABLE'}}}));
  const valid=outcomes.filter((r):r is {state:MarketState;s:Stage1Snapshot;output:bigint}=>'state'in r).sort((a,b)=>a.output===b.output?a.s.bridgePool.localeCompare(b.s.bridgePool):a.output>b.output?-1:1);
  const best=valid[0]??fail('NO_EXECUTABLE_ROUTE:'+outcomes.map(r=>'error'in r?r.error:'').join(','));
  const prior=await o.priorReference?.(id.tokenMint);
  if(prior){const previous=BigInt(prior.output);if(best.s.slot<prior.slot||previous<=0n||((best.output>previous?best.output-previous:previous-best.output)*10000n>previous*maxDeviation))fail('PRICE_DEVIATION_REVIEW')}
  const peak=await o.peakQuantity?.(id.tokenMint)??0n;
  const state:MarketState={...best!.state,normalizedState:{...best!.state.normalizedState,stage1Snapshot:{...(best.state.normalizedState['stage1Snapshot'] as object),paperQuotePeakQuantity:peak.toString()},currentQuotePolicy:CURRENT_QUOTE_VERSION,referenceBuyOutput:best!.output.toString(),genericBuyAdmissionAllowed:permission.buy,executionModel:'FRESH_NATIVE_QUOTES_NO_HISTORICAL_REPLAY',partialExitPolicy:'FRESH_PEAK_PROPORTIONAL',quoteProvenance:{kind:'NATIVE_EXECUTABLE_CURRENT_BANK',commitment:'finalized',historicalReplayRequired:false}}};
  snapshots.set(state,best!.s);return state;
 }};
 const adapter=new LinkedPoolAdapter(source,{protocolId:protocol,adapterVersion:CURRENT_QUOTE_VERSION,normalizationVersion:CURRENT_QUOTE_NORMALIZATION,identity:mint=>currentQuoteIdentity(mint),assertBinding:s=>{if(!o.mints.includes(s.mint))fail('MINT_SCOPE')},buysEnabled:false});
 const current=new ExecutionRouter([adapter]);
 class Router extends ExecutionRouter{
  override resolve(id:ProtocolId){return id===protocol?current.resolve(id):o.baseline.resolve(id)}
  override resolveForSettlement(id:ProtocolId){return id===protocol?current.resolveForSettlement(id):o.baseline.resolveForSettlement(id)}
  override resolveVersion(id:ProtocolId,version:string){return id===protocol&&version===CURRENT_QUOTE_VERSION?current.resolveVersion(id,version):o.baseline.resolveVersion(id,version)}
  override isEnabled(id:ProtocolId){return id===protocol||o.baseline.isEnabled(id)}
  override async resolvePositionRoute(id:MarketIdentity,settlement=false){
   if(!owns(id))return o.baseline.resolvePositionRoute(id,settlement);
   // No post-cutoff quote may be substituted for missing cutoff evidence. Existing settlement enters REVIEW.
   if(settlement)fail('CUTOFF_EVIDENCE_REQUIRED');
   return{route:{originIdentity:id,executionIdentity:currentQuoteIdentity(id.tokenMint),migrated:id.marketId!==currentQuoteIdentity(id.tokenMint).marketId},adapter:current.resolve(protocol)};
  }
  override async loadPositionRoute(id:MarketIdentity,settlement=false){
   if(!owns(id))return o.baseline.loadPositionRoute(id,settlement);
   const resolved=await this.resolvePositionRoute(id,settlement),state=await resolved.adapter.loadMarketState(resolved.route.executionIdentity);return{...resolved,state};
  }
 }
 const router=new Router();
 router.mintResolver=async mint=>o.mints.includes(mint)?currentQuoteIdentity(mint):o.baseline.mintResolver?o.baseline.mintResolver(mint):fail('DISCOVERY_UNAVAILABLE');
 router.canonicalResolver=async id=>(await router.loadPositionRoute(id)).route;
 if(o.baseline.contextResolver)router.contextResolver=o.baseline.contextResolver;
 if(o.baseline.chartMetadataResolver)router.chartMetadataResolver=o.baseline.chartMetadataResolver;
 return{router,source,adapter,async prospective(mint:string){
  const state=await source.loadMarketState(currentQuoteIdentity(mint)),s=snapshots.get(state)!;
  const buy=await engine(s).quote(s,10000000n,true,{nowMs:now(),maxAgeMs:10000}),partial=await engine(s).quote(s,buy.output/4n,false,{nowMs:now(),maxAgeMs:10000}),full=await engine(s).quote(s,buy.output-buy.output/4n,false,{nowMs:now(),maxAgeMs:10000});
  // Prospective partial exits use the same conservative peak-size schedule as actual position exits.
  const all=await engine(s).quote(s,buy.output,false,{nowMs:now(),maxAgeMs:10000});
  return{state,buy,partial:{...partial,output:all.output*(buy.output/4n)/buy.output},fullResidual:{...full,output:all.output*(buy.output-buy.output/4n)/buy.output},buyAuthorized:false};
 }};
}
