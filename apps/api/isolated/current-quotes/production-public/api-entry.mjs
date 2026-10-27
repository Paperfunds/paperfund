import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';
import * as h from'./current-quote-runtime.mjs';
import * as p from'./packages/protocols/dist/index.js';
import{parseApplicationEnvironment}from'./packages/config/dist/index.js';
import{createRedis}from'./redis.mjs';
import{composeProduction,validateProfile,publicCapability,installPublicOnboarding}from'./policy.mjs';
import{currentSnapshots}from'./discovery.mjs';
import{installDrain}from'./drain.mjs';
const[file,pin]=process.argv.slice(2),raw=fs.readFileSync(file);
if(createHash('sha256').update(raw).digest('hex')!==pin)throw Error('PRODUCTION_PROFILE_PIN');
const profile=validateProfile(JSON.parse(raw)),protectedConfig=parseApplicationEnvironment(process.env);
if(protectedConfig.API_HOST!=='127.0.0.1'||protectedConfig.API_PORT!==3000||!protectedConfig.PRIVATE_BETA_NON_PAYING||protectedConfig.PAYOUT_SIGNER_TYPE!=='DISABLED'||protectedConfig.PAYOUT_EXECUTION_ENABLED)throw Error('PUBLIC_PAPER_SAFETY_CONFIG');
if(!path.isAbsolute(profile.archiveDirectory)||!path.isAbsolute(profile.controlDirectory))throw Error('PUBLIC_EVIDENCE_PATHS');
// Deliberately scoped to this reviewed entry; protected files and unrelated services are unchanged.
const config={...protectedConfig,BETA_INVITE_ONLY:false};
const base=h.createDatabase(config.DATABASE_URL),cap=publicCapability(base,profile,{operatorIds:config.GENERIC_PUMPSWAP_OPERATOR_USER_IDS,actor:p.genericActor});
const baseline=h.createProductionExecutionRouter({rpcUrl:config.SOLANA_RPC_URL,rpcTimeoutMs:config.SOLANA_RPC_TIMEOUT_MS,commitment:'finalized',genericPumpSwapEnabled:true,genericPumpSwapBuysEnabled:true,genericAccessResolver:(mint,quote,settlement)=>cap.resolve(mint,quote,settlement),nonSolPumpSwapEnabled:config.NON_SOL_PUMPSWAP_ENABLED,nonSolPumpSwapRoutes:config.NON_SOL_PUMPSWAP_ALLOWED_ROUTES});
const rpc=new h.FinalizedRpc(config.SOLANA_RPC_URL,config.SOLANA_RPC_TIMEOUT_MS),archive=new h.FinalizedBankArchive(profile.archiveDirectory,true);
const scoped=composeProduction(h,{database:base,baseline,profile,capability:cap,actor:p.genericActor,snapshots:currentSnapshots(h,p,rpc,archive,baseline)});
const redis=createRedis(config.REDIS_URL),auth=new h.AuthService(scoped.database,redis,config.AUTH_CHALLENGE_TTL_SECONDS,config.AUTH_SESSION_TTL_SECONDS),competition=new h.CompetitionService(scoped.database,scoped.router,()=>new Date(),{allocationMode:config.REWARD_ALLOCATION_MODE,baselineWindow:config.REWARD_BASELINE_WINDOW,lambdaBps:BigInt(config.REWARD_LAMBDA_BPS),configurationVersion:'phase-5a-v1'},undefined,{maxConcurrent:config.ADVISORY_MAX_CONCURRENT,backgroundConcurrent:config.ADVISORY_BACKGROUND_CONCURRENT},true),app=h.buildApp({config,database:scoped.database,redis,auth,competition,genericCapability:cap});
installPublicOnboarding(app,competition);
let closing,detach=()=>{};const close=()=>closing??=(async()=>{await app.close();await redis.close();await base.close();detach()})();
detach=installDrain(profile.controlDirectory,'api',close);process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
try{await app.listen({host:config.API_HOST,port:config.API_PORT});console.log(JSON.stringify({event:'PUBLIC_PAPER_API_READY',pid:process.pid,nonPaying:true,admission:profile.admission,authenticationRequired:true}));}catch(e){await close();throw e;}
