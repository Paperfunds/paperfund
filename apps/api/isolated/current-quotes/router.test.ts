import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';
import {ExecutionRouter,createMarketStateEvidence} from '@paperfund/execution';
import {identifier,paperSolBaseUnits,tokenBaseUnits,utcInstant} from '@paperfund/core';
import {currentQuoteRouter,currentQuoteIdentity} from './router.js';
const interval=JSON.parse(gunzipSync(readFileSync('apps/api/isolated/current-quotes/fixtures/provider-interval.json.gz')).toString());
const seed=interval.after;
function setup(extra:Record<string,unknown>={}){return currentQuoteRouter({enabled:true,baseline:new ExecutionRouter(),mints:[seed.mint],snapshots:async()=>[structuredClone(seed)],permission:async()=>({discover:true,buy:true}),now:()=>Date.parse(seed.observedAt),...extra})}
it('is opt-in and does not require a historical branch or quarantine access',async()=>{const base=new ExecutionRouter();expect(currentQuoteRouter({enabled:false,baseline:base,mints:[],snapshots:async()=>[],permission:async()=>({discover:false,buy:false})}).router).toBe(base);const f=setup(),p=await f.prospective!(seed.mint);expect(p.buy.output).toBeGreaterThan(0n);expect(p.partial.output+p.fullResidual.output).toBeLessThan(10000000n);expect(p.buyAuthorized).toBe(false)});
it('binds evidence and native fees, reprices partial/full exits without a split advantage',async()=>{let peak=0n;const f=setup({peakQuantity:async()=>peak}),id=currentQuoteIdentity(seed.mint),loaded=await f.router.loadPositionRoute(id),state=loaded.state;
 const request={orderId:identifier('buy','OrderId'),executionId:identifier('fill','ExecutionId'),identity:id,executedAt:utcInstant(seed.observedAt)};
 const buy=await loaded.adapter.simulateBuy({...request,requestedPaperSol:paperSolBaseUnits(10000000n)},state);expect(buy.quote.marketStateFingerprint).toBe(createMarketStateEvidence(state).fingerprint);expect(buy.quote.fees.length).toBeGreaterThan(0);
 peak=buy.actualOutput.amount;const exitState=(await f.router.loadPositionRoute(id)).state;const part=peak/4n,full=await loaded.adapter.simulateSell({...request,requestedTokenQuantity:tokenBaseUnits(peak)},exitState),a=await loaded.adapter.simulateSell({...request,requestedTokenQuantity:tokenBaseUnits(part)},exitState),b=await loaded.adapter.simulateSell({...request,requestedTokenQuantity:tokenBaseUnits(peak-part)},exitState);expect(a.actualOutput.amount+b.actualOutput.amount).toBeLessThanOrEqual(full.actualOutput.amount);expect(full.actualOutput.amount).toBeLessThan(buy.actualInput.amount);peak=0n;expect((await loaded.adapter.simulateSell({...request,requestedTokenQuantity:tokenBaseUnits(part)},exitState)).actualOutput).toEqual(a.actualOutput);
});
it('rejects stale state, price discontinuity, absent routes and unauthorized BUY while keeping reads possible',async()=>{for(const extra of [{now:()=>Date.parse(seed.observedAt)+10001},{priorReference:async()=>({slot:seed.slot,output:'1'})},{snapshots:async()=>[]}])await expect(setup(extra).router.loadPositionRoute(currentQuoteIdentity(seed.mint))).rejects.toThrow();const f=setup({permission:async()=>({discover:true,buy:false})}),l=await f.router.loadPositionRoute(currentQuoteIdentity(seed.mint));await expect(l.adapter.simulateBuy({identity:l.state.identity,orderId:identifier('x','OrderId'),executionId:identifier('x','ExecutionId'),requestedPaperSol:paperSolBaseUnits(10000000n),executedAt:utcInstant(seed.observedAt)},l.state)).rejects.toThrow('EXIT_ONLY');});
it('does not replace absent cutoff evidence with a current quote',async()=>{await expect(setup().router.loadPositionRoute(currentQuoteIdentity(seed.mint),true)).rejects.toThrow('CUTOFF_EVIDENCE_REQUIRED')});
it('replays immutable BUY and peak-proportional SELL after restart without accepting stale live loads',async()=>{
 let clock=Date.parse(seed.observedAt),peak=0n;
 const f=setup({now:()=>clock,peakQuantity:async()=>peak}),id=currentQuoteIdentity(seed.mint);
 const initial=await f.router.loadPositionRoute(id),request={identity:id,orderId:identifier('replay','OrderId'),executionId:identifier('replay','ExecutionId'),executedAt:utcInstant(seed.observedAt)};
 const buy=await initial.adapter.simulateBuy({...request,requestedPaperSol:paperSolBaseUnits(10000000n)},initial.state);
 peak=buy.actualOutput.amount;
 const exit=await f.router.loadPositionRoute(id),sellRequest={...request,requestedTokenQuantity:tokenBaseUnits(peak/4n)};
 const sell=await exit.adapter.simulateSell(sellRequest,exit.state);
 clock+=86400000;
 // A new router has no live WeakMap state and receives only retained evidence.
 const restarted=setup({now:()=>clock}).router.resolveVersion(id.protocolId,'paper-current-executable-v1');
 expect(await restarted.simulateBuy({...request,requestedPaperSol:paperSolBaseUnits(10000000n)},initial.state)).toEqual(buy);
 expect(await restarted.simulateSell(sellRequest,exit.state)).toEqual(sell);
 await expect(f.router.loadPositionRoute(id)).rejects.toThrow('STALE');
});
