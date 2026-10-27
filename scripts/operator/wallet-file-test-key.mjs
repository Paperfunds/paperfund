// Generates ONLY disposable test material, returned through an anonymous stdout pipe.
import {generateKeyPairSync} from 'node:crypto';
import {encode58} from './key-public.mjs';
if(process.stdout.isTTY)throw Error('TEST_ANONYMOUS_PIPE_REQUIRED');
const pair=generateKeyPairSync('ed25519'),seed=pair.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32),pub=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32);
const bytes=Buffer.concat([seed,pub]),bad=Buffer.from(bytes);bad[63]^=1;
const other=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).subarray(-32);
try{process.stdout.write(JSON.stringify({publicAddress:encode58(pub),otherPublicAddress:encode58(other),seed58:encode58(seed),pair58:encode58(bytes),seedJson:JSON.stringify([...seed]),pairJson:JSON.stringify([...bytes],null,2),badPair58:encode58(bad)}));}
finally{seed.fill(0);bytes.fill(0);bad.fill(0);}
