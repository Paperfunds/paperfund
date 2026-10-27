import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import {derivePublic,encode58} from './key-public.mjs';
import {derivePublic as previousDerive} from '../../backups/importer-file-workflow-20261020/key-public.mjs';
function fixture(){const p=generateKeyPairSync('ed25519');const seed=p.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32),pub=p.publicKey.export({format:'der',type:'spki'}).subarray(-32);return {seed,bytes:Buffer.concat([seed,pub]),address:encode58(pub)};}
test('original installed decoder reproduces misleading rejection of 32-byte Phantom-compatible base58 seed',()=>{const f=fixture();try{assert.equal(previousDerive(encode58(f.bytes)),f.address);assert.throws(()=>previousDerive(encode58(f.seed)),/INVALID_SOLANA_KEYPAIR/);}finally{f.seed.fill(0);f.bytes.fill(0);}});
test('32/64-byte base58 and JSON derive the same independent web3 address',()=>{const f=fixture();try{assert.equal(Keypair.fromSeed(f.seed).publicKey.toBase58(),f.address);for(const input of [encode58(f.seed),encode58(f.bytes),JSON.stringify([...f.seed]),JSON.stringify([...f.bytes],null,2),encode58(f.bytes)+'\r\n'])assert.equal(derivePublic(input),f.address);}finally{f.seed.fill(0);f.bytes.fill(0);}});
test('distinct safe encoding, length and embedded-public errors',()=>{const f=fixture();try{assert.throws(()=>derivePublic('0OIl!'),/KEY_INVALID_BASE58_ENCODING/);assert.throws(()=>derivePublic('[1,'),/KEY_INVALID_JSON_ENCODING/);assert.throws(()=>derivePublic('[1,2]'),/KEY_BYTE_LENGTH_EXPECTED_32_OR_64/);f.bytes[63]^=1;assert.throws(()=>derivePublic(encode58(f.bytes)),/KEY_EMBEDDED_PUBLIC_KEY_INCONSISTENT/);}finally{f.seed.fill(0);f.bytes.fill(0);}});
