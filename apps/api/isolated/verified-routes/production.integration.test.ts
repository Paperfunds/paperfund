import { compositeInterval } from '../../../../packages/protocols/isolated/linked-pair/remaining-fixtures.js';
import {currentQuoteRouter} from '../current-quotes/router.js';
import {CompetitionService} from '../../src/competition.js';
import { fork } from 'node:child_process';
import {execFileSync} from 'node:child_process';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { AuthService as ActualAuthService } from '../../src/auth.js';
import type { RedisService } from '../../src/redis.js';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import {
  curvePayoutSpec,
  controlledCurvePayoutInterval,
} from '../../../../packages/protocols/isolated/linked-pair/curve-payout-fixtures.js';
import { CURVE } from '../../../../packages/protocols/isolated/linked-pair/mixed-fixtures.js';
import { identifier } from '@paperfund/core';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
// Source composition tests must exercise source financial exports, not a stale workspace dist.
// Frozen production tests import their separately pinned relative runtime and are unaffected.
vi.mock('@paperfund/db',async(importOriginal)=>({...await importOriginal<object>(),...await import('../../../../packages/db/src/financial-service.js')}));
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createProductionExecutionRouter } from '../../../../packages/protocols/src/production.js';
import { withGenericActor } from '../../../../packages/protocols/src/generic-access-context.js';
import { createDatabase, type DatabaseService } from '../../../../packages/db/src/database.js';
import {
  createUser,
  createAsset,
  createMarket,
  createDailyCompetition,
  createHourlyRound,
  initializeCompetitionAccount,
  reconcileAccountLedger,
  createOrder,
  applyFill,
  executePaperBuy,
  assertPaperBuyAdmission,
} from '../../../../packages/db/src/financial-service.js';
import {
  LinkedStateStore,
  installLinkedTestSchema,
} from '../../../../packages/db/isolated/linked-pair/store.js';
import { linkedBindings } from '../../../../packages/protocols/isolated/linked-pair/shared-bridge.js';
import { genericPumpSwapIdentity } from '../../../../packages/protocols/src/generic-pump-swap.js';
import {
  digest,
  type ProviderInterval,
} from '../../../../packages/protocols/isolated/linked-pair/external-flow.js';
import { controlledMixedInterval } from '../../../../packages/protocols/isolated/linked-pair/mixed-fixtures.js';
import {
  controlledAutomaticRoutes,
  controlledOrcaMovement,
} from '../../../../packages/protocols/isolated/linked-pair/route-movement-fixtures.js';
import { recordedPumpState } from '../../../../packages/protocols/test/fixtures/pump-real-chain.js';
import type { Stage1Snapshot } from '../../../../packages/protocols/src/experimental/non-sol-pump-swap.js';
import { buildApp } from '../../src/app.js';
import type { AuthService } from '../../src/auth.js';
import { composeScopedProduction } from './production-composition.js';
import {
  FinalizedBankArchive,
  FinalizedFlowConnector,
  type ReadOnlyRpc,
} from './finalized-connector.js';
config({ path: resolve('.env'), quiet: true });
it('current-quote isolated API uses the existing ledger for BUY partial/full SELL, duplicate effects and market-scoped failures on all terminals',async()=>{
 const evidence=JSON.parse(gunzipSync(readFileSync('docs/linked-pair-20261024/local-extension-test/provider-461064713-461064721-token2022.json.gz')).toString()) as ProviderInterval;
 if(!(await db.pool.query("select 1 from daily_competitions where utc_date='2026-10-25'")).rowCount)await createDailyCompetition(db,{id:'current-quote-day',utcDate:'2026-10-25',startsAt:new Date('2026-10-25T00:00:00Z'),endsAtExclusive:new Date('2026-10-26T00:00:00Z')});
 const f=await setup([evidence],'ENTRY');await f.app.close();let missing=false;
 const current=currentQuoteRouter({enabled:true,baseline:f.baseline,mints:[f.s.mint],snapshots:async()=>missing?[]:[structuredClone(evidence.before)],now:()=>f.now.value,permission:async()=>({discover:true,buy:true}),peakQuantity:async()=>{const r=await db.pool.query("select coalesce(sum(f.base_quantity),0)::text n from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1 and f.side='BUY'",[f.account]);return BigInt(r.rows[0].n)}});
 const competition=new CompetitionService(db,current.router,()=>new Date(f.now.value),undefined,undefined,undefined,true),app=buildApp({config:{LOG_LEVEL:'silent',BETA_INVITE_ONLY:false,ALLOWED_ORIGINS:'https://axiom.trade,https://gmgn.ai,https://trade.padre.gg'},database:db,redis:{healthCheck:async()=>true},auth:{authenticate:async(token:string)=>token===f.user?{id:f.user,walletAddress:'wallet:test'}:null} as unknown as AuthService,competition,logger:false});
 const request=async(path:string,payload?:Record<string,string>,key=randomUUID(),origin='https://axiom.trade')=>{const r=await app.inject({method:payload?'POST':'GET',url:'/api/v1/'+path,headers:{authorization:'Bearer '+f.user,origin,'idempotency-key':key},...(payload?{payload}:{})});return{status:r.statusCode,body:r.json()}};
 try{for(const origin of ['https://axiom.trade','https://gmgn.ai','https://trade.padre.gg'])expect((await request('trades/buy-preflight?mint='+f.s.mint,undefined,randomUUID(),origin)).status).toBe(200);
 const key=randomUUID(),buy=await request('trades/buy',{mint:f.s.mint,paperSol:'0.01'},key);expect(buy.status,JSON.stringify(buy.body)).toBe(200);expect((await request('trades/buy',{mint:f.s.mint,paperSol:'0.01'},key)).body).toEqual(buy.body);
 const before=await reconcileAccountLedger(db,f.account);missing=true;expect((await request('trades/sell',{mint:f.s.mint,quantity:'ALL'})).status).not.toBe(200);expect(await reconcileAccountLedger(db,f.account)).toEqual(before);missing=false;
 const position=(await competition.getCurrentAccount(f.user))!.positions[0]!;expect((await request('trades/sell',{mint:f.s.mint,quantity:(BigInt(position.remaining_base_units)/4n).toString()})).status).toBe(200);const sellKey=randomUUID(),sell=await request('trades/sell',{mint:f.s.mint,quantity:'ALL'},sellKey);expect(sell.status,JSON.stringify(sell.body)).toBe(200);expect((await request('trades/sell',{mint:f.s.mint,quantity:'ALL'},sellKey)).body).toEqual(sell.body);expect((await competition.getCurrentAccount(f.user))!.positions).toHaveLength(0);expect((await reconcileAccountLedger(db,f.account)).reconciled).toBe(true);
 }finally{await app.close()}
},120000);
it('frozen production current-quote API scopes real BUY partial/full SELL, denies bypasses and holds even closed rounds across recovery',async()=>{
 const evidence=JSON.parse(gunzipSync(readFileSync('docs/linked-pair-20261024/local-extension-test/provider-461064713-461064721-token2022.json.gz')).toString()) as ProviderInterval;
 const f=await setup([evidence],'ENTRY');await f.app.close();
 const release=resolve('docs/operator-candidate/artifact-releases/current-quotes-paper-20261026-v1/runtime'),h=await import(pathToFileURL(release+'/current-quote-runtime.mjs').href),policy=await import(pathToFileURL(release+'/policy.mjs').href),protocols=await import(pathToFileURL(release+'/packages/protocols/dist/index.js').href);
 const owner='user:'+randomUUID().replaceAll('-','').padEnd(64,'0'),account='production-fixture:'+randomUUID(),wallet='wallet:'+randomUUID();await createUser(db,{id:owner,walletAddress:wallet});await initializeCompetitionAccount(db,{accountId:account,userId:owner,hourlyRoundId:f.round,idempotencyKey:'production-init:'+account});
 let mode='ENTRY';const profile={schema:'PAPERFUND_SCOPED_CURRENT_QUOTES_V1',approvalReference:'CONTROLLED_FIXTURE_NOT_PRODUCTION_AUTHORITY',nonPaying:true,routes:[{mint:f.s.mint}],grants:[{userId:owner,wallet,mints:[f.s.mint],roundId:f.round,roundEndsAt:+f.cutoff,notBefore:f.now.value,expiresAt:Math.min(f.now.value+1800000,+f.cutoff),maxBuys:3,maxAggregateLamports:'30000000'}]};
 const control=(await db.pool.query("select value from app_meta where key='generic_pumpswap_operator_control_v1'")).rows[0];await db.pool.query("insert into app_meta(key,value) values('generic_pumpswap_operator_control_v1',$1) on conflict(key) do update set value=excluded.value",[JSON.stringify({schema:'GENERIC_OPERATOR_CONTROL_V1',mode:'ENTRY',expiresAt:f.now.value+1800000})]);
 const compose=()=>policy.composeProduction(h,{database:db,baseline:f.baseline,profile,capability:{status:async()=>({mode})},actor:protocols.genericActor,snapshots:async()=>[structuredClone(evidence.before)],now:()=>f.now.value});
 let scoped=compose();const service=new h.CompetitionService(scoped.database,scoped.router,()=>new Date(f.now.value),undefined,undefined,undefined,true),app=h.buildApp({config:{LOG_LEVEL:'silent',BETA_INVITE_ONLY:false,ALLOWED_ORIGINS:'chrome-extension://lcnpjpkojoadojibfbjfohpjepkfmdln,https://gmgn.ai'},database:scoped.database,redis:{healthCheck:async()=>true},auth:{authenticate:async(t:string)=>t===owner?{id:owner,walletAddress:wallet}:null},competition:service,logger:false});
 app.addHook('preHandler',async(req:any,reply:any)=>{if(req.method!=='POST'||req.url!=='/api/v1/trades/buy')return;try{scoped.admission.request({id:owner,walletAddress:wallet},req.body?.mint,req.body?.paperSol)}catch{return reply.code(403).send({error:{code:'PAPER_BUY_DISABLED'}})}});
 const request=async(path:string,payload?:object,key=randomUUID())=>{const r=await app.inject({method:payload?'POST':'GET',url:'/api/v1/'+path,headers:{authorization:'Bearer '+owner,origin:'chrome-extension://lcnpjpkojoadojibfbjfohpjepkfmdln','idempotency-key':key},...(payload?{payload}:{})});return{status:r.statusCode,body:r.json()}};
 try{const initial=await reconcileAccountLedger(db,account);for(const payload of[{mint:f.s.mint,paperSol:'0.02'},{mint:'2B9cEbjF2sNmDsfvcgMQGasvP7573GnaTu1s1Dy1pump',paperSol:'0.01'}])expect((await request('trades/buy',payload)).status).toBe(403);expect(await reconcileAccountLedger(db,account)).toEqual(initial);
 const key=randomUUID(),buy=await request('trades/buy',{mint:f.s.mint,paperSol:'0.01'},key);expect(buy.status,JSON.stringify(buy.body)).toBe(200);expect((await request('trades/buy',{mint:f.s.mint,paperSol:'0.01'},key)).body).toEqual(buy.body);
 mode='EXIT_ONLY';const after=await reconcileAccountLedger(db,account);expect((await request('trades/buy',{mint:f.s.mint,paperSol:'0.01'})).status).not.toBe(200);expect(await reconcileAccountLedger(db,account)).toEqual(after);
 f.now.value+=1000;const qty=BigInt(buy.body.tokenQuantityReceivedBaseUnits);expect((await request('trades/sell',{mint:f.s.mint,quantity:(qty/4n).toString()})).status).toBe(200);mode='HARD_STOP';const partial=await reconcileAccountLedger(db,account);expect((await request('trades/sell',{mint:f.s.mint,quantity:'ALL'})).status).not.toBe(200);expect(await reconcileAccountLedger(db,account)).toEqual(partial);mode='EXIT_ONLY';const sellKey=randomUUID(),sell=await request('trades/sell',{mint:f.s.mint,quantity:'ALL'},sellKey);expect(sell.status,JSON.stringify(sell.body)).toBe(200);expect((await request('trades/sell',{mint:f.s.mint,quantity:'ALL'},sellKey)).body).toEqual(sell.body);expect((await reconcileAccountLedger(db,account)).quantityFromFills).toBe(0n);
 f.now.value+=1000;mode='ENTRY';const parallel=await Promise.all([0,1,2].map(()=>request('trades/buy',{mint:f.s.mint,paperSol:'0.01'})));expect(parallel.filter(r=>r.status===200)).toHaveLength(2);expect(parallel.filter(r=>r.status!==200)).toHaveLength(1);f.now.value+=1000;mode='EXIT_ONLY';expect((await request('trades/sell',{mint:f.s.mint,quantity:'ALL'})).status).toBe(200);expect((await db.pool.query('select count(*)::int n from orders where competition_account_id=$1',[account])).rows[0].n).toBe(6);scoped=compose();expect((await reconcileAccountLedger(db,account)).reconciled).toBe(true);await h.runHourlyLifecycleTick(scoped.database,scoped.router,new Date(+f.cutoff+1000),60);expect((await db.pool.query('select state from hourly_rounds where id=$1',[f.round])).rows[0].state).toBe('SETTLING');expect((await db.pool.query('select count(*)::int n from hourly_results where competition_account_id=$1',[account])).rows[0].n).toBe(0);await h.runHourlyLifecycleTick(compose().database,compose().router,new Date(+f.cutoff+2000),60);expect((await db.pool.query('select count(*)::int n from fills where order_id in(select id from orders where competition_account_id=$1)',[account])).rows[0].n).toBe(6);
 }finally{await app.close();if(control)await db.pool.query("update app_meta set value=$1 where key='generic_pumpswap_operator_control_v1'",[control.value]);else await db.pool.query("delete from app_meta where key='generic_pumpswap_operator_control_v1'");}
},120000);
const CLOCK = 'SysvarC1ock11111111111111111111111111111111',
  SOL = 'So11111111111111111111111111111111111111112';
