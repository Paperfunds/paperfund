import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
await build({entryPoints:['scripts/operator/claim-runtime.mjs'],bundle:true,platform:'node',format:'cjs',target:'node22',define:{'import.meta.url':JSON.stringify('file:///C:/PaperfundSigner/library.mjs')},outfile:'scripts/operator/claim-runtime.bundle.cjs'});
const {privateKey}=generateKeyPairSync('ed25519'),der=privateKey.export({type:'pkcs8',format:'der'});
try{
 const result=spawnSync(process.execPath,['scripts/operator/claim-runtime.bundle.cjs'],{input:JSON.stringify({mode:'CheckWallet',key:JSON.stringify([...der.subarray(-32)])}),encoding:'utf8',windowsHide:true});
 if(result.status!==1||result.stderr.trim().split(/\r?\n/).at(-1)!=='CLAIM_DPAPI_WALLET_MISMATCH')throw Error('CLAIM_BUNDLE_ENTRYPOINT_TEST_FAILED');
 console.log('Claim bundle built; disposable identity rejected as expected.');
}finally{der.fill(0);}
