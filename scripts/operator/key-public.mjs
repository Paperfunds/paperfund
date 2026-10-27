// Built-in Ed25519 only. Secret input is accepted only through stdin, never arguments.
import {createPrivateKey,createPublicKey,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function decode58(s){
 if(typeof s!=='string'||s.length<1||s.length>128||[...s].some(c=>!alphabet.includes(c)))throw Error('KEY_INVALID_BASE58_ENCODING');
 let n=0n;for(const c of s)n=n*58n+BigInt(alphabet.indexOf(c));
 const out=[];while(n>0n){out.unshift(Number(n%256n));n/=256n;}
 let zeros=0;while(s[zeros]==='1')zeros++;
 return Buffer.concat([Buffer.alloc(zeros),Buffer.from(out)]);
}
export function encode58(b){
 let n=BigInt('0x'+b.toString('hex')),s='';while(n>0n){s=alphabet[Number(n%58n)]+s;n/=58n;}
 let zeros=0;while(zeros<b.length&&b[zeros]===0)zeros++;
 return '1'.repeat(zeros)+s;
}
export function derivePublic(input){
 let bytes,der;
 try{
  if(typeof input!=='string'||!input.trim())throw Error('KEY_EMPTY_INPUT');
  if(input.length>8192)throw Error('KEY_INPUT_TOO_LONG');
  const text=input.trim();
  if(text.startsWith('[')){
   let values;try{values=JSON.parse(text);}catch{throw Error('KEY_INVALID_JSON_ENCODING');}
   if(!Array.isArray(values)||values.some(v=>!Number.isInteger(v)||v<0||v>255))throw Error('KEY_JSON_REQUIRES_BYTE_ARRAY');
   bytes=Buffer.from(values);values.fill(0);
  }else bytes=decode58(text);
  if(![32,64].includes(bytes.length))throw Error('KEY_BYTE_LENGTH_EXPECTED_32_OR_64');
  der=Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),bytes.subarray(0,32)]);
  const key=createPrivateKey({key:der,format:'der',type:'pkcs8'}),pub=createPublicKey(key).export({format:'der',type:'spki'}).subarray(-32);
  if(bytes.length===64&&!timingSafeEqual(pub,bytes.subarray(32)))throw Error('KEY_EMBEDDED_PUBLIC_KEY_INCONSISTENT');
  return encode58(pub);
 }finally{bytes?.fill(0);der?.fill(0);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let input='';process.stdin.setEncoding('utf8');
 process.stdin.on('data',chunk=>{input+=chunk;if(input.length>8192){console.error('KEY_INPUT_TOO_LONG');process.exit(2);}});
 process.stdin.on('end',()=>{
  try{console.log(derivePublic(input));}
  catch(e){console.error(/^KEY_[A-Z0-9_]+$/.test(e.message)?e.message:'KEY_VALIDATION_FAILED');process.exitCode=2;}
  finally{input='';}
 });
}