const read = (a: number, b: number): ProviderInterval =>
  JSON.parse(
    gunzipSync(
      readFileSync(`docs/linked-pair-20261021/external-flow-completion/provider-${a}-${b}.json.gz`),
    ).toString(),
  );
const real = [read(459758217, 459758224), read(459758224, 459758238)];
const seconds = (s: Stage1Snapshot) =>
  Number(Buffer.from(s.accounts[CLOCK]!.base64, 'base64').readBigInt64LE(32));
class RetainedRpc implements ReadOnlyRpc {
  bank: Stage1Snapshot;
  blocks = new Map<number, ProviderInterval['blocks'][number]['result']>();
  calls: { method: string; params: unknown[] }[] = [];
  mismatch = 0;
  constructor(intervals: ProviderInterval[]) {
    this.bank = structuredClone(intervals[0]!.before);
    for (const e of intervals) {
      if (!this.blocks.has(e.before.slot))
        this.blocks.set(e.before.slot, {
          parentSlot: e.before.slot - 1,
          previousBlockhash: 'controlled-anchor-parent',
          blockhash: e.anchor.blockhash,
          blockTime: seconds(e.before),
          transactions: [],
        });
      for (const b of e.blocks) this.blocks.set(b.slot, b.result);
    }
  }
  async call<T>(method: string, params: unknown[]): Promise<T> {
    this.calls.push({ method, params: structuredClone(params) });
    let result: unknown;
    if (method === 'getMultipleAccounts') {
      const addresses = params[0] as string[];
      result = {
        context: { slot: this.bank.slot + (this.mismatch-- > 0 ? 1 : 0) },
        value: addresses.map((a) => {
          const v = this.bank.accounts[a] as
            { owner: string; base64: string; lamports?: string } | undefined;
          return v
            ? { owner: v.owner, data: [v.base64, 'base64'], lamports: Number(v.lamports ?? '0') }
            : null;
        }),
      };
    } else if (method === 'getSlot') result = Math.max(...this.blocks.keys());
    else if (method === 'getBlocks')
      result = [...this.blocks.keys()]
        .filter((s) => s >= Number(params[0]) && s <= Number(params[1]))
        .sort((a, b) => a - b);
    else if (method === 'getBlock') result = this.blocks.get(Number(params[0])) ?? null;
    else throw Error('NO_NETWORK_METHOD:' + method);
    return structuredClone(result) as T;
  }
}
let db: DatabaseService, admin: Pool, dir: string, url: string;
// Explicit controlled-fixture authorization only. Production createDatabase defaults to deny.
let fixtureBuyAdmission: () => Promise<boolean> = async () => true;
const name = 'paperfund_linked_test_production_' + process.pid + '_' + Date.now();
beforeAll(async () => {
  const a = new URL(process.env.DATABASE_URL!);
  a.pathname = '/postgres';
  admin = new Pool({ connectionString: a.toString() });
  await admin.query('create database "' + name + '"');
  a.pathname = '/' + name;
  url = a.toString();
  db = createDatabase(url, { authorizePaperBuy: async () => fixtureBuyAdmission() });
  await migrate(db.client, { migrationsFolder: resolve('packages/db/migrations') });
  await installLinkedTestSchema(db.pool);
  dir = await mkdtemp(join(tmpdir(), 'paperfund-linked-production-'));
  await createDailyCompetition(db, {
    id: 'day',
    utcDate: '2026-10-21',
    startsAt: new Date('2026-10-21T00:00:00Z'),
    endsAtExclusive: new Date('2026-10-22T00:00:00Z'),
  });
  await createAsset(db, { id: 'sol', mintAddress: SOL, decimals: 9 });
}, 30000);
afterAll(async () => {
  vi.restoreAllMocks();
  if (db) await db.close();
  if (admin) {
    await admin.query('drop database "' + name + '" with(force)');
    await admin.end();
  }
  // This is a verified mkdtemp-owned directory, never a computed repository/deployment path.
  if (dir && dir.startsWith(join(tmpdir(), 'paperfund-linked-production-')))
    await rm(dir, { recursive: true, force: true });
});
async function setup(
  intervals: ProviderInterval[],
  mode: 'ENTRY' | 'EXIT_ONLY' = 'ENTRY',
  useBundle = false,
  walletAddress?: string,
  durableFlow = false,
  proofRecovery = false,
) {
  if(proofRecovery&&!(await db.pool.query("select to_regnamespace('linked_recovery_candidate') present")).rows[0].present)await db.pool.query(readFileSync('packages/db/isolated/linked-pair/proof-recovery.sql','utf8'));
  const id = randomUUID(),
    s = intervals[0]!.before,
    start = new Date(Math.floor(Date.parse(s.observedAt) / 3600000) * 3600000),
    cutoff = new Date(+start + 3600000),
    round = 'round:' + start.toISOString();
  if (!(await db.pool.query('select 1 from hourly_rounds where id=$1', [round])).rowCount)
    await createHourlyRound(db, {
      id: round,
      startsAt: start,
      endsAtExclusive: cutoff,
      state: 'OPEN',
      rulesVersion: 'production-shape-controlled',
    });
  const user = 'user:' + id,
    account = 'account:' + id;
  await createUser(db, { id: user, walletAddress: walletAddress ?? 'wallet:' + id });
  await initializeCompetitionAccount(db, {
    accountId: account,
    userId: user,
    hourlyRoundId: round,
    idempotencyKey: 'init:' + id,
  });
  for (const r of linkedBindings(s)) {
    const asset = 'asset:' + r.mint;
    if (!(await db.pool.query('select 1 from assets where id=$1', [asset])).rowCount)
      await createAsset(db, {
        id: asset,
        mintAddress: r.mint,
        decimals: r.mint === s.quoteMint ? 9 : 6,
      });
    const identity = genericPumpSwapIdentity(r.mint, r.quoteMint, r.bridgePool);
    if (!(await db.pool.query('select 1 from markets where id=$1', [identity.marketId])).rowCount)
      await createMarket(db, {
        id: identity.marketId,
        baseAssetId: asset,
        quoteAssetId: 'sol',
        venue: identity.protocolId,
        providerMarketId: identity.marketId,
      });
  }
  const store = new LinkedStateStore(db, account, round, durableFlow,proofRecovery);
  await store.initialize(s);
  const rpc = new RetainedRpc(intervals),
    archive = new FinalizedBankArchive(join(dir, id)),
    now = { value: Date.parse(s.observedAt) };
  // Seeding actual retained endpoint banks is explicit: standard RPC cannot refetch a historical bank.
  for (const e of intervals) {
    await archive.bank(e.before);
    await archive.bank(e.after);
  }
  const Connector:typeof FinalizedFlowConnector=useBundle&&process.env['PAPERFUND_ADMISSION_BUNDLE']?(await import(pathToFileURL(resolve(process.env['PAPERFUND_ADMISSION_BUNDLE'])).href)).FinalizedFlowConnector:FinalizedFlowConnector;
  const connector = new Connector(rpc, archive, () => now.value);
  const baseline = createProductionExecutionRouter({
    rpcUrl: 'https://offline.invalid',
    rpcTimeoutMs: 1000,
    commitment: 'finalized',
    genericPumpSwapEnabled: true,
    genericPumpSwapBuysEnabled: false,
  });
  const originalLoad = baseline.loadPositionRoute.bind(baseline);
  const resolver = vi.spyOn(baseline, 'loadPositionRoute');
  resolver.mockImplementation((...args) => originalLoad(...args));
  const scope = {
    accountId: account,
    userId: user,
    roundId: round,
    mints: [...new Set(linkedBindings(s).map((r) => r.mint))],
    approvalReference: 'CONTROLLED_FIXTURE_NOT_AUTHORIZATION',
    mode,
    connector,
    durableFlow,
    proofRecovery,
  };
  const permission = vi.fn(async () => ({
    discover: true,
    buy: true,
    authorizeLive: vi.fn(async () => undefined),
  }));
  const factory: typeof composeScopedProduction = useBundle
    ? (
        await import(
          pathToFileURL(
            resolve(
              process.env['PAPERFUND_ADMISSION_BUNDLE'] ??
                'docs/linked-pair-20261023/production-integration/production-routes.mjs',
            ),
          ).href
        )
      ).composeScopedProduction
    : composeScopedProduction;
  const compose = () =>
    factory({
      database: db,
      baselineRouter: baseline,
      scopes: [scope],
      now: () => now.value,
      resolvePermission: permission,
      competitionOptions: {
        chartFx: {
          lookup: async () => ({ status: 'UNAVAILABLE', reason: 'CONTROLLED_FX_DISABLED' }),
        },
        genericArmed: true,
      },
    });
  const runtime = await compose();
  const apiBuilder: typeof buildApp = useBundle
    ? (
        await import(
          pathToFileURL(
            resolve(
              process.env['PAPERFUND_ADMISSION_BUNDLE'] ??
                'docs/linked-pair-20261023/production-integration/production-routes.mjs',
            ),
          ).href
        )
      ).buildApp
    : buildApp;
  const app = apiBuilder({
    config: {
      LOG_LEVEL: 'silent',
      BETA_INVITE_ONLY: false,
      ALLOWED_ORIGINS: 'https://axiom.trade,https://gmgn.ai,https://trade.padre.gg',
    },
    database: runtime.database,
    redis: { healthCheck: async () => true },
    auth: {
      authenticate: async (token: string) =>
        token === user ? { id: user, walletAddress: 'wallet:' + id } : null,
    } as unknown as AuthService,
    competition: runtime.competition,
    logger: false,
  });
  const request = async (path: string, payload?: Record<string, string>, key = randomUUID()) => {
    const response = await app.inject({
      method: payload ? 'POST' : 'GET',
      url: '/api/v1/' + path,
      headers: { authorization: 'Bearer ' + user, 'idempotency-key': key },
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() };
  };
  return {
    s,
    user,
    account,
    round,
    cutoff,
    store,
    rpc,
    archive,
    now,
    connector,
    baseline,
    resolver,
    scope,
    permission,
    compose,
    runtime,
    app,
    request,
  };
}
const direct = (s: Stage1Snapshot) => ({
  ...s,
  linkedRoutes: [
    ...linkedBindings(s),
    { mint: s.quoteMint, quoteMint: SOL, targetPool: s.bridgePool, bridgePool: s.bridgePool },
  ],
});

async function recoveryFixture(file='provider-461064713-461064721-token2022.json.gz'){
 const evidence=JSON.parse(gunzipSync(readFileSync('docs/linked-pair-20261024/local-extension-test/'+file)).toString()) as ProviderInterval;
 if(!(await db.pool.query("select 1 from daily_competitions where utc_date='2026-10-25'")).rowCount)await createDailyCompetition(db,{id:'recovery-day',utcDate:'2026-10-25',startsAt:new Date('2026-10-25T00:00:00Z'),endsAtExclusive:new Date('2026-10-26T00:00:00Z')});
 const bundle=process.env['PAPERFUND_ADMISSION_BUNDLE'];
 const f=await setup([evidence],'ENTRY',!!bundle,undefined,true,true),original=structuredClone(evidence);delete original.token2022;
 if(bundle){const CompiledStore=(await import(pathToFileURL(resolve(bundle)).href)).LinkedStateStore as typeof LinkedStateStore;f.store=new CompiledStore(db,f.account,f.round,true,true)}
 return{...f,evidence,original};
}
it.each(['provider-461064713-461064721-token2022.json.gz','provider-461061044-461061048.json.gz'])('footprint projected evidence preserves API BUY, partial/full exits, durable accounting and restart for %s',async file=>{
 const evidence=JSON.parse(gunzipSync(readFileSync('docs/linked-pair-20261024/local-extension-test/'+file)).toString()) as ProviderInterval;
 if(!(await db.pool.query("select 1 from daily_competitions where utc_date='2026-10-25'")).rowCount)await createDailyCompetition(db,{id:'footprint-day',utcDate:'2026-10-25',startsAt:new Date('2026-10-25T00:00:00Z'),endsAtExclusive:new Date('2026-10-26T00:00:00Z')});
 const bundle=process.env['PAPERFUND_ADMISSION_BUNDLE'],f=await setup([evidence],'ENTRY',!!bundle,undefined,true);
 try{
  const project=bundle?(await import(pathToFileURL(resolve(bundle)).href)).projectRetainedInterval:(await import('./footprint-acquisition.js')).projectRetainedInterval;
  expect((await f.request('trades/buy',{mint:f.s.mint,paperSol:'0.01'})).status).toBe(200);
  const before=await reconcileAccountLedger(db,f.account),head=await f.store.load(),p=await project(head.document,evidence);
  expect((await f.store.advanceFlow(p)).advanced).toBe(true);expect((await f.store.advanceFlow(p)).advanced).toBe(false);
  expect(await reconcileAccountLedger(db,f.account)).toEqual(before);const after=await f.store.load();expect(digest(await f.store.recover())).toBe(after.state_hash);
  f.now.value=Date.parse(evidence.after.observedAt);f.rpc.bank=evidence.after;
  const position=(await f.runtime.competition.getCurrentAccount(f.user))!.positions[0]!;
  expect((await f.request('trades/sell',{mint:f.s.mint,quantity:(BigInt(position.remaining_base_units)/4n).toString()})).status).toBe(200);
  const key=randomUUID(),full=await f.request('trades/sell',{mint:f.s.mint,quantity:'ALL'},key);expect(full.status,JSON.stringify(full.body)).toBe(200);
  expect((await f.request('trades/sell',{mint:f.s.mint,quantity:'ALL'},key)).body).toEqual(full.body);
  expect((await f.runtime.competition.getCurrentAccount(f.user))!.positions).toHaveLength(0);expect((await reconcileAccountLedger(db,f.account)).reconciled).toBe(true);
 }finally{await f.app.close()}
},120000);
it.runIf(process.env['PAPERFUND_ADMISSION_BUNDLE']?.includes('build-9-dependency-candidate'))('compiled connector ignores off-path mint metadata without weakening extension checks or financial accounting',async()=>{
 const evidence=JSON.parse(gunzipSync(readFileSync('docs/linked-pair-20261024/local-extension-test/provider-461084262-461084270-metadata.json.gz')).toString()) as ProviderInterval;
 if(!(await db.pool.query("select 1 from daily_competitions where utc_date='2026-10-25'")).rowCount)await createDailyCompetition(db,{id:'off-path-day',utcDate:'2026-10-25',startsAt:new Date('2026-10-25T00:00:00Z'),endsAtExclusive:new Date('2026-10-26T00:00:00Z')});
 const f=await setup([evidence],'EXIT_ONLY',true,undefined,true);
 try{
  const before=await reconcileAccountLedger(db,f.account);f.rpc.bank=evidence.after;
  const complete=(await f.connector.interval(evidence.before,evidence.after))!;
  expect(complete.token2022).toBeUndefined();expect(complete.blocks).toEqual(evidence.blocks);
  expect(f.rpc.calls.filter(c=>c.method==='getMultipleAccounts')).toHaveLength(0);
  await f.store.advanceFlow(complete);expect((await f.store.advanceFlow(complete)).advanced).toBe(false);
  expect(await reconcileAccountLedger(db,f.account)).toEqual(before);
  const head=await f.store.load();expect(head.document.real).toEqual(evidence.after);expect(digest(await f.store.recover())).toBe(head.state_hash);
  f.now.value=Date.parse(evidence.after.observedAt);f.runtime.router.contextResolver=async mint=>mint;
  for(const binding of linkedBindings(evidence.after)){
    const preflight=await f.request('trades/buy-preflight?mint='+binding.mint);
    expect(preflight.status,JSON.stringify(preflight.body)).toBe(200);expect(preflight.body.marketSupported,JSON.stringify(preflight.body)).toBe(true);
  }
  expect((await db.pool.query('select count(*)::int n from orders where competition_account_id=$1',[f.account])).rows[0].n).toBe(0);
 }finally{await f.app.close()}
},120000);
function fixtureRecoveryApproval(f:{account:string;round:string},proofHash:string,now:number){return{schema:'LINKED_RECOVERY_APPROVAL_V1' as const,proofHash,accountId:f.account,roundId:f.round,operator:'DISPOSABLE_TEST',reference:'CONTROLLED_FIXTURE_NOT_OWNER_APPROVAL',issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString(),mode:'RECOVERY_ONLY_BUY_DISABLED' as const}}
it.each(['provider-461064713-461064721-token2022.json.gz','provider-461061044-461061048.json.gz'])('proof recovery retains the incident and paper impact through %s, API exits, duplicates and a fresh process',async(file)=>{
 const f=await recoveryFixture(file);
 try{
  const buy=await f.request('trades/buy',{mint:f.s.mint,paperSol:'0.01'});expect(buy.status,JSON.stringify(buy.body)).toBe(200);
  const before=await reconcileAccountLedger(db,f.account),head=await f.store.load();
  const reason=file.includes('token2022')?'TRANSACTION_TOKEN_EFFECTS_UNRECONCILED:retained-fixture':'UNEXPLAINED_VAULT_TRANSFER';
  await f.store.quarantine(f.original,Error(reason));
  await expect(f.store.assertAvailable()).rejects.toThrow();
  const legacy=(await db.pool.query('select * from linked_candidate.route_quarantine where account_id=$1',[f.account])).rows[0];
  const p=await f.store.prepareRecovery(f.evidence),now=Date.parse(f.evidence.after.observedAt),approval=fixtureRecoveryApproval(f,p.proofHash,now);
  expect((await f.store.load()).state_hash).toBe(head.state_hash);expect(await reconcileAccountLedger(db,f.account)).toEqual(before);
  const outcomes=await Promise.allSettled([f.store.activateRecovery(f.evidence,p.proof,approval,now),f.store.activateRecovery(f.evidence,p.proof,approval,now)]);
  expect(outcomes.filter(x=>x.status==='fulfilled'&&x.value.advanced)).toHaveLength(1);
  expect((await f.store.activateRecovery(f.evidence,p.proof,approval,now+120000)).advanced).toBe(false);
  expect(await reconcileAccountLedger(db,f.account)).toEqual(before);
  expect((await db.pool.query('select * from linked_candidate.route_quarantine where account_id=$1',[f.account])).rows[0]).toEqual(legacy);
  expect((await db.pool.query('select quarantined from linked_candidate.route_status where account_id=$1',[f.account])).rows[0].quarantined).toBe(true);
  const after=await f.store.load();expect(after.state_hash).toBe(p.proof.afterHash);await f.store.assertAvailable();
  expect(after.document.simulated.accounts).not.toEqual(after.document.real.accounts);
  const child=JSON.parse(execFileSync(process.execPath,['--import','tsx','packages/db/isolated/linked-pair/recovery-restart-child.ts',f.account,f.round],{env:{...process.env,DATABASE_URL:url},encoding:'utf8'}).trim());expect(child.hash).toBe(after.state_hash);
  f.now.value=now;f.rpc.bank=f.evidence.after;
  const position=(await f.runtime.competition.getCurrentAccount(f.user))!.positions[0]!;
  expect((await f.request('trades/sell',{mint:f.s.mint,quantity:(BigInt(position.remaining_base_units)/4n).toString()})).status).toBe(200);
  const key=randomUUID(),full=await f.request('trades/sell',{mint:f.s.mint,quantity:'ALL'},key);expect(full.status,JSON.stringify(full.body)).toBe(200);expect((await f.request('trades/sell',{mint:f.s.mint,quantity:'ALL'},key)).body).toEqual(full.body);
  expect((await f.runtime.competition.getCurrentAccount(f.user))!.positions).toHaveLength(0);expect((await reconcileAccountLedger(db,f.account)).reconciled).toBe(true);
  await f.store.quarantine(f.evidence,Error('CONTROLLED_LATER_FAILURE'));
  await expect(f.store.assertAvailable()).rejects.toThrow('UNRESOLVED_INCIDENT');
  await expect(f.store.activateRecovery(f.evidence,p.proof,approval,now)).rejects.toThrow('UNRESOLVED_INCIDENT');
  expect((await db.pool.query('select count(*)::int n from linked_recovery_candidate.incidents where account_id=$1',[f.account])).rows[0].n).toBe(2);
 }finally{await f.app.close()}
},120000);
it('proof recovery rejects absent/expired/changed approval and rolls back an interrupted resolution atomically',async()=>{
 const f=await recoveryFixture();
 try{
  await f.store.quarantine(f.original,Error('TRANSACTION_TOKEN_EFFECTS_UNRECONCILED:fixture'));
  const p=await f.store.prepareRecovery(f.evidence),now=Date.parse(f.evidence.after.observedAt),a=fixtureRecoveryApproval(f,p.proofHash,now),head=await f.store.load();
  await expect(new LinkedStateStore(db,f.account,f.round,true).activateRecovery(f.evidence,p.proof,a,now)).rejects.toThrow('NOT_ENABLED');
  await expect(f.store.activateRecovery(f.evidence,p.proof,a,now+60000)).rejects.toThrow('APPROVAL_TIME');
  await expect(f.store.activateRecovery(f.evidence,p.proof,{...a,proofHash:'wrong'},now)).rejects.toThrow('APPROVAL_SCOPE');
  const changed=structuredClone(f.evidence);changed.acquiredAt=new Date(now+1000).toISOString();
  await expect(f.store.prepareRecovery(changed)).rejects.toThrow('INCIDENT_EVIDENCE_CHANGED');
  const wrong={...p.proof,financialHash:'wrong'};await expect(f.store.activateRecovery(f.evidence,wrong,{...a,proofHash:digest(wrong)},now)).rejects.toThrow('PROOF_CHANGED');
  await db.pool.query("create function linked_recovery_candidate.test_interrupt() returns trigger language plpgsql as $$ begin raise exception 'CONTROLLED_INTERRUPTION'; end $$; create trigger test_interrupt before insert on linked_recovery_candidate.resolutions for each row execute function linked_recovery_candidate.test_interrupt()");
  try{await expect(f.store.activateRecovery(f.evidence,p.proof,a,now)).rejects.toThrow('CONTROLLED_INTERRUPTION')}finally{await db.pool.query('drop trigger test_interrupt on linked_recovery_candidate.resolutions; drop function linked_recovery_candidate.test_interrupt()')}
  expect((await f.store.load()).state_hash).toBe(head.state_hash);
  expect((await db.pool.query('select count(*)::int n from linked_recovery_candidate.incidents where account_id=$1',[f.account])).rows[0].n).toBe(1);
  expect((await db.pool.query('select count(*)::int n from linked_recovery_candidate.resolutions where account_id=$1',[f.account])).rows[0].n).toBe(0);
  expect((await db.pool.query('select count(*)::int n from linked_flow_candidate.steps where account_id=$1',[f.account])).rows[0].n).toBe(0);
  await expect(f.store.assertAvailable()).rejects.toThrow();
  expect((await f.store.activateRecovery(f.evidence,p.proof,a,now)).advanced).toBe(true);
  await expect(db.pool.query('delete from linked_recovery_candidate.resolutions where account_id=$1',[f.account])).rejects.toThrow('IMMUTABLE');
  await expect(db.pool.query('update linked_candidate.route_status set quarantined=false where account_id=$1',[f.account])).rejects.toThrow('NO_RESET');
 }finally{await f.app.close()}
},120000);

  it.each([
    {label:'PumpSwap fee sweeps',file:'provider-461061044-461061048.json.gz'},
    {label:'Token-2022 gross/net external transfers',file:'provider-461064713-461064721-token2022.json.gz'},
    {label:'transparent extended Token-2022 receipts',file:'provider-461273875-461273882-transparent-token2022.json.gz'},
    {label:'native burn and account closure',file:'provider-461273931-461273938-burn.json.gz'},
    {label:'native funding SyncNative and WSOL spend',file:'provider-461289562-461289569-sync-native.json.gz'},
    {label:'Token-2022 fresh InitializeAccount3 receipts',file:'provider-461289799-461289806-initialize-account3.json.gz'},
  ])('genuine $label advance durably without financial effects and preserve API exits and restart accounting',async({file})=>{
    const evidence=JSON.parse(gunzipSync(readFileSync('docs/linked-pair-20261024/local-extension-test/'+file)).toString()) as ProviderInterval;
    if(!(await db.pool.query("select 1 from daily_competitions where utc_date='2026-10-25'")).rowCount)await createDailyCompetition(db,{id:'fee-sweep-day',utcDate:'2026-10-25',startsAt:new Date('2026-10-25T00:00:00Z'),endsAtExclusive:new Date('2026-10-26T00:00:00Z')});
  const f=await setup([evidence],'ENTRY',!!process.env['PAPERFUND_ADMISSION_BUNDLE'],undefined,true);
  try{
    if(file.includes('transparent-token2022')||file.includes('sync-native')||file.includes('initialize-account3')){
      const before=await reconcileAccountLedger(db,f.account);
      await f.store.advanceFlow(structuredClone(evidence));
      expect(await reconcileAccountLedger(db,f.account)).toEqual(before);
      f.rpc.bank=evidence.after;f.now.value=Date.parse(evidence.after.observedAt);
    }
    const bought=await f.request('trades/buy',{mint:f.s.mint,paperSol:'0.01'});
    expect(bought.status,JSON.stringify(bought.body)).toBe(200);
    const before=await reconcileAccountLedger(db,f.account);
    await f.store.advanceFlow(structuredClone(evidence));
    expect(await reconcileAccountLedger(db,f.account)).toEqual(before);
    expect((await f.store.advanceFlow(structuredClone(evidence))).advanced).toBe(false);
    const checkpoint=await f.store.load();
    expect(digest(await new LinkedStateStore(db,f.account,f.round,true).recover())).toBe(checkpoint.state_hash);
    f.rpc.bank=evidence.after;f.now.value=Date.parse(evidence.after.observedAt);
    const current=await f.runtime.competition.getCurrentAccount(f.user),quantity=BigInt(current!.positions[0]!.remaining_base_units)/4n;
    const partial=await f.request('trades/sell',{mint:f.s.mint,quantity:quantity.toString()});expect(partial.status,JSON.stringify(partial.body)).toBe(200);
    const key=randomUUID(),full=await f.request('trades/sell',{mint:f.s.mint,quantity:'ALL'},key);expect(full.status,JSON.stringify(full.body)).toBe(200);
    expect((await f.request('trades/sell',{mint:f.s.mint,quantity:'ALL'},key)).body).toEqual(full.body);
    expect((await f.runtime.competition.getCurrentAccount(f.user))!.positions).toHaveLength(0);
    expect((await reconcileAccountLedger(db,f.account)).reconciled).toBe(true);
    const head=await f.store.load();expect(digest(await new LinkedStateStore(db,f.account,f.round,true).recover())).toBe(head.state_hash);
    expect((await db.pool.query('select count(*)::int n from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1',[f.account])).rows[0].n).toBe(3);
  }finally{await f.app.close()}
},120000);
it('durable flow leaves ordinary direct-SOL API BUY, partial/full SELL, valuation and duplicate accounting unchanged', async () => {
  const f = await setup([real[0]!], 'ENTRY', false, undefined, true),
    ordinary = {
      ...recordedPumpState('developed'),
      observedAt: f.s.observedAt as ReturnType<typeof recordedPumpState>['observedAt'],
    }; // Controlled fixture clock, not a current mainnet snapshot.
  try {
    f.app.addHook('onError',async(_q,_r,error)=>{console.error('DIRECT_FIXTURE_ERROR',error.stack)});
    f.resolver.mockImplementation(async (identity) => ({
      route: { originIdentity: identity, executionIdentity: ordinary.identity, migrated: false },
      adapter: f.baseline.resolve(ordinary.identity.protocolId),
      state: ordinary,
    }));
    f.baseline.mintResolver = async () => ordinary.identity;
    f.runtime.router.contextResolver = async (mint) => mint;
    const asset = 'ordinary-flow:' + randomUUID();
    await createAsset(db, { id: asset, mintAddress: ordinary.identity.tokenMint, decimals: 6 });
    await createMarket(db, {
      id: ordinary.identity.marketId,
      baseAssetId: asset,
      quoteAssetId: 'sol',
      venue: ordinary.identity.protocolId,
      providerMarketId: ordinary.identity.marketId,
    });
    const key = randomUUID(),
      payload = { mint: ordinary.identity.tokenMint, paperSol: '0.01' },
      buy = await f.request('trades/buy', payload, key);
    expect(buy.status, JSON.stringify(buy.body)).toBe(200);
    expect(await f.request('trades/buy', payload, key)).toEqual(buy);
    const portfolio = await f.request('positions');
    expect(portfolio.body.valuationStatus, JSON.stringify(portfolio.body)).toBe('AVAILABLE');
    const a = await f.runtime.competition.getCurrentAccount(f.user),
      qty = BigInt(a!.positions[0]!.remaining_base_units);
    expect(
      (
        await f.request('trades/sell', {
          mint: ordinary.identity.tokenMint,
          quantity: (qty / 4n).toString(),
        })
      ).status,
    ).toBe(200);
    expect(
      (await f.request('trades/sell', { mint: ordinary.identity.tokenMint, quantity: 'ALL' }))
        .status,
    ).toBe(200);
    expect((await f.runtime.competition.getCurrentAccount(f.user))!.positions).toHaveLength(0);
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
    expect((await f.store.load()).revision).toBe('0');
    expect((await f.store.load()).flow_sequence).toBe('0');
    expect(
      (
        await db.pool.query('select count(*)::int n from orders where competition_account_id=$1', [
          f.account,
        ])
      ).rows[0].n,
    ).toBe(3);
  } finally {
    await f.app.close();
  }
}, 120000);
it('durable flow advances without fills, coalesces concurrent progression and independently recovers both intervals', async () => {
  const f = await setup(real, 'ENTRY', false, undefined, true);
  try {
    const attempts = await Promise.allSettled([
      f.store.advanceFlow(structuredClone(real[0]!)),
      f.store.advanceFlow(structuredClone(real[0]!)),
    ]);
    expect(attempts.some((r) => r.status === 'fulfilled')).toBe(true);
    expect((await f.store.load()).flow_sequence).toBe('1');
    expect((await f.store.advanceFlow(structuredClone(real[0]!))).advanced).toBe(false);
    await f.store.advanceFlow(structuredClone(real[1]!));
    const head = await f.store.load();
    expect(head.revision).toBe('0');
    expect(head.flow_sequence).toBe('2');
    expect(head.document.real.slot).toBe(real[1]!.after.slot);
    expect(digest(await f.store.recover())).toBe(head.state_hash);
    expect(
      (
        await db.pool.query('select count(*)::int n from orders where competition_account_id=$1', [
          f.account,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.pool.query(
          'select count(*)::int n from linked_candidate.receipts where account_id=$1',
          [f.account],
        )
      ).rows[0].n,
    ).toBe(0);
    f.now.value = Date.parse(real[1]!.after.observedAt);
    f.runtime.router.contextResolver = async (mint) => mint; // Known canonical mint; no live network in this fixture.
    const preflight = await f.request('trades/buy-preflight?mint=' + f.s.mint);
    expect(preflight.status).toBe(200);
    expect(preflight.body.marketSupported, JSON.stringify(preflight.body)).toBe(true);
  } finally {
    await f.app.close();
  }
}, 120000);
it('durable flow preserves paper impact, partial/full exits, financial idempotency and restart replay', async () => {
  const f = await setup([real[0]!], 'ENTRY', false, undefined, true);
  try {
    const buy = await f.request('trades/buy', { mint: f.s.mint, paperSol: '0.01' });
    expect(buy.status, JSON.stringify(buy.body)).toBe(200);
    const before = await f.store.load();
    expect(digest(before.document.real)).not.toBe(digest(before.document.simulated));
    await f.store.advanceFlow(structuredClone(real[0]!));
    f.now.value = Date.parse(real[0]!.after.observedAt);
    const head = await f.store.load();
    expect(head.revision).toBe('1');
    expect(head.flow_sequence).toBe('1');
    expect(digest(head.document.real)).not.toBe(digest(head.document.simulated));
    const current = await f.runtime.competition.getCurrentAccount(f.user),
      qty = BigInt(current!.positions[0]!.remaining_base_units);
    expect(
      (await f.request('trades/sell', { mint: f.s.mint, quantity: (qty / 4n).toString() })).status,
    ).toBe(200);
    const remaining = await f.runtime.competition.getCurrentAccount(f.user),
      key = randomUUID(),
      payload = { mint: f.s.mint, quantity: remaining!.positions[0]!.remaining_base_units };
    expect((await f.request('trades/sell', payload, key)).status).toBe(200);
    expect((await f.request('trades/sell', payload, key)).status).toBe(200);
    expect(
      (
        await db.pool.query(
          'select count(*)::int n from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1',
          [f.account],
        )
      ).rows[0].n,
    ).toBe(3);
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
    expect(digest(await f.store.recover())).toBe((await f.store.load()).state_hash);
    await f.compose();
  } finally {
    await f.app.close();
  }
}, 120000);
it('durable flow rolls back staged proof on a failed head write, then safely retries; incomplete evidence cannot advance', async () => {
  const f = await setup([real[0]!], 'ENTRY', false, undefined, true);
  try {
    const initial = await f.store.load(),
      trigger = 'flow_failure_' + randomUUID().replaceAll('-', '');
    await db.pool.query(
      `create function linked_flow_candidate.${trigger}() returns trigger language plpgsql as $$ begin raise exception 'CONTROLLED_FLOW_WRITE_FAILURE'; end $$`,
    );
    await db.pool.query(
      `create trigger ${trigger} before insert on linked_flow_candidate.heads for each row when(new.account_id='${f.account}') execute function linked_flow_candidate.${trigger}()`,
    );
    await expect(f.store.advanceFlow(structuredClone(real[0]!))).rejects.toThrow(
      'CONTROLLED_FLOW_WRITE_FAILURE',
    );
    expect((await f.store.load()).state_hash).toBe(initial.state_hash);
    expect(
      (
        await db.pool.query(
          'select count(*)::int n from linked_flow_candidate.steps where account_id=$1',
          [f.account],
        )
      ).rows[0].n,
    ).toBe(0);
    await db.pool.query(`drop trigger ${trigger} on linked_flow_candidate.heads`);
    await f.store.advanceFlow(structuredClone(real[0]!));
    expect((await f.store.load()).flow_sequence).toBe('1');
  } finally {
    await f.app.close();
  }
  const g = await setup([real[0]!], 'ENTRY', false, undefined, true);
  try {
    const bad = structuredClone(real[0]!);
    bad.blocks.splice(0, 1);
    await expect(g.store.advanceFlow(bad)).rejects.toThrow();
    expect((await g.store.load()).flow_sequence).toBe('0');
    await expect(g.store.assertAvailable()).rejects.toThrow('QUARANTINED');
  } finally {
    await g.app.close();
  }
}, 120000);
it('durable flow participates in exact cutoff sealing, forced exit and restart without advancing after the seal', async () => {
  const e = atCutoff(real[0]!, new Date('2026-10-21T09:00:00Z')),
    f = await setup([e], 'ENTRY', false, undefined, true);
  try {
    expect((await f.request('trades/buy', { mint: f.s.mint, paperSol: '0.01' })).status).toBe(200);
    await f.store.advanceFlow(structuredClone(e));
    const last = e.blocks.at(-1)!;
    f.rpc.blocks.set(last.slot + 1, {
      parentSlot: last.slot,
      previousBlockhash: last.result.blockhash,
      blockhash: 'CONTROLLED_FLOW_CUTOFF_NEXT',
      blockTime: +f.cutoff / 1000,
      transactions: [],
    });
    f.now.value = +f.cutoff + 1000;
    f.rpc.bank = e.after;
    const result = await f.runtime.settle(f.round);
    expect(result.failures).toEqual([]);
    expect(result.state).toBe('FINALIZED');
    expect((await f.store.cutoff())!.document.beforeHash).toBeDefined();
    expect(digest(await f.store.recover())).toBe((await f.store.load()).state_hash);
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
    const restart = await f.compose();
    expect((await restart.settle(f.round)).forcedSells).toEqual([]);
  } finally {
    await f.app.close();
  }
}, 120000);
it('durable flow survives actual process interruption after staged proof, then resumes exactly once', async () => {
  const f = await setup([real[0]!], 'ENTRY', false, undefined, true);
  const child = fork(resolve('apps/api/isolated/verified-routes/flow-crash-fixture.mjs'), [], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {
      ...process.env,
      FLOW_FIXTURE_DATABASE: url,
      FLOW_FIXTURE_ACCOUNT: f.account,
      FLOW_FIXTURE_ROUND: f.round,
    },
  });
  try {
    await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(() => {
        throw Error('FIXTURE_EXITED_BEFORE_STAGED_PROOF');
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error('STAGED_PROOF_TIMEOUT')), 15000).unref(),
      ),
    ]);
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    expect(
      (
        await db.pool.query(
          'select count(*)::int n from linked_flow_candidate.steps where account_id=$1',
          [f.account],
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await f.store.load()).flow_sequence).toBe('0');
    await f.store.advanceFlow(structuredClone(real[0]!));
    expect((await f.store.load()).flow_sequence).toBe('1');
    expect((await f.store.advanceFlow(structuredClone(real[0]!))).advanced).toBe(false);
    expect(digest(await f.store.recover())).toBe((await f.store.load()).state_hash);
  } finally {
    if (child.exitCode === null) child.kill();
    await f.app.close();
  }
}, 120000);
it('production-shaped composition executes genuine complete pool chronology, shared direct-SOL, API partial/full exits, retries and fresh composition recovery', async () => {
  const intervals = real.map((e) => ({
      ...structuredClone(e),
      before: direct(e.before),
      after: direct(e.after),
    })),
    f = await setup(intervals, 'ENTRY', true);
  try {
    for (const mint of [f.s.mint, f.s.quoteMint])
      expect((await f.request('trades/buy', { mint, paperSol: '0.01' })).status).toBe(200);
    f.rpc.bank = intervals[0]!.after;
    f.now.value = Date.parse(f.rpc.bank.observedAt);
    const p = await f.request('positions');
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.valuationStatus).toBe('AVAILABLE');
    const account = await f.runtime.competition.getCurrentAccount(f.user);
    const held = account!.positions.find((p) => p.mint_address === f.s.mint)!;
    expect(
      (
        await f.request('trades/sell', {
          mint: f.s.mint,
          quantity: (BigInt(held.remaining_base_units) / 3n).toString(),
        })
      ).status,
    ).toBe(200);
    f.rpc.bank = intervals[1]!.after;
    f.now.value = Date.parse(f.rpc.bank.observedAt);
    const predecessor = await f.store.load();
    const originalCommit = f.runtime.database.commitMarketExecution!;
    Object.defineProperty(f.runtime.database, 'commitMarketExecution', {
      configurable: true,
      value: async (...args: Parameters<typeof originalCommit>) => {
        await originalCommit(...args);
        throw Error('CONTROLLED_ATOMIC_ROLLBACK');
      },
    });
    const retryKey = randomUUID();
    expect(
      (await f.request('trades/sell', { mint: f.s.mint, quantity: 'ALL' }, retryKey)).status,
    ).not.toBe(200);
    expect((await f.store.load()).state_hash).toBe(predecessor.state_hash);
    Object.defineProperty(f.runtime.database, 'commitMarketExecution', {
      configurable: true,
      value: originalCommit,
    });
    await f.compose(); // New runtime must recover the pre-failure branch, not staged native effects.
    const key = retryKey,
      exit = await f.request('trades/sell', { mint: f.s.mint, quantity: 'ALL' }, key);
    expect(exit.status).toBe(200);
    expect((await f.request('trades/sell', { mint: f.s.mint, quantity: 'ALL' }, key)).body).toEqual(
      exit.body,
    );
    expect((await f.request('trades/sell', { mint: f.s.quoteMint, quantity: 'ALL' })).status).toBe(
      200,
    );
    expect(f.resolver).not.toHaveBeenCalled();
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
    const before = await f.store.recover(),
      restart = await f.compose();
    expect(digest(await restart.scopes.get(f.account)!.store.recover())).toBe(digest(before));
    expect(
      (
        await db.pool.query(
          'select count(*)::int n from linked_candidate.receipts where account_id=$1',
          [f.account],
        )
      ).rows[0].n,
    ).toBe(5);
    expect(f.rpc.calls.every((c) => JSON.stringify(c.params).includes('finalized'))).toBe(true);
  } finally {
    await f.app.close();
  }
}, 120000);
it('EXIT_ONLY blocks BUY even when the injected underlying permission allows it; unscoped users keep the original router', async () => {
  const f = await setup([real[0]!], 'EXIT_ONLY');
  try {
    expect((await f.request('trades/buy', { mint: f.s.mint, paperSol: '0.01' })).status).not.toBe(
      200,
    );
    expect((await f.store.load()).revision).toBe('0');
    f.baseline.setEnabled(identifier('GENERIC_PUMP_SWAP', 'ProtocolId'), false);
    await expect(
      withGenericActor({ userId: f.user, intent: 'READ' }, () =>
        f.runtime.router.loadPositionRoute(
          genericPumpSwapIdentity(f.s.mint, f.s.quoteMint, f.s.bridgePool),
        ),
      ),
    ).rejects.toThrow('disabled');
    f.baseline.setEnabled(identifier('GENERIC_PUMP_SWAP', 'ProtocolId'), true);
    Object.defineProperty(f.scope, 'paused', { value: true, enumerable: true });
    const held = await f.compose();
    await expect(
      held.competition.buy(f.user, {
        mint: f.s.mint,
        paperSol: '0.01',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow('OPERATOR_REVIEW_HOLD');
    const normal = recordedPumpState('developed');
    f.resolver.mockResolvedValue({
      route: {
        originIdentity: normal.identity,
        executionIdentity: normal.identity,
        migrated: false,
      },
      adapter: f.baseline.resolve(normal.identity.protocolId),
      state: normal,
    });
    await withGenericActor({ userId: 'different-user', intent: 'READ' }, () =>
      f.runtime.router.loadPositionRoute(normal.identity),
    );
    expect(f.resolver).toHaveBeenCalledTimes(1);
    expect(f.runtime.database.persistedSettlementAccount!(f.account, normal.identity)).toBe(false);
    expect(
      f.runtime.database.persistedSettlementAccount!('different-account', normal.identity),
    ).toBe(false);
    expect(
      f.runtime.database.persistedSettlementAccount!(
        f.account,
        genericPumpSwapIdentity(f.s.mint, f.s.quoteMint, f.s.bridgePool),
      ),
    ).toBe(true);
  } finally {
    await f.app.close();
  }
});
it('coherent whole-bank retry, restart archive, bounded gaps and exact historical cutoff-bank rejection', async () => {
  const f = await setup([real[0]!]);
  try {
    f.rpc.bank = real[0]!.after;
    f.now.value = Date.parse(f.rpc.bank.observedAt);
    f.rpc.mismatch = 1;
    await f.connector.interval(f.s);
    expect(f.rpc.calls.filter((c) => c.method === 'getMultipleAccounts')).toHaveLength(2);
    const restart = new FinalizedFlowConnector(
      f.rpc,
      new FinalizedBankArchive(f.archive.directory),
      () => f.now.value,
    );
    const e = await restart.interval(f.s);
    expect(e!.slots).toEqual(real[0]!.slots);
    f.now.value += 5;
    expect(digest(await restart.interval(f.s))).toBe(digest(e));
    const missing = structuredClone(real[0]!.before);
    missing.slot -= 300;
    await expect(restart.interval(missing, real[0]!.after)).rejects.toThrow('CLOCK_CONTEXT');
    const gap = new RetainedRpc([real[0]!]);
    gap.blocks.delete(real[0]!.slots[0]!);
    gap.bank = real[0]!.after;
    await expect(
      new FinalizedFlowConnector(
        gap,
        new FinalizedBankArchive(join(dir, randomUUID())),
        () => f.now.value,
      ).interval(f.s),
    ).rejects.toThrow('BLOCK_FRONTIER_GAP');
  } finally {
    await f.app.close();
  }
});
/** Controlled UTC timing, retained native accounts: not observed mainnet cutoff proof. */
function atCutoff(e: ProviderInterval, cutoff: Date): ProviderInterval {
  const r = structuredClone(e),
    offset = cutoff.getTime() / 1000 - 1 - seconds(r.after);
  for (const s of [r.before, r.after]) {
    const b = Buffer.from(s.accounts[CLOCK]!.base64, 'base64');
    b.writeBigInt64LE(BigInt(seconds(s) + offset), 32);
    s.accounts[CLOCK] = { ...s.accounts[CLOCK]!, base64: b.toString('base64') };
    s.observedAt = new Date(seconds(s) * 1000).toISOString();
  }
  for (const b of r.blocks) {
    b.result.blockTime += offset;
    for (const t of b.result.transactions)
      t.transaction.signatures = t.transaction.signatures.map((x) => 'CONTROLLED_UTC_' + x);
  }
  return r;
}
it('controlled mixed flow uses the same connector and API, seals exact UTC bank, settles once and recovers', async () => {
  const e = atCutoff(await controlledMixedInterval(), new Date('2026-10-21T08:00:00Z')),
    f = await setup([e], 'ENTRY', true);
  try {
    expect((await f.request('trades/buy', { mint: f.s.mint, paperSol: '0.01' })).status).toBe(200);
    const ordinary = recordedPumpState('developed');
    f.resolver.mockImplementation(async (identity) => ({
      route: { originIdentity: identity, executionIdentity: ordinary.identity, migrated: false },
      adapter: f.baseline.resolve(ordinary.identity.protocolId),
      state: ordinary,
    }));
    f.baseline.mintResolver = async (mint) => {
      if (mint !== ordinary.identity.tokenMint) throw Error('UNEXPECTED_ORDINARY_DISCOVERY');
      return ordinary.identity;
    };
    const asset = 'ordinary:' + ordinary.identity.tokenMint;
    await createAsset(db, { id: asset, mintAddress: ordinary.identity.tokenMint, decimals: 6 });
    await createMarket(db, {
      id: ordinary.identity.marketId,
      baseAssetId: asset,
      quoteAssetId: 'sol',
      venue: ordinary.identity.protocolId,
      providerMarketId: ordinary.identity.marketId,
    });
    // One independent ordinary position in the scoped portfolio, one unscoped user in the same round.
    expect(
      (await f.request('trades/buy', { mint: ordinary.identity.tokenMint, paperSol: '0.01' }))
        .status,
    ).toBe(200);
    const other = 'ordinary:other:' + randomUUID();
    await createUser(db, { id: other, walletAddress: other });
    await initializeCompetitionAccount(db, {
      accountId: other,
      userId: other,
      hourlyRoundId: f.round,
      idempotencyKey: other,
    });
    await f.runtime.competition.buy(other, {
      mint: ordinary.identity.tokenMint,
      paperSol: '0.01',
      idempotencyKey: randomUUID(),
    });
    expect((await f.request('positions')).status).toBe(200);
    const last = e.blocks.at(-1)!,
      nextSlot = last.slot + 1;
    f.rpc.blocks.set(nextSlot, {
      parentSlot: last.slot,
      previousBlockhash: last.result.blockhash,
      blockhash: 'CONTROLLED_NEXT',
      blockTime: f.cutoff.getTime() / 1000,
      transactions: [],
    });
    f.now.value = f.cutoff.getTime() + 1000;
    f.rpc.bank = e.after;
    const frontier = await f.connector.cutoffFrontier(f.s, f.cutoff);
    expect(frontier.last.slot).toBe(e.after.slot);
    expect(frontier.interval!.blocks.length).toBe(e.blocks.length);
    const result = await f.runtime.settle(f.round);
    expect((await reconcileAccountLedger(db, other)).reconciled).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.state).toBe('FINALIZED');
    const counts = await db.pool.query(
      'select count(*)::int n from linked_candidate.receipts where account_id=$1',
      [f.account],
    );
    expect(counts.rows[0].n).toBe(2);
    const restart = await f.compose();
    expect((await restart.settle(f.round)).forcedSells).toEqual([]);
    await f.store.recover();
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
    const empty = new FinalizedFlowConnector(
      f.rpc,
      new FinalizedBankArchive(join(dir, randomUUID())),
      () => f.now.value,
    );
    await expect(empty.cutoffFrontier(f.s, f.cutoff)).rejects.toThrow(
      'EXACT_CUTOFF_BANK_NOT_RETAINED',
    );
    f.now.value = f.cutoff.getTime() + 15000;
    await expect(empty.observe(f.s)).rejects.toThrow('STALE_BANK');
    await empty.captureCutoffBank(f.s, f.cutoff);
    expect((await empty.cutoffFrontier(f.s, f.cutoff)).last.slot).toBe(e.after.slot);
  } finally {
    await f.app.close();
  }
}, 120000);
it('controlled external liquidity movement preserves automatic Orca to PumpSwap switching in scoped router', async () => {
  const s = controlledAutomaticRoutes(),
    e = await controlledOrcaMovement(s),
    f = await setup([e]);
  try {
    expect((await f.request('trades/buy', { mint: s.mint, paperSol: '0.01' })).status).toBe(200);
    f.rpc.bank = e.after;
    f.now.value = Date.parse(e.after.observedAt);
    const p = await f.runtime.competition.getCurrentAccount(f.user),
      quantity = BigInt(p!.positions[0]!.remaining_base_units);
    expect(
      (await f.request('trades/sell', { mint: s.mint, quantity: (quantity / 3n).toString() }))
        .status,
    ).toBe(200);
    expect((await f.request('trades/sell', { mint: s.mint, quantity: 'ALL' })).status).toBe(200);
    const receipts = (
      await db.pool.query(
        'select document from linked_candidate.receipts where account_id=$1 order by revision',
        [f.account],
      )
    ).rows;
    expect(receipts[0].document.routeBridgePool).not.toBe(receipts[1].document.routeBridgePool);
    await f.store.recover();
  } finally {
    await f.app.close();
  }
}, 120000);
it('unsupported mixed mutation quarantines the carried group without financial or liquidity successor', async () => {
  const e = await controlledMixedInterval(),
    f = await setup([e]);
  try {
    expect((await f.request('trades/buy', { mint: f.s.mint, paperSol: '0.01' })).status).toBe(200);
    const head = await f.store.load(),
      bad = structuredClone(e);
    bad.blocks[0]!.result.transactions[0]!.transaction.message.instructions[0]!.data =
      '111111111111111111111111';
    for (const b of bad.blocks) f.rpc.blocks.set(b.slot, b.result);
    f.rpc.bank = bad.after;
    f.now.value = Date.parse(bad.after.observedAt);
    expect((await f.request('trades/sell', { mint: f.s.mint, quantity: 'ALL' })).status).not.toBe(
      200,
    );
    expect((await f.store.load()).state_hash).toBe(head.state_hash);
    await expect(f.store.assertAvailable()).rejects.toThrow('QUARANTINED');
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    await f.app.close();
  }
}, 120000);

/** Controlled successors on retained native accounts; not a witnessed mixed mainnet transition. */
it('built mixed route handles both canonical tokens, consecutive buys, V2 payouts, shared liquidity and complete API exits', async () => {
  const mixed = atCutoff(await controlledMixedInterval(), new Date('2026-10-21T10:59:40Z'));
  const payout = await controlledCurvePayoutInterval(
    mixed.after,
    await curvePayoutSpec(mixed.after, true, 1000000n),
    mixed.blocks.at(-1)!.result.transactions.at(-1),
  );
  // These helpers create independent CONTROLLED packets. Join their header boundary explicitly.
  payout.anchor.blockhash = mixed.blocks.at(-1)!.result.blockhash;
  payout.blocks[0]!.result.previousBlockhash = payout.anchor.blockhash;
  const f = await setup([mixed, payout], 'ENTRY', true);
  try {
    const mints = [...new Set(linkedBindings(f.s).map((r) => r.mint))];
    expect(mints).toHaveLength(2);
    for (const mint of mints) {
      const b = await f.request('trades/buy', { mint, paperSol: '0.01' });
      expect(b.status, JSON.stringify(b.body)).toBe(200);
    }
    expect((await f.request('trades/buy', { mint: mints[0]!, paperSol: '0.005' })).status).toBe(
      200,
    );
    f.rpc.bank = mixed.after;
    f.now.value = Date.parse(mixed.after.observedAt);
    const values = await f.request('positions');
    expect(values.status, JSON.stringify(values.body)).toBe(200);
    expect(values.body.valuationStatus).toBe('AVAILABLE');
    const account = await f.runtime.competition.getCurrentAccount(f.user),
      position = account!.positions.find((p) => p.mint_address === mints[0])!;
    const partial = await f.request('trades/sell', {
      mint: mints[0]!,
      quantity: (BigInt(position.remaining_base_units) / 3n).toString(),
    });
    expect(partial.status, JSON.stringify(partial.body)).toBe(200);
    const afterPartial = await f.store.load();
    expect(digest(afterPartial.document.real)).not.toBe(digest(afterPartial.document.simulated));
    f.rpc.bank = payout.after;
    f.now.value = Date.parse(payout.after.observedAt);
    for (const mint of mints) {
      const key = randomUUID(),
        sold = await f.request('trades/sell', { mint, quantity: 'ALL' }, key);
      expect(sold.status, JSON.stringify(sold.body)).toBe(200);
      expect((await f.request('trades/sell', { mint, quantity: 'ALL' }, key)).body).toEqual(
        sold.body,
      );
    }
    const head = await f.store.load();
    expect(head.revision).toBe('6');
    expect(head.document.real.slot).toBe(payout.after.slot);
    expect(
      Buffer.from(head.document.real.accounts[CURVE]!.base64, 'base64').subarray(125, 141),
    ).toEqual(Buffer.from(mixed.after.accounts[CURVE]!.base64, 'base64').subarray(125, 141));
    const current = await f.runtime.competition.getCurrentAccount(f.user);
    expect(current!.positions).toHaveLength(0);
    const audit = (
      await db.pool.query(
        'select (select count(*)::int from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1) fills,(select count(*)::int from linked_candidate.receipts where account_id=$1) receipts,(select count(*)::int from competition_token_slots where competition_account_id=$1) slots',
        [f.account],
      )
    ).rows[0];
    expect(audit).toEqual({ fills: 6, receipts: 6, slots: 2 });
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
    const recovered = await (await f.compose()).scopes.get(f.account)!.store.recover();
    expect(digest(recovered)).toBe(head.state_hash);
    expect(f.resolver).not.toHaveBeenCalled();
  } finally {
    await f.app.close();
  }
}, 120000);

class BrowserMemoryRedis implements RedisService {
  private values = new Map<string, string>();
  private counters = new Map<string, number>();
  async healthCheck() {
    return true;
  }
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async setExpiring(key: string, value: string) {
    this.values.set(key, value);
  }
  async take(key: string) {
    const v = this.values.get(key) ?? null;
    this.values.delete(key);
    return v;
  }
  async delete(key: string) {
    this.values.delete(key);
  }
  async incrementWindow(key: string) {
    const n = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, n);
    return n;
  }
  async close() {}
}

it('public PAPER frozen API onboards signed unlisted wallets, trades beyond canary limits, isolates errors and retains cutoff holds on reconstruction',async()=>{
 const evidence=JSON.parse(gunzipSync(readFileSync('docs/linked-pair-20261024/local-extension-test/provider-461064713-461064721-token2022.json.gz')).toString()) as ProviderInterval;
 const f=await setup([evidence],'ENTRY');await f.app.close();
 const release=resolve(process.env['PAPERFUND_PUBLIC_RELEASE']??'docs/operator-candidate/artifact-releases/public-paper-20261026-v1/runtime'),h=await import(pathToFileURL(release+'/current-quote-runtime.mjs').href),policy=await import(pathToFileURL(process.env['PAPERFUND_PUBLIC_POLICY_SOURCE']??release+'/policy.mjs').href),protocols=await import(pathToFileURL(release+'/packages/protocols/dist/index.js').href);
 const profile={schema:'PAPERFUND_PUBLIC_CURRENT_QUOTES_V1',nonPaying:true,approvalReference:'CONTROLLED_FIXTURE_NOT_PRODUCTION_AUTHORITY',authorizationId:randomUUID(),admission:'PUBLIC_PAPER',rewardHoldFrom:'2026-10-26T00:00:00Z'};
 const beforeControl=(await db.pool.query('select value from app_meta where key=$1',[policy.CONTROL])).rows[0];
 const memory=new BrowserMemoryRedis(),pair=generateKeyPairSync('ed25519'),wallet=new PublicKey(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32)).toBase58(),sign=(await import('node:crypto')).sign;
 let missing=false,activeDb:any=db;
 const compose=()=>{const cap=policy.publicCapability(activeDb,profile,{operatorIds:['fixture-admin'],actor:protocols.genericActor,now:()=>f.now.value});return{cap,...policy.composeProduction(h,{database:activeDb,baseline:f.baseline,profile,capability:cap,actor:protocols.genericActor,snapshots:async(mint:string)=>!missing&&mint===f.s.mint?[structuredClone(evidence.before)]:[],now:()=>f.now.value})};};
 let scoped=compose();await scoped.cap.control('fixture-admin','ENTRY');
 const makeApp=()=>{const competition=new h.CompetitionService(scoped.database,scoped.router,()=>new Date(f.now.value),undefined,undefined,undefined,true),auth=new h.AuthService(scoped.database,memory,300,3600,()=>new Date(f.now.value)),app=h.buildApp({config:{LOG_LEVEL:'silent',BETA_INVITE_ONLY:false,API_RATE_LIMIT_TRADE_MAX:100,ALLOWED_ORIGINS:'chrome-extension://lcnpjpkojoadojibfbjfohpjepkfmdln,https://gmgn.ai,https://trade.padre.gg'},database:scoped.database,redis:memory,auth,competition,genericCapability:scoped.cap,logger:false});policy.installPublicOnboarding(app,competition);app.addHook('onError',async(_q:any,_r:any,error:Error)=>{console.error('PUBLIC_FIXTURE_ERROR',error.stack)});return{app,competition};};
 let instance=makeApp(),token:string|undefined;
 const request=async(path:string,payload?:object,key=randomUUID(),origin='chrome-extension://lcnpjpkojoadojibfbjfohpjepkfmdln',bearer=token)=>{const r=await instance.app.inject({method:payload?'POST':'GET',url:'/api/v1/'+path,headers:{...(bearer?{authorization:'Bearer '+bearer}:{}),origin,'idempotency-key':key},...(payload?{payload}:{})});return{status:r.statusCode,body:r.json()};};
 try{
 expect((await request('trades/buy',{mint:f.s.mint,paperSol:'0.02'})).status).toBe(401);
 const challenge=await request('auth/challenge',{walletAddress:wallet});expect(challenge.status).toBe(200);
 const login=await request('auth/verify',{walletAddress:wallet,challengeId:challenge.body.challengeId,message:challenge.body.message,signature:sign(null,Buffer.from(challenge.body.message),pair.privateKey).toString('base64'),transport:'extension'});expect(login.status,JSON.stringify(login.body)).toBe(200);token=login.body.sessionToken;
 const owner=login.body.user.id,account=(await instance.competition.getCurrentAccount(owner))!.id;
 expect((await instance.competition.getCurrentAccount(owner))!.paper_sol_balance_lamports).toBe('10000000000');await instance.competition.enterRound(owner);expect((await db.pool.query('select count(*)::int n from competition_accounts where user_id=$1 and hourly_round_id=$2',[owner,f.round])).rows[0].n).toBe(1);
 const untouched=await reconcileAccountLedger(db,account);
 expect((await request('trades/buy',{mint:f.s.mint,paperSol:'0.02'},randomUUID(),'https://evil.invalid')).status).toBe(403);
 expect((await request('trades/buy',{mint:'11111111111111111111111111111111',paperSol:'0.02'})).status).not.toBe(200);expect(await reconcileAccountLedger(db,account)).toEqual(untouched);
 const key=randomUUID(),buy=await request('trades/buy',{mint:f.s.mint,paperSol:'0.02'},key);expect(buy.status,JSON.stringify(buy.body)).toBe(200);expect((await request('trades/buy',{mint:f.s.mint,paperSol:'0.02'},key)).body).toEqual(buy.body);
 const quantity=BigInt(buy.body.tokenQuantityReceivedBaseUnits);f.now.value+=1000;
 expect((await request('trades/sell',{mint:f.s.mint,quantity:(quantity/4n).toString()},randomUUID(),'https://gmgn.ai')).status).toBe(200);
 missing=true;const partial=await reconcileAccountLedger(db,account);expect((await request('trades/sell',{mint:f.s.mint,quantity:'ALL'})).status).not.toBe(200);expect(await reconcileAccountLedger(db,account)).toEqual(partial);missing=false;
 f.now.value+=1000;const sellKey=randomUUID(),sell=await request('trades/sell',{mint:f.s.mint,quantity:'ALL'},sellKey,'https://trade.padre.gg');expect(sell.status,JSON.stringify(sell.body)).toBe(200);expect((await request('trades/sell',{mint:f.s.mint,quantity:'ALL'},sellKey)).body).toEqual(sell.body);
 f.now.value+=1000;const parallel=await Promise.all([0,1,2,3].map(()=>request('trades/buy',{mint:f.s.mint,paperSol:'0.01'})));expect(parallel.map(r=>r.status),JSON.stringify(parallel)).toEqual([200,200,200,200]);
 expect((await request('trades/sell',{mint:f.s.mint,quantity:'ALL'})).status).toBe(200);
 const financial=await reconcileAccountLedger(db,account);expect(financial.reconciled).toBe(true);expect(financial.quantityFromFills).toBe(0n);
 const proofPath=resolve('docs/linked-pair-20261024/public-paper-release-20261026/state-restart-child.mjs'),proof=await import(pathToFileURL(proofPath).href),expectedState=await proof.fingerprintAccount(db.pool,account),childState=JSON.parse(execFileSync(process.execPath,[proofPath],{env:{...process.env,DATABASE_URL:url,PAPERFUND_ACCOUNT_ID:account},encoding:'utf8'}));expect(childState).toEqual(expectedState);expect(childState.orders).toBe(8);expect(childState.fills).toBe(8);
 await instance.app.close();activeDb=h.createDatabase(url);scoped=compose();instance=makeApp();expect((await request('rounds/current/account')).status).toBe(200);expect(await reconcileAccountLedger(activeDb,account)).toEqual(financial);expect((await request('trades/sell',{mint:f.s.mint,quantity:'ALL'},sellKey)).body.fillId).toBe(sell.body.fillId);expect(await reconcileAccountLedger(activeDb,account)).toEqual(financial);
 await scoped.cap.control('fixture-admin','EXIT_ONLY');expect((await request('trades/buy',{mint:f.s.mint,paperSol:'0.01'})).status).not.toBe(200);expect(await reconcileAccountLedger(activeDb,account)).toEqual(financial);
 await h.runHourlyLifecycleTick(scoped.database,scoped.router,new Date(+f.cutoff+1000),60);expect((await db.pool.query('select state from hourly_rounds where id=$1',[f.round])).rows[0].state).toBe('SETTLING');expect((await db.pool.query('select count(*)::int n from hourly_results where competition_account_id=$1',[account])).rows[0].n).toBe(0);
 f.now.value=+f.cutoff;await scoped.cap.control('fixture-admin','ENTRY');expect((await request('trades/buy',{mint:f.s.mint,paperSol:'0.01'})).status).not.toBe(200);expect(await reconcileAccountLedger(activeDb,account)).toEqual(financial);
 }finally{await instance.app.close();if(activeDb!==db)await activeDb.close();if(beforeControl)await db.pool.query('update app_meta set value=$1 where key=$2',[beforeControl.value,policy.CONTROL]);else await db.pool.query('delete from app_meta where key=$1',[policy.CONTROL]);}
},120000);
/** Genuine Chrome MV3 + exact release payload + actual isolated API/ledger. Transport/chain are controlled. */
it.runIf(process.env['PAPERFUND_LINKED_BROWSER_TEST'] === 'true')(
  'Chrome candidate performs PAPER BUY, partial/full SELL with mixed flow and exact backend history',
  async () => {
    const evidenceDir = resolve('docs/linked-pair-20261023/browser-acceptance');
    const rc1 = process.env['PAPERFUND_LINKED_BROWSER_RC1'] === 'true';
    const candidate = resolve(
      rc1
        ? 'releases/extension-rc1/submission'
        : 'artifacts/linked-pair-rc1-0.2.1-candidate/submission',
    );
    const frozen = resolve('releases/extension-rc1/submission');
    const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
    const manifest = JSON.parse(readFileSync(join(candidate, 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe(rc1 ? '0.2.0' : '0.2.1');
    expect(manifest.host_permissions).toEqual(['https://api.paperfund.app/*']);
    const originalManifest = sha(join(frozen, 'manifest.json')),
      originalContent = sha(join(frozen, 'content.js'));
    const candidateContent = sha(join(candidate, 'content.js'));
    const pair = generateKeyPairSync('ed25519'),
      wallet = new PublicKey(
        pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
      ).toBase58();
    const base = (await controlledMixedInterval()).before;
    const withDirect = {
      ...base,
      linkedRoutes: [
        ...linkedBindings(base),
        {
          mint: base.quoteMint,
          quoteMint: SOL,
          targetPool: base.bridgePool,
          bridgePool: base.bridgePool,
        },
      ],
    };
    const mixed = atCutoff(
      await controlledMixedInterval(withDirect),
      new Date((Math.floor(Date.now() / 1000) + 2) * 1000),
    );
    const payout = await controlledCurvePayoutInterval(
      mixed.after,
      await curvePayoutSpec(mixed.after, true, 1000000n),
      mixed.blocks.at(-1)!.result.transactions.at(-1),
    );
    payout.anchor.blockhash = mixed.blocks.at(-1)!.result.blockhash;
    payout.blocks[0]!.result.previousBlockhash = payout.anchor.blockhash;
    const f = await setup([mixed, payout], 'ENTRY', true, wallet);
    // Controlled replay clock only: production freshness remains unchanged.
    const wallClock = vi.spyOn(Date, 'now').mockImplementation(() => f.now.value);
    const waitTrades = async (n: number) => {
      const start = performance.now();
      while (tradeResponses.length < n && performance.now() - start < 20000)
        await new Promise((r) => setTimeout(r, 100));
      expect(tradeResponses).toHaveLength(n);
    };
    const profile = join(dir, 'chrome-' + randomUUID());
    let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
    let browserApp: ReturnType<typeof buildApp> | undefined;
    let authenticatedHeaders: Record<string, string> = {};
    const requests: { method: string; path: string; status: number }[] = [],
      tradeResponses: Record<string, unknown>[] = [];
    try {
      context = await chromium.launchPersistentContext(profile, {
        executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        headless: false,
        offline: true,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: [
          '--enable-unsafe-extension-debugging',
          '--host-resolver-rules=MAP * ~NOTFOUND',
          '--disable-background-networking',
          '--no-first-run',
          '--disable-sync',
        ],
        viewport: { width: 1280, height: 900 },
      });
      const session = await context.browser()!.newBrowserCDPSession();
      const loaded = await session.send('Extensions.loadUnpacked', {
        path: candidate,
        enableInIncognito: false,
      });
      const review = await context.newPage();
      await review.goto('chrome://extensions/?id=' + loaded.id);
      const keep = review.getByRole('button', { name: 'Keep', exact: true });
      if (await keep.isVisible().catch(() => false)) await keep.click();
      await review.close();
      const memory = new BrowserMemoryRedis(),
        auth = new ActualAuthService(f.runtime.database, memory, 300, 3600);
      browserApp = buildApp({
        config: {
          LOG_LEVEL: 'silent',
          BETA_INVITE_ONLY: false,
          COOKIE_SECURE: true,
          COOKIE_SAME_SITE: 'none',
          AUTH_SESSION_TTL_SECONDS: 3600,
          ALLOWED_ORIGINS: 'chrome-extension://' + loaded.id + ',https://axiom.trade',
          API_RATE_LIMIT_WINDOW_SECONDS: 60,
          API_RATE_LIMIT_AUTH_MAX: 1000,
          API_RATE_LIMIT_TRADE_MAX: 1000,
        },
        database: f.runtime.database,
        redis: memory,
        auth,
        competition: f.runtime.competition,
        logger: false,
      });
      // Retained mint metadata for display only. No quote/price is supplied by the terminal fixture.
      const metadata = async (address: string) => {
        const route = linkedBindings(f.s).find(
          (r) => r.mint === address || r.targetPool === address,
        );
        if (!route) throw Error('FIXTURE_CONTEXT');
        const account = f.s.accounts[route.mint]!,
          raw = Buffer.from(account.base64, 'base64');
        return {
          requestedContext: address,
          mint: route.mint,
          tokenProgram: account.owner,
          tokenDecimals: raw[44]!,
          tokenSupplyBaseUnits: raw.readBigUInt64LE(36).toString(),
          chainSlot: String(f.s.slot),
        };
      };
      f.runtime.router.chartMetadataResolver = metadata;
      f.runtime.router.contextResolver = async (a) => (await metadata(a)).mint;
      await context.route('**/*', async (route) => {
        const request = route.request(),
          u = new URL(request.url());
        if (u.protocol === 'chrome-extension:') {
          await route.continue();
          return;
        }
        if (u.hostname === 'axiom.trade') {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html><head><title>Paperfund isolated route acceptance</title></head><body><main>CONTROLLED Axiom fixture — Paperfund paper trades only</main></body></html>',
          });
          return;
        }
        if (u.origin !== 'https://api.paperfund.app') {
          await route.abort();
          return;
        }
        const headers = { ...request.headers() };
        for (const k of ['host', 'content-length', 'accept-encoding', 'connection'])
          delete headers[k];
        if (headers['authorization'])
          authenticatedHeaders = { authorization: headers['authorization'] };
        const response = await browserApp!.inject({
          method: request.method() as 'GET' | 'POST' | 'OPTIONS',
          url: u.pathname + u.search,
          headers,
          ...(request.postData() ? { payload: request.postData()! } : {}),
        });
        requests.push({ method: request.method(), path: u.pathname, status: response.statusCode });
        if (u.pathname === '/api/v1/trades/buy' && response.statusCode === 200) {
          tradeResponses.push(response.json());
          if (tradeResponses.length === 1) {
            f.rpc.bank = mixed.after;
            f.now.value = Date.parse(mixed.after.observedAt);
          }
        }
        if (u.pathname === '/api/v1/trades/sell' && response.statusCode === 200) {
          tradeResponses.push(response.json());
          if (tradeResponses.length === 2) {
            f.rpc.bank = payout.after;
            f.now.value = Date.parse(payout.after.observedAt);
          }
        }
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(response.headers))
          if (v !== undefined && k !== 'content-length' && k !== 'content-encoding')
            out[k] = Array.isArray(v) ? v.join(', ') : String(v);
        await route.fulfill({ status: response.statusCode, headers: out, body: response.body });
      });
      await context.addInitScript(
        async ({ wallet, key }) => {
          if (
            (globalThis as unknown as { location: { hostname: string } }).location.hostname !==
            'axiom.trade'
          )
            return;
          const secret = await crypto.subtle.importKey(
            'pkcs8',
            Uint8Array.from(atob(key), (c) => c.charCodeAt(0)),
            'Ed25519',
            false,
            ['sign'],
          );
          Object.defineProperty(globalThis, 'solana', {
            configurable: true,
            value: {
              publicKey: { toString: () => wallet },
              connect: async () => ({ publicKey: { toString: () => wallet } }),
              signMessage: async (message: Uint8Array) => ({
                signature: new Uint8Array(await crypto.subtle.sign('Ed25519', secret, message)),
              }),
            },
          });
        },
        {
          wallet,
          key: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
        },
      );
      const page = await context.newPage();
      const browserErrors: string[] = [];
      page.on('pageerror', (e) => browserErrors.push(e.message));
      await page.goto('https://axiom.trade/meme/' + f.s.mint + '?chain=sol');
      await page
        .getByRole('region', { name: 'Paperfund paper trading overlay' })
        .waitFor({ timeout: 20000 });
      await page.getByRole('button', { name: 'CONNECT WALLET' }).click();
      await page.getByRole('button', { name: 'SIGN IN TO PAPERFUND' }).click();
      await page.getByLabel('Paper SOL amount').waitFor({ timeout: 20000 });
      await page.getByLabel('Paper SOL amount').fill('0.01');
      await page.getByRole('button', { name: 'BUY · PAPER ONLY' }).click();
      await waitTrades(1);
      await page.getByRole('button', { name: 'SELL ALL', exact: true }).waitFor({ timeout: 15000 });
      await page.getByRole('button', { name: '25%', exact: true }).last().click();
      await waitTrades(2);
      await page.getByRole('button', { name: 'SELL ALL', exact: true }).click();
      await waitTrades(3);
      await page.getByText(/Sold all/).waitFor({ timeout: 15000 });
      const account = await f.runtime.competition.getCurrentAccount(f.user);
      expect(account!.positions).toHaveLength(0);
      const expected =
        10000000000n -
        BigInt(String(tradeResponses[0]!['actualPaperSolSpentLamports'])) +
        BigInt(String(tradeResponses[1]!['paperSolCreditedLamports'])) +
        BigInt(String(tradeResponses[2]!['paperSolCreditedLamports']));
      // Verify using immutable fills rather than depending on display rounding or response naming.
      const fills = (
        await db.pool.query(
          'select f.side,f.base_quantity::text,f.actual_input_lamports::text,f.actual_output_lamports::text,f.fee_lamports::text from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1 order by f.executed_at,f.id',
          [f.account],
        )
      ).rows;
      const buy = fills.find((x) => x.side === 'BUY')!,
        sells = fills.filter((x) => x.side === 'SELL');
      expect(sells).toHaveLength(2);
      const cash =
        10000000000n -
        BigInt(buy.actual_input_lamports) +
        sells.reduce((n, x) => n + BigInt(x.actual_output_lamports), 0n);
      expect(BigInt(account!.paper_sol_balance_lamports)).toBe(cash);
      expect(expected).toBe(cash);

      expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
      await f.store.recover();
      expect(
        (
          await db.pool.query(
            'select count(*)::int n from linked_candidate.receipts where account_id=$1',
            [f.account],
          )
        ).rows[0].n,
      ).toBe(3);
      const history = await browserApp.inject({
        method: 'GET',
        url: '/api/v1/trades?limit=100',
        headers: authenticatedHeaders,
      });
      expect(history.statusCode).toBe(200);
      const historyIds = history.json().items.map((x: { id: string }) => x.id);
      expect(historyIds.sort()).toEqual(tradeResponses.map((x) => String(x['fillId'])).sort());
      const shadow = await page
        .locator('#paperfund-extension-root')
        .evaluate((el) => el.shadowRoot?.textContent ?? '');
      expect(shadow).toContain('Sold all');
      await page.screenshot({
        path: join(evidenceDir, 'chrome-' + manifest.version + '-paper-roundtrip.png'),
      });
      const report = {
        pass: true,
        artifactVersion: manifest.version,
        extensionId: loaded.id,
        transport: 'CHROME_MV3_HTTPS_INTERCEPT_TO_ACTUAL_APP_INJECT_NO_LISTENER',
        chain: 'CONTROLLED_MIXED_AND_V2_PAYOUT_SUCCESSORS_ON_RETAINED_ACCOUNTS',
        paperBuy: '0.01',
        partialSell: '25%',
        fullSell: true,
        cashLamports: String(cash),
        historyIds,
        fills,
        requests,
        browserErrors,
        realTransactions: 0,
        productionTouched: false,
        rc1Unchanged:
          sha(join(frozen, 'manifest.json')) === originalManifest &&
          sha(join(frozen, 'content.js')) === originalContent,
        candidateUnchanged: sha(join(candidate, 'content.js')) === candidateContent,
      };
      const { writeFileSync } = await import('node:fs');
      writeFileSync(
        join(evidenceDir, 'chrome-' + manifest.version + '-results.json'),
        JSON.stringify(report, null, 2),
      );
    } catch (error) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(
        join(evidenceDir, 'chrome-failure.json'),
        JSON.stringify({ error: String(error), requests }, null, 2),
      );
      if (context) {
        const p = context.pages().at(-1);
        if (p)
          await p.screenshot({ path: join(evidenceDir, 'chrome-failure.png') }).catch(() => {});
      }
      throw error;
    } finally {
      wallClock.mockRestore();
      await context?.close();
      await browserApp?.close();
      await f.app.close();
    }
  },
  180000,
);

