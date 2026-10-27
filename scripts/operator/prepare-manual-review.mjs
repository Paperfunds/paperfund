import fs from 'node:fs';import path from 'node:path';import {prepareMainnetClaim} from './claim-review.mjs';import {READ_METHODS} from './discovery.mjs';
const allowed=new Set([...READ_METHODS,'getLatestBlockhash','getBlockHeight','getFeeForMessage','simulateTransaction']);
export async function prepareProtectedReview(endpoint){
 if(new URL(endpoint).protocol!=='https:')throw Error('CLAIM_HTTPS_REQUIRED');
 const attempt=async(method,params=[])=>{if(!allowed.has(method))throw Error('CLAIM_PREPARE_READ_ONLY');let response;try{response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});}catch{throw Error('CLAIM_RPC_UNAVAILABLE');}let b;try{b=await response.json();}catch{throw Error('CLAIM_RPC_RESPONSE_INVALID');}if(!response.ok||b.error)throw Error('CLAIM_RPC_REJECTED:'+method+':HTTP_'+response.status+':CODE_'+(Number.isInteger(b.error?.code)?b.error.code:0));return b.result;};
 const rpc=async(method,params=[])=>{for(let n=0;;n++){try{return await attempt(method,params);}catch(e){if(n>=4||!/CLAIM_RPC_UNAVAILABLE|HTTP_(429|5\d\d)|CODE_-3200[459]|CODE_-32016/.test(e.message))throw e;await new Promise(resolve=>setTimeout(resolve,500*2**n));}}};
 return prepareMainnetClaim({rpcOverride:rpc,persist:false});
}
if(process.argv[1]?.endsWith('prepare-manual-review.bundle.cjs')){
 const file=path.join(process.env.ProgramFiles,'PaperfundSigner','claim-rpc.json');
 Promise.resolve().then(()=>prepareProtectedReview(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')).endpoint)).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(/^CLAIM_[A-Z0-9_]+(?::[a-zA-Z0-9_:-]+)?$/.test(e.message)?e.message:'CLAIM_PREPARATION_FAILED');process.exitCode=1;});
}
