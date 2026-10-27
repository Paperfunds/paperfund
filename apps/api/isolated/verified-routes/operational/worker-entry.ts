// Existing competition lifecycle and reward finalization, with persisted mixed participant and a drained tick.
// @ts-expect-error The artifact builder binds this name to the same shared runtime as the API.
import {parseApplicationEnvironment,loadScope,prepareOperational,runHourlyLifecycleTick,runRewardFinalizationTick,runDailyRewardFinalizationTick,safeWorkerErrorMessage,workerDiagnosticJson,installDrain} from 'paperfund-operational-runtime';
import {mkdir,writeFile,rename} from 'node:fs/promises';import{dirname}from'node:path';
const config=parseApplicationEnvironment(process.env),scope=await loadScope(process.argv[2],process.argv[3]);
const runtime=await prepareOperational(config,scope,'worker');
let stopping=false,timer:ReturnType<typeof setTimeout>|undefined,inFlight:Promise<void>|undefined,draining:Promise<void>|undefined,stopControl:()=>void=()=>{};
const heartbeat={processId:process.pid,startedAt:new Date().toISOString(),lastTickStartedAt:null as string|null,lastTickCompletedAt:null as string|null,lastLifecycleSuccessAt:null as string|null,lastError:null as {at:string;scope:string;message:string}|null,genericPumpSwapEntriesArmed:false,buyAdmission:'DENY_ALL_BUY',mixedRuntimeActive:true,observation:runtime.observation};
async function writeHeartbeat(){const temp=scope.heartbeatFile+'.'+process.pid+'.tmp';await mkdir(dirname(scope.heartbeatFile),{recursive:true});await writeFile(temp,workerDiagnosticJson(heartbeat)+'\n',{mode:0o600});await rename(temp,scope.heartbeatFile);}
function log(event:string,extra:object={}){console.log(workerDiagnosticJson({event,...extra,timestamp:new Date().toISOString()}));}
async function tick(){heartbeat.lastTickStartedAt=new Date().toISOString();try{
 const now=new Date(),events=await runHourlyLifecycleTick(runtime.database,runtime.router,now,config.REWARD_FINALIZATION_GRACE_SECONDS);
 for(const roundId of await runRewardFinalizationTick(runtime.database,now,{allocationMode:config.REWARD_ALLOCATION_MODE,baselineWindow:config.REWARD_BASELINE_WINDOW,lambdaBps:BigInt(config.REWARD_LAMBDA_BPS),configurationVersion:'phase-5a-v1'}))log('reward_pool_frozen',{roundId});
 for(const dailyCompetitionId of await runDailyRewardFinalizationTick(runtime.database,now))log('daily_reward_pool_frozen',{dailyCompetitionId});
 for(const event of events)log(event.type.toLowerCase(),event);
 const failure=events.find((e:{type:string})=>e.type==='SETTLEMENT_OPERATIONAL_ERROR');
 if(failure)heartbeat.lastError={at:new Date().toISOString(),scope:'settlement',message:failure.roundId+': '+(failure.failureDetails?.[0]?.message??'Settlement requires REVIEW')};
 else{heartbeat.lastError=null;heartbeat.lastLifecycleSuccessAt=new Date().toISOString();}
 heartbeat.lastTickCompletedAt=new Date().toISOString();
 }catch(e){heartbeat.lastError={at:new Date().toISOString(),scope:'round_lifecycle',message:safeWorkerErrorMessage(e,'Worker failure')};}
 finally{await writeHeartbeat();if(!stopping)timer=setTimeout(schedule,config.WORKER_TICK_INTERVAL_MS);}}
function schedule(){inFlight=tick();void inFlight.catch(()=>{stopping=true;console.error('WORKER_HEARTBEAT_WRITE_FAILED');});}
const drain=()=>draining??=(async()=>{stopping=true;if(timer)clearTimeout(timer);await runtime.stopObservation();await inFlight;await runtime.database.close();stopControl();log('mixed_worker_drained');})();
stopControl=installDrain(scope.controlDirectory,'worker',drain);
process.once('SIGINT',()=>void drain());process.once('SIGTERM',()=>void drain());
log('mixed_worker_started',{pid:process.pid,buyAdmission:'DENY_ALL_BUY',scopeCount:scope.scopes.length});runtime.startObservation();schedule();
