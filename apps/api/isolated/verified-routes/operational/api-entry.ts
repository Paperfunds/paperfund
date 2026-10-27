// @ts-expect-error The artifact builder binds this exact name to its single reviewed shared runtime.
import {parseApplicationEnvironment,loadScope,prepareOperational,AuthService,createRedis,buildApp,installDrain} from 'paperfund-operational-runtime';
const config=parseApplicationEnvironment(process.env), scope=await loadScope(process.argv[2],process.argv[3]);
const runtime=await prepareOperational(config,scope,'api');
const redis=createRedis(config.REDIS_URL);
const auth=new AuthService(runtime.database,redis,config.AUTH_CHALLENGE_TTL_SECONDS,config.AUTH_SESSION_TTL_SECONDS);
const app=buildApp({config,database:runtime.database,redis,auth,competition:runtime.competition,genericCapability:runtime.capability});
let draining:Promise<void>|undefined,stopControl:()=>void=()=>{};
const drain=()=>draining??=(async()=>{await app.close();await runtime.stopObservation();await redis.close();await runtime.database.close();stopControl();})();
stopControl=installDrain(scope.controlDirectory,'api',drain);
process.once('SIGINT',()=>void drain());process.once('SIGTERM',()=>void drain());
try{await app.listen({host:config.API_HOST,port:config.API_PORT});console.log(JSON.stringify({event:'mixed_api_started',pid:process.pid,buyAdmission:'DENY_ALL_BUY',scopeCount:scope.scopes.length}));}
catch(e){await drain();throw e;}