async function admissionAudit(account: string) {
  return (
    await db.pool.query(
      `select a.paper_sol_balance_lamports::text cash,
 (select count(*)::int from orders o where o.competition_account_id=a.id) orders,
 (select count(*)::int from fills f join orders o on o.id=f.order_id where o.competition_account_id=a.id) fills,
 (select count(*)::int from positions p where p.competition_account_id=a.id) positions,
 (select count(*)::int from ledger_entries l where l.competition_account_id=a.id) ledger,
 (select count(*)::int from idempotency_records i where i.competition_account_id=a.id) intents,
 (select count(*)::int from linked_candidate.receipts r where r.account_id=a.id) receipts
 from competition_accounts a where a.id=$1`,
      [account],
    )
  ).rows[0];
}
it('global BUY ceiling denies direct SOL, PumpSwap, Orca and linked contexts from every terminal before effects, with permissive route permissions', async () => {
  const f = await setup([await controlledOrcaMovement(controlledAutomaticRoutes())], 'ENTRY', true);
  const before = await admissionAudit(f.account),
    head = await f.store.load();
  const legacyGrant = {
    schema: 'GENERIC_OPERATOR_CONTROL_V1',
    mode: 'ENTRY',
    expiresAt: Date.parse('2026-10-12T07:38:43Z'),
  };
  await db.pool.query(
    'insert into app_meta(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',
    ['generic_pumpswap_operator_control_v1', JSON.stringify(legacyGrant)],
  );
  fixtureBuyAdmission = async () => false;
  try {
    for (const origin of ['https://axiom.trade', 'https://gmgn.ai', 'https://trade.padre.gg'])
      for (const mint of [
        f.s.mint,
        f.s.quoteMint,
        '2B9cEbjF2sNmDsfvcgMQGasvP7573GnaTu1s1Dy1pump',
      ]) {
        const key = randomUUID();
        for (let retry = 0; retry < 2; retry++) {
          const response = await f.app.inject({
            method: 'POST',
            url: '/api/v1/trades/buy',
            headers: { origin, authorization: 'Bearer ' + f.user, 'idempotency-key': key },
            payload: { mint, paperSol: '0.01' },
          });
          expect(response.statusCode, response.body).toBe(403);
          expect(response.json().error.code).toBe('PAPER_BUY_DISABLED');
        }
      }
    await db.pool.query('update app_meta set value=$2 where key=$1', [
      'generic_pumpswap_operator_control_v1',
      JSON.stringify({ ...legacyGrant, expiresAt: Date.now() + 60000 }),
    ]);
    expect((await f.request('trades/buy', { mint: f.s.mint, paperSol: '0.01' })).status).toBe(403);
    expect(await admissionAudit(f.account)).toEqual(before);
    expect((await f.store.load()).state_hash).toBe(head.state_hash);
    expect(f.rpc.calls).toHaveLength(0);
    expect(f.permission).not.toHaveBeenCalled();
  } finally {
    fixtureBuyAdmission = async () => true;
    await f.app.close();
  }
}, 120000);
it('missing, unavailable and malformed global BUY authority fail closed before authoritative or legacy order effects', async () => {
  const f = await setup([real[0]!]);
  try {
    const before = await admissionAudit(f.account),
      closed = createDatabase(url);
    const connect = vi.spyOn(closed.pool, 'connect');
    try {
      for (const authorizePaperBuy of [
        undefined,
        async () => {
          throw Error('AUTHORIZATION_UNAVAILABLE');
        },
        async () => undefined,
        async () => 'ENTRY',
      ]) {
        const bad = { ...closed, authorizePaperBuy } as unknown as DatabaseService;
        await expect(assertPaperBuyAdmission(bad, { accountId: f.account })).rejects.toMatchObject({
          code: 'PAPER_BUY_DISABLED',
        });
        await expect(
          executePaperBuy(bad, f.runtime.router, {
            competitionAccountId: f.account,
            marketId: 'direct-or-linked',
            requestedPaperSolLamports: 10000000n,
            idempotencyKey: randomUUID(),
            authoritativeTimestamp: new Date(f.now.value),
          }),
        ).rejects.toMatchObject({ code: 'PAPER_BUY_DISABLED' });
        await expect(
          createOrder(bad, {
            orderId: randomUUID(),
            accountId: f.account,
            marketId: 'legacy',
            side: 'BUY',
            requestedQuoteLamports: 10000000n,
            requestedAt: new Date(f.now.value),
            idempotencyKey: randomUUID(),
          }),
        ).rejects.toMatchObject({ code: 'PAPER_BUY_DISABLED' });
      }
      expect(connect).not.toHaveBeenCalled();
    } finally {
      connect.mockRestore();
      await closed.close();
    }
    expect(await admissionAudit(f.account)).toEqual(before);
  } finally {
    await f.app.close();
  }
}, 120000);
it('legacy BUY fills, completed BUY replays and pending intent retries cannot bypass a closed global ceiling', async () => {
  const f = await setup([real[0]!]);
  try {
    const key = randomUUID(),
      b = await f.request('trades/buy', { mint: f.s.mint, paperSol: '0.01' }, key);
    expect(b.status).toBe(200);
    expect((await f.request('trades/buy', { mint: f.s.mint, paperSol: '0.01' }, key)).body).toEqual(
      b.body,
    );
    const market = genericPumpSwapIdentity(f.s.mint, f.s.quoteMint, f.s.bridgePool).marketId;
    const orderId = await createOrder(db, {
      orderId: randomUUID(),
      accountId: f.account,
      marketId: market,
      side: 'BUY',
      requestedQuoteLamports: 10000000n,
      requestedAt: new Date(f.now.value),
      idempotencyKey: randomUUID(),
    });
    const before = await admissionAudit(f.account),
      head = await f.store.load();
    fixtureBuyAdmission = async () => false;
    expect((await f.request('trades/buy', { mint: f.s.mint, paperSol: '0.01' }, key)).status).toBe(
      403,
    );
    const fill = {
      fillId: randomUUID(),
      executionId: randomUUID(),
      orderId,
      baseQuantity: 1n,
      quoteLamports: 1n,
      executionPrice: '1',
      feeLamports: 0n,
      executedAt: new Date(f.now.value),
      idempotencyKey: randomUUID(),
    };
    for (let retry = 0; retry < 2; retry++)
      await expect(applyFill(db, fill)).rejects.toMatchObject({ code: 'PAPER_BUY_DISABLED' });
    expect(await admissionAudit(f.account)).toEqual(before);
    expect((await f.store.load()).state_hash).toBe(head.state_hash);
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    fixtureBuyAdmission = async () => true;
    await f.app.close();
  }
}, 120000);
it('global BUY restriction rechecks inside the transaction and before accepted native writes', async () => {
  const f = await setup([real[0]!]);
  try {
    const before = await admissionAudit(f.account),
      head = await f.store.load();
    // Direct backend caller bypasses the early HTTP check; deny after native simulation.
    let calls = 0;
    fixtureBuyAdmission = async () => ++calls < 3;
    await expect(
      executePaperBuy(db, f.runtime.router, {
        competitionAccountId: f.account,
        marketId: genericPumpSwapIdentity(f.s.mint, f.s.quoteMint, f.s.bridgePool).marketId,
        requestedPaperSolLamports: 10000000n,
        idempotencyKey: randomUUID(),
        authoritativeTimestamp: new Date(f.now.value),
      }),
    ).rejects.toMatchObject({ code: 'PAPER_BUY_DISABLED' });
    expect(calls).toBe(3);
    expect(await admissionAudit(f.account)).toEqual(before);
    expect((await f.store.load()).state_hash).toBe(head.state_hash);
  } finally {
    fixtureBuyAdmission = async () => true;
    await f.app.close();
  }
}, 120000);
it('global EXIT_ONLY preserves authorized partial/full SELL and does not override an existing stricter route hold', async () => {
  const f = await setup([real[0]!]);
  try {
    expect((await f.request('trades/buy', { mint: f.s.mint, paperSol: '0.01' })).status).toBe(200);
    const held = await f.runtime.competition.getCurrentAccount(f.user),
      q = BigInt(held!.positions[0]!.remaining_base_units);
    fixtureBuyAdmission = async () => false;
    f.scope.mode = 'EXIT_ONLY';
    expect(
      (await f.request('trades/sell', { mint: f.s.mint, quantity: (q / 4n).toString() })).status,
    ).toBe(200);
    const before = await admissionAudit(f.account);
    f.permission.mockRejectedValue(new Error('EXISTING_HARD_STOP'));
    expect((await f.request('trades/sell', { mint: f.s.mint, quantity: 'ALL' })).status).not.toBe(
      200,
    );
    expect(await admissionAudit(f.account)).toEqual(before);
    f.permission.mockResolvedValue({
      discover: true,
      buy: true,
      authorizeLive: vi.fn(async () => undefined),
    });
    expect((await f.request('trades/sell', { mint: f.s.mint, quantity: 'ALL' })).status).toBe(200);
    expect((await f.runtime.competition.getCurrentAccount(f.user))!.positions).toHaveLength(0);
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
  } finally {
    fixtureBuyAdmission = async () => true;
    await f.app.close();
  }
}, 120000);

