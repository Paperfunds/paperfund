import {generateKeyPairSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import bs58 from 'bs58';
const pair=generateKeyPairSync('ed25519');
const publicKey=bs58.encode(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
const result=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--reporter=json'],{encoding:'utf8',env:{...process.env,
 DATABASE_URL:'postgresql://beta:disposable-beta-only@127.0.0.1:55462/beta',PAPERFUND_E2E_PORT:'3019',
 PAPERFUND_E2E_SECOND_PUBLIC_KEY:publicKey,PAPERFUND_E2E_SECOND_PRIVATE_KEY:pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64')}});
// Ephemeral fixture keys stay in process memory/environment and never enter evidence.
const {writeFileSync}=await import('node:fs');writeFileSync(new URL('../../evidence/two-browser-tests.json',import.meta.url),result.stdout);
if(result.stderr)console.error(result.stderr);process.exitCode=result.status??1;
