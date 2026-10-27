import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';
import{parseApplicationEnvironment}from'./packages/config/dist/index.js';import{validateProfile}from'./policy.mjs';
const[file,pin]=process.argv.slice(2),raw=fs.readFileSync(file);
if(createHash('sha256').update(raw).digest('hex')!==pin)throw Error('WORKER_PROFILE_PIN');
const profile=validateProfile(JSON.parse(raw)),config=parseApplicationEnvironment(process.env);
if(!config.PRIVATE_BETA_NON_PAYING||config.PAYOUT_EXECUTION_ENABLED||config.PAYOUT_SIGNER_TYPE!=='DISABLED'||!path.isAbsolute(profile.controlDirectory))throw Error('WORKER_NONPAYING_REQUIRED');
process.env.PAPERFUND_QUOTE_CONTROL_DIRECTORY=profile.controlDirectory;
await import('./apps/worker/dist/index.mjs');
