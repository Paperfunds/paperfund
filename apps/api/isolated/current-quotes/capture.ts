/** Existing RPC only, coherent CURRENT bank. No flow intervals or checkpoint lineage. */
import type {ReadOnlyRpc} from '../verified-routes/finalized-connector.js';
import {FinalizedBankArchive} from '../verified-routes/finalized-connector.js';
import {decodePumpSwapPool,pumpSwapGlobalConfigAddress,pumpSwapFeeConfigAddress,PUMP_AMM_PROGRAM_ID} from '../../../../packages/protocols/src/pump-swap.js';
import {pumpBondingCurveAddress,WRAPPED_SOL_MINT} from '../../../../packages/protocols/src/pump-fun.js';
import type {LinkedBinding} from '../../../../packages/protocols/isolated/linked-pair/shared-bridge.js';
import type {Stage1Snapshot} from '../../../../packages/protocols/src/experimental/non-sol-pump-swap.js';
const clock='SysvarC1ock11111111111111111111111111111111';
export async function captureCurrentPumpRoute(rpc:ReadOnlyRpc,archive:FinalizedBankArchive,binding:LinkedBinding,now=Date.now):Promise<Stage1Snapshot>{
 const header=await rpc.call<any>('getMultipleAccounts',[[binding.targetPool,binding.bridgePool],{commitment:'finalized',encoding:'base64'}]);
 if(!Number.isSafeInteger(header?.context?.slot)||header.value?.some((a:any)=>a?.owner!==PUMP_AMM_PROGRAM_ID)||header.value?.length!==2)throw Error('CURRENT_PUMP_BRIDGE_UNAVAILABLE');
 const descriptors=header.value.map((a:any)=>decodePumpSwapPool(Buffer.from(a.data[0],'base64')));
 const addresses=[...new Set([binding.targetPool,binding.bridgePool,binding.mint,binding.quoteMint,WRAPPED_SOL_MINT,...descriptors.flatMap((p:any)=>[p.baseVault,p.quoteVault]),...(binding.quoteMint!==WRAPPED_SOL_MINT?[await pumpBondingCurveAddress(binding.mint)]:[]),await pumpSwapGlobalConfigAddress(),await pumpSwapFeeConfigAddress(),clock])].sort();
 for(let attempt=0;attempt<3;attempt++){
  const r=await rpc.call<any>('getMultipleAccounts',[addresses,{commitment:'finalized',encoding:'base64',minContextSlot:header.context.slot}]);
  if(!Number.isSafeInteger(r?.context?.slot)||r.context.slot<header.context.slot||r.value?.length!==addresses.length||r.value.some((a:any)=>!a||a.data?.[1]!=='base64'))throw Error('CURRENT_ROUTE_INCOMPLETE');
  const c=r.value[addresses.indexOf(clock)],raw=Buffer.from(c.data[0],'base64');if(c.owner!=='Sysvar1111111111111111111111111111111111111'||raw.length!==40||raw.readBigUInt64LE(0)!==BigInt(r.context.slot)){if(attempt<2)continue;throw Error('CURRENT_CLOCK_CONTEXT')}
  const at=Number(raw.readBigInt64LE(32))*1000;if(at>now()||now()-at>10000)throw Error('CURRENT_ROUTE_STALE');
  const s:Stage1Snapshot={version:'NON_SOL_PUMPSWAP_STAGE1_V1',...binding,slot:r.context.slot,observedAt:new Date(at).toISOString(),accounts:Object.fromEntries(addresses.map((a,i)=>[a,{owner:r.value[i].owner,base64:r.value[i].data[0]}])),absentAccounts:[]};
  // Retains exact coherent evidence; this is not a historical recovery or PAPER liquidity successor.
  await archive.bank(s);return s;
 }
 throw Error('CURRENT_CLOCK_CONTEXT');
}
