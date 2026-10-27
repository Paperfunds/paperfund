import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{createHash}from'node:crypto';import{createRequire}from'node:module';import{PublicKey}from'@solana/web3.js';
const require=createRequire(import.meta.url),p=require('@pump-fun/pump-sdk'),s=require('@pump-fun/pump-swap-sdk'),BN=require('bn.js');
const out=new URL('../../evidence/mainnet-verified/',import.meta.url);mkdirSync(out,{recursive:true});
// Read only the existing RPC setting. Never load dotenv or a signing runtime; do not retain URL credentials.
const env=readFileSync('C:/Users/stanp/Documents/ChatGPT/Paperfund-new/.env','utf8');
const endpoint=env.split(/\r?\n/).find(l=>l.startsWith('SOLANA_RPC_URL='))?.slice(15).trim().replace(/^(['"])(.*)\1$/,'$2')||'https://api.mainnet-beta.solana.com';
const allowed=new Set(['getGenesisHash','getVersion','getMultipleAccounts','getMinimumBalanceForRentExemption','getSignaturesForAddress','getTransaction','getSignatureStatuses','getSlot','getFirstAvailableBlock']);let id=0;const captures=[];
export async function rpc(method,params){if(!allowed.has(method))throw Error('RPC_METHOD_FORBIDDEN');const request={jsonrpc:'2.0',id:++id,method,params},at=new Date().toISOString();
 const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(25000)});const b=Buffer.from(await r.arrayBuffer()),file=`${String(id).padStart(4,'0')}-${method}.json`;writeFileSync(new URL(file,out),b,{flag:'wx'});
 captures.push({file,request,receivedAt:new Date().toISOString(),requestedAt:at,http:r.status,sha256:createHash('sha256').update(b).digest('hex')});writeFileSync(new URL('provenance.json',out),JSON.stringify({providerOrigin:new URL(endpoint).origin,transport:'HTTPS_READ_ONLY',providerFinancialQualification:'UNQUALIFIED',captures},null,2));
 const body=JSON.parse(b);if(!r.ok||body.error)throw Error(`RPC_FAILED:${method}:${r.status}:${body.error?.code}`);return body.result;}
const plain=v=>v==null?v:v.constructor?.name==='BN'?v.toString(10):typeof v.toBase58==='function'?v.toBase58():Array.isArray(v)?v.map(plain):typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
const mint=new PublicKey('3JVd8Z3kEEXBaBoZo9rcWk4MHJPSUAf6zAjvAF5spump'),supplied=new PublicKey('GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW');
const genesis=await rpc('getGenesisHash',[]);if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('WRONG_NETWORK');
await rpc('getVersion',[]);const firstAvailable=await rpc('getFirstAvailableBlock',[]);
const addresses={mint,curve:p.bondingCurvePda(mint),sharing:p.feeSharingConfigPda(mint),pool:p.canonicalPumpPoolPda(mint),global:p.GLOBAL_PDA,feeConfig:p.PUMP_FEE_CONFIG_PDA,ammGlobal:s.GLOBAL_CONFIG_PDA,ammFeeConfig:s.PUMP_AMM_FEE_CONFIG_PDA,supplied};
const batch=await rpc('getMultipleAccounts',[Object.values(addresses).map(x=>x.toBase58()),{encoding:'base64',commitment:'finalized'}]);
const accounts=Object.fromEntries(Object.keys(addresses).map((k,i)=>[k,batch.value[i]]));
function decode(key,owner,fn){const a=accounts[key];if(!a)return null;if(a.owner!==owner.toBase58()||a.executable)throw Error('ACCOUNT_OWNER:'+key);return fn({...a,data:Buffer.from(a.data[0],'base64'),owner:new PublicKey(a.owner)});}
const curve=decode('curve',p.PUMP_PROGRAM_ID,a=>p.PUMP_SDK.decodeBondingCurve(a));if(!curve)throw Error('CURVE_MISSING');
const global=decode('global',p.PUMP_PROGRAM_ID,a=>p.PUMP_SDK.decodeGlobal(a));
const fee=decode('feeConfig',p.PUMP_FEE_PROGRAM_ID,a=>p.PUMP_SDK.decodeFeeConfig(a));
const pool=decode('pool',p.PUMP_AMM_PROGRAM_ID,a=>s.PUMP_AMM_SDK.decodePool(a));
const sharing=decode('sharing',p.PUMP_FEE_PROGRAM_ID,a=>p.PUMP_SDK.decodeSharingConfig(a));
const ammGlobal=decode('ammGlobal',p.PUMP_AMM_PROGRAM_ID,a=>s.PUMP_AMM_SDK.decodeGlobalConfig(a));
const ammFee=decode('ammFeeConfig',p.PUMP_FEE_PROGRAM_ID,a=>s.PUMP_AMM_SDK.decodeFeeConfig(a));
const creator=curve.creator,vault=p.creatorVaultPda(creator),ammAuthority=s.coinCreatorVaultAuthorityPda(creator),quote=new PublicKey('So11111111111111111111111111111111111111112'),tokenProgram=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ammAta=s.coinCreatorVaultAtaPda(ammAuthority,quote,tokenProgram);
const vaultAddresses={creator,vault,ammAuthority,ammAta};const vaultBatch=await rpc('getMultipleAccounts',[Object.values(vaultAddresses).map(x=>x.toBase58()),{encoding:'base64',commitment:'finalized',minContextSlot:batch.context.slot}]);
const vaultAccount=vaultBatch.value[1],rent=await rpc('getMinimumBalanceForRentExemption',[vaultAccount?Buffer.from(vaultAccount.data[0],'base64').length:0,{commitment:'finalized'}]);
if(vaultAccount&&(vaultAccount.owner!=='11111111111111111111111111111111'||Buffer.from(vaultAccount.data[0],'base64').length!==0||vaultAccount.executable))throw Error('VAULT_OWNER');
let ammAmount=0n;if(vaultBatch.value[3]){const a=vaultBatch.value[3],data=Buffer.from(a.data[0],'base64');if(a.owner!==tokenProgram.toBase58()||data.length<165||!data.subarray(0,32).equals(quote.toBuffer())||!data.subarray(32,64).equals(ammAuthority.toBuffer()))throw Error('AMM_VAULT_IDENTITY');ammAmount=data.readBigUInt64LE(64);}
const rates=p.computeFeesBps({global,feeConfig:fee,mintSupply:curve.isMayhemMode?new BN(Buffer.from(accounts.mint.data[0],'base64').readBigUInt64LE(36).toString()):new BN('1000000000000000'),virtualQuoteReserves:curve.virtualQuoteReserves,virtualTokenReserves:curve.virtualTokenReserves,quoteMint:curve.quoteMint,creatorFeeBps:curve.creatorFeeBps});
const histories={};const unique=new Set();
for(const[key,address]of Object.entries({curve:addresses.curve,mint,pool:addresses.pool,vault,ammAta,sharing:addresses.sharing,supplied})){
 const rows=[];let before,exhausted=false;for(let page=0;page<10;page++){
  const r=await rpc('getSignaturesForAddress',[address.toBase58(),{limit:1000,commitment:'finalized',...(before?{before}: {})}]);rows.push(...r);for(const x of r)unique.add(x.signature);
  if(r.length<1000){exhausted=true;break;}before=r.at(-1).signature;
 }histories[key]={address:address.toBase58(),exhausted,rows};
}
writeFileSync(new URL('histories.json',out),JSON.stringify(histories,null,2));
const interesting=new Set(Object.entries(histories).filter(([k])=>k!=='supplied').flatMap(([,h])=>h.rows.map(x=>x.signature)));
// Wallet-only transactions can include external treasury deposits; retain them too, with a bounded explicit coverage hold.
for(const x of histories.supplied.rows)interesting.add(x.signature);
const txs=[];let fetched=0;for(const signature of interesting){if(fetched++>=300)break;const tx=await rpc('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);txs.push({signature,transaction:tx});}
writeFileSync(new URL('transactions.json',out),JSON.stringify(txs,null,2));
const summary={observedAt:new Date().toISOString(),genesis,network:'mainnet-beta',commitment:'finalized',firstAvailableBlock:firstAvailable,sourceSlot:batch.context.slot,vaultSlot:vaultBatch.context.slot,addresses:plain({...addresses,...vaultAddresses}),curve:plain(curve),sharing:plain(sharing),pool:plain(pool),global:plain(global),feeConfig:plain(fee),ammGlobal:plain(ammGlobal),ammFeeConfig:plain(ammFee),currentCurveFeeBps:plain(rates),vaultLamports:vaultAccount?.lamports??0,vaultRentMinimumLamports:rent,accruedBondingVaultExcessLamports:String(Math.max(0,(vaultAccount?.lamports??0)-rent)),accruedAmmWsolLamports:ammAmount.toString(),suppliedWalletMatchesCurveCreator:creator.equals(supplied),suppliedWalletAccount:accounts.supplied,suppliedWalletTreasuryDesignation:'NOT_AUTHORIZED_OR_PROVEN',historyRpcReportedExhausted:Object.values(histories).every(h=>h.exhausted),transactionCount:txs.length,transactionsMissing:txs.filter(t=>!t.transaction).length,transactionCaptureCapped:interesting.size>300,claimableScope:'CREATOR_AGGREGATE_VAULT_EXCESS_NOT_PER_MINT_TREASURY_CASH',providerFinancialQualification:'UNQUALIFIED'};
writeFileSync(new URL('summary.json',out),JSON.stringify(summary,null,2));console.log(JSON.stringify({creator:creator.toBase58(),sharing:summary.sharing,pool:summary.pool,curve:summary.curve,feeBps:summary.currentCurveFeeBps,vaultExcess:summary.accruedBondingVaultExcessLamports,ammWsol:summary.accruedAmmWsolLamports,historyCounts:Object.fromEntries(Object.entries(histories).map(([k,v])=>[k,v.rows.length])),captured:txs.length},null,2));