it('operational receipt-proven EXIT_ONLY retains real capability HARD_STOP and executes partial/full exits without a new BUY grant', async () => {
  const f = await setup([compositeInterval()], 'ENTRY', true);
  const bundle = await import(
    pathToFileURL(resolve(process.env['PAPERFUND_ADMISSION_BUNDLE']!)).href
  );
  const controlKey = 'generic_pumpswap_operator_control_v1';
  const prior = (await db.pool.query('select value from app_meta where key=$1', [controlKey]))
    .rows[0];
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    expect((await f.request('trades/buy', { mint: f.s.mint, paperSol: '0.01' })).status).toBe(200);
    const closedDatabase = { ...db, authorizePaperBuy: async () => false };
    const capability = new bundle.GenericCapability(
      closedDatabase,
      { armed: true, entries: false, normalUserAccess: true, operatorIds: [], entrySeconds: 60 },
      () => f.now.value,
    );
    const permission = bundle.scopedExitPermission(
      closedDatabase,
      capability,
      [f.scope],
      false,
      () => f.now.value,
    );
    const runtime = await bundle.composeScopedProduction({
      database: closedDatabase,
      baselineRouter: f.baseline,
      scopes: [{ ...f.scope, mode: 'EXIT_ONLY' }],
      now: () => f.now.value,
      resolvePermission: permission,
    });
    app = bundle.buildApp({
      config: {
        LOG_LEVEL: 'silent',
        BETA_INVITE_ONLY: false,
        ALLOWED_ORIGINS: 'https://axiom.trade,https://gmgn.ai,https://trade.padre.gg',
      },
      database: runtime.database,
      redis: { healthCheck: async () => true },
      auth: {
        authenticate: async (token: string) =>
          token === f.user ? { id: f.user, walletAddress: 'fixture-wallet' } : null,
      },
      competition: runtime.competition,
      logger: false,
    });
    const request = async (
      endpoint: string,
      payload: Record<string, string>,
      key = randomUUID(),
    ) => {
      const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/' + endpoint,
        headers: { authorization: 'Bearer ' + f.user, 'idempotency-key': key },
        payload,
      });
      return { status: response.statusCode, body: response.json() };
    };
    const before = await db.pool.query(
      'select count(*)::int n from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1',
      [f.account],
    );
    expect(
      (await request('trades/buy', { mint: f.s.mint, paperSol: '0.01' })).body.error.code,
    ).toBe('PAPER_BUY_DISABLED');
    await db.pool.query(
      'insert into app_meta(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',
      [controlKey, JSON.stringify({ schema: 'GENERIC_OPERATOR_CONTROL_V1', mode: 'HARD_STOP' })],
    );
    expect((await request('trades/sell', { mint: f.s.mint, quantity: 'ALL' })).status).not.toBe(
      200,
    );
    expect(
      (
        await db.pool.query(
          'select count(*)::int n from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1',
          [f.account],
        )
      ).rows,
    ).toEqual(before.rows);
    await db.pool.query('update app_meta set value=$2 where key=$1', [
      controlKey,
      JSON.stringify({ schema: 'GENERIC_OPERATOR_CONTROL_V1', mode: 'EXIT_ONLY' }),
    ]);
    const account = await runtime.competition.getCurrentAccount(f.user),
      quantity = BigInt(account.positions[0].remaining_base_units),
      key = randomUUID();
    const partial = await request(
      'trades/sell',
      { mint: f.s.mint, quantity: (quantity / 4n).toString() },
      key,
    );
    expect(partial.status, JSON.stringify(partial.body)).toBe(200);
    expect(
      await request('trades/sell', { mint: f.s.mint, quantity: (quantity / 4n).toString() }, key),
    ).toEqual(partial);
    const full = await request('trades/sell', { mint: f.s.mint, quantity: 'ALL' });
    expect(full.status, JSON.stringify(full.body)).toBe(200);
    expect((await runtime.competition.getCurrentAccount(f.user)).positions).toHaveLength(0);
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
    expect(
      (
        await db.pool.query(
          'select count(*)::int n from linked_candidate.receipts where account_id=$1',
          [f.account],
        )
      ).rows[0].n,
    ).toBe(3);
  } finally {
    await app?.close();
    await f.app.close();
    if (prior)
      await db.pool.query(
        'insert into app_meta(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',
        [controlKey, prior.value],
      );
    else await db.pool.query('delete from app_meta where key=$1', [controlKey]);
  }
});

