import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';
const dir=new URL('../../evidence/mainnet-verified/',import.meta.url),m=JSON.parse(readFileSync(new URL('provenance.json',dir))),txs=JSON.parse(readFileSync(new URL('transactions.json',dir)));
const setting=readFileSync('C:/Users/stanp/Documents/ChatGPT/Paperfund-new/.env','utf8').split(/\r?\n/).find(l=>l.startsWith('SOLANA_RPC_URL='));const endpoint=setting.slice(15).trim().replace(/^(['"])(.*)\1$/,'$2');
for(const[method,params]of [['getSignatureStatuses',[txs.map(t=>t.signature),{searchTransactionHistory:true}]],['getSlot',[{commitment:'finalized'}]]]){
 const request={jsonrpc:'2.0',id:m.captures.length+1,method,params},requestedAt=new Date().toISOString(),r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(25000)}),bytes=Buffer.from(await r.arrayBuffer());const body=JSON.parse(bytes);if(!r.ok||body.error)throw Error('READONLY_FINALITY_FAILED');
 const file=`${String(request.id).padStart(4,'0')}-${method}.json`;writeFileSync(new URL(file,dir),bytes,{flag:'wx'});m.captures.push({file,request,requestedAt,receivedAt:new Date().toISOString(),http:r.status,sha256:createHash('sha256').update(bytes).digest('hex')});
}
writeFileSync(new URL('provenance.json',dir),JSON.stringify(m,null,2));console.log('Retained historical signature statuses and finalized tip.');
