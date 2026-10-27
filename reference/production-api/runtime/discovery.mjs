// Discovery hints never supply prices or reserves. Every candidate is recaptured and natively quoted.
export function currentSnapshots(h,p,rpc,archive,baseline,{candidates}={}){
 const SOL=p.WRAPPED_SOL_MINT;
 const metadata=new Map();
 candidates??={async pools(mint){const cached=metadata.get(mint);if(cached&&cached.until>Date.now())return cached.pools;
  const r=await fetch('https://api.dexscreener.com/token-pairs/v1/solana/'+mint,{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('PUBLIC_DISCOVERY_HTTP');const data=await r.json();if(!Array.isArray(data))throw Error('PUBLIC_DISCOVERY_RESPONSE');
  const pools=[...new Set(data.map(x=>x.pairAddress).filter(x=>typeof x==='string'))].sort().slice(0,40);if(metadata.size>=256)metadata.delete(metadata.keys().next().value);metadata.set(mint,{pools,until:Date.now()+10000});return pools;
 }};
 async function pump(mint){
  const curve=await p.pumpBondingCurveAddress(mint),read=await rpc.call('getMultipleAccounts',[[curve],{commitment:'finalized',encoding:'base64'}]);
  const account=read?.value?.[0];if(!account)return [];
  if(account.owner!==p.PUMP_PROGRAM_ID)throw Error('PUBLIC_CURVE_OWNER');
  const c=p.decodePumpBondingCurve(Buffer.from(account.data[0],'base64'));
  if(!c.complete||!c.quoteMint||c.quoteMint===SOL)return [];
  const targetPool=await p.canonicalPumpSwapPoolAddress(mint,c.quoteMint);
  const hints=await candidates.pools(c.quoteMint);
  const addresses=[...new Set([await p.canonicalPumpSwapPoolAddress(c.quoteMint,SOL),...hints])];
  if(addresses.length>41)throw Error('PUBLIC_DISCOVERY_BOUND');
  const headers=await rpc.call('getMultipleAccounts',[addresses,{commitment:'finalized',encoding:'base64'}]);
  if(headers?.value?.length!==addresses.length||!Number.isSafeInteger(headers?.context?.slot))throw Error('PUBLIC_DISCOVERY_INCOMPLETE');
  const bindings=[];
  for(let i=0;i<addresses.length;i++){
   const a=headers.value[i];if(a?.owner!==p.PUMP_AMM_PROGRAM_ID)continue;
   try{const pool=p.decodePumpSwapPool(Buffer.from(a.data[0],'base64'));if((pool.baseMint===c.quoteMint&&pool.quoteMint===SOL)||(pool.quoteMint===c.quoteMint&&pool.baseMint===SOL))bindings.push({mint,quoteMint:c.quoteMint,targetPool,bridgePool:addresses[i]});}catch{/* An unknown candidate is not a supported pool. No balance effects are being replayed. */}
  }
  if(bindings.length>16)throw Error('PUBLIC_EXECUTABLE_CANDIDATE_BOUND');
  const captures=await Promise.allSettled(bindings.map(async b=>{const s=await h.captureCurrentPumpRoute(rpc,archive,b);
   const check=h.currentQuoteRouter({enabled:true,baseline,mints:[mint],snapshots:async()=>[s],permission:async()=>({discover:true,buy:false})});
   await check.prospective(mint);return s;
  }));
  return captures.filter(r=>r.status==='fulfilled').map(r=>r.value);
 }
 return async mint=>{
  // Native PumpSwap bridges first; the preserved router supplies independently verified Orca/composed paths.
  let pumpError;try{const s=await pump(mint);if(s.length)return s;}catch(e){pumpError=e;}
  try{const id=await baseline.mintResolver(mint);if(id.protocolId!=='GENERIC_PUMP_SWAP')return [];
   const loaded=await baseline.loadPositionRoute(id),s=loaded.state.normalizedState.stage1Snapshot;
   if(!s||s.mint!==mint)throw Error('PUBLIC_GENERIC_SNAPSHOT');await archive.bank(s);return[s];
  }catch(error){if(pumpError)throw pumpError;throw error;}
 };
}