it('operational worker capability force-settles the same receipt-proven branch at the UTC frontier and recovers exactly once', async () => {
  const e = atCutoff(await controlledMixedInterval(), new Date('2026-10-21T22:00:00Z')),
    f = await setup([e], 'ENTRY', true),
    bundle = await import(pathToFileURL(resolve(process.env['PAPERFUND_ADMISSION_BUNDLE']!)).href);
  try {
    expect((await f.request('trades/buy', { mint: f.s.mint, paperSol: '0.01' })).status).toBe(200);
    const closed = { ...db, authorizePaperBuy: async () => false },
      capability = new bundle.GenericCapability(
        closed,
        {
          armed: true,
          entries: false,
          normalUserAccess: true,
          operatorIds: [],
          entrySeconds: 60,
          systemSettlement: true,
        },
        () => f.now.value,
      ),
      permission = bundle.scopedExitPermission(
        closed,
        capability,
        [f.scope],
        true,
        () => f.now.value,
      );
    const compose = () =>
      bundle.composeScopedProduction({
        database: closed,
        baselineRouter: f.baseline,
        scopes: [{ ...f.scope, mode: 'EXIT_ONLY' }],
        now: () => f.now.value,
        resolvePermission: permission,
      });
    const last = e.blocks.at(-1)!;
    f.rpc.blocks.set(last.slot + 1, {
      parentSlot: last.slot,
      previousBlockhash: last.result.blockhash,
      blockhash: 'CONTROLLED_OPERATIONAL_NEXT',
      blockTime: f.cutoff.getTime() / 1000,
      transactions: [],
    });
    f.rpc.bank = e.after;
    f.now.value = f.cutoff.getTime() + 1000;
    const runtime = await compose(),
      result = await runtime.settle(f.round);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.state).toBe('FINALIZED');
    expect((await (await compose()).settle(f.round)).forcedSells).toEqual([]);
    await f.store.recover();
    expect((await reconcileAccountLedger(db, f.account)).reconciled).toBe(true);
    expect(
      (
        await db.pool.query(
          'select count(*)::int n from linked_candidate.receipts where account_id=$1',
          [f.account],
        )
      ).rows[0].n,
    ).toBe(2);
  } finally {
    await f.app.close();
  }
}, 120000);
