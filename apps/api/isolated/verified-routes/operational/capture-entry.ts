// @ts-expect-error Bound by the guarded builder to the single reviewed shared runtime.
import {FinalizedRpc,FinalizedFlowConnector,FinalizedBankArchive,budgetedRpc,captureApprovedBank,publishCapture,validateCaptureScope} from 'paperfund-operational-runtime';
import {readFile} from 'node:fs/promises';import {isAbsolute,dirname} from 'node:path';import {createHash} from 'node:crypto';
if(process.argv.length!==10)throw Error('CAPTURE_ARGUMENTS');
const [configFile,configPin,scopeFile,scopePin,seedFile,seedPin,bankFile,receiptFile]=process.argv.slice(2) as [string,string,string,string,string,string,string,string];
if(![configFile,scopeFile,seedFile,bankFile,receiptFile].every(p=>p&&isAbsolute(p)))throw Error('CAPTURE_ABSOLUTE_PATHS');
async function pinned(file:string,pin:string){if(!/^[a-f0-9]{64}$/.test(pin??''))throw Error('CAPTURE_PIN');const raw=await readFile(file);if(createHash('sha256').update(raw).digest('hex')!==pin)throw Error('CAPTURE_HASH');return JSON.parse(raw.toString())}
const scope=validateCaptureScope(await pinned(scopeFile,scopePin)),record=await pinned(seedFile,seedPin),seed=record.document??record,config=await pinned(configFile,configPin);
const rpc=budgetedRpc(new FinalizedRpc(config.SOLANA_RPC_URL,Number(config.SOLANA_RPC_TIMEOUT_MS??15000)),scope.maxRpcCalls,Date.parse(scope.expiresAt));
const connector=new FinalizedFlowConnector(rpc,new FinalizedBankArchive(dirname(bankFile)),Date.now,{maxSlots:scope.maxSlots,maxTransactions:scope.maxTransactions});
await publishCapture(bankFile,receiptFile,await captureApprovedBank(seed,scope,connector));console.log(JSON.stringify({captured:true,bankFile,receiptFile,tradeExecuted:false}));
