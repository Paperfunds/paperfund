import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthService } from '../../../../apps/api/src/auth.js';
import { buildApp } from '../../../../apps/api/src/app.js';
import type { RedisService } from '../../../../apps/api/src/redis.js';
import { ExecutionRouter } from '@paperfund/execution';
import { identifier } from '@paperfund/core';
import { createHourlyRound, ensureDailyCompetition } from '@paperfund/db';
import { pumpBondingCurveAddress } from '@paperfund/protocols';
import { DisposableDatabase } from '../simple-price-v2/disposable.js';
import { IsolatedV2Adapter, PROTOCOL } from './adapter.js';
import { IsolatedCompetitionService, bindPrivateRound } from './service.js';
import { IsolatedHighWater } from '../../candidates/simple-price-v2-directional/high-water.js';
import {
  synthetic,
  POLICY,
  SOL,
} from '../../candidates/simple-price-v2-directional/test-support.js';
import type {
  Evidence,
  Identity,
  Rational,
} from '../../candidates/simple-price-v2-directional/model.js';
import type { MarketIdentity } from '@paperfund/execution';
class MemoryRedis implements RedisService {
  private values = new Map<string, string>();
  async healthCheck() {
    return true;
  }
  async get(k: string) {
    return this.values.get(k) ?? null;
  }
  async setExpiring(k: string, v: string) {
    this.values.set(k, v);
  }
  async take(k: string) {
    const v = this.values.get(k) ?? null;
    this.values.delete(k);
    return v;
  }
  async delete(k: string) {
    this.values.delete(k);
  }
  async incrementWindow() {
    return 1;
  }
  async close() {
    this.values.clear();
  }
}
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(bytes: Buffer) {
  let n = BigInt('0x' + bytes.toString('hex')),
    s = '';
  while (n > 0n) {
    s = alphabet[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    s = '1' + s;
  }
  return s;
}
export class IntegrationHarness {
  readonly owner = new DisposableDatabase();
  database!: Awaited<ReturnType<DisposableDatabase['start']>>['database'];
  app!: ReturnType<typeof buildApp>;
  router!: ExecutionRouter;
  competition!: IsolatedCompetitionService;
  readonly redis = new MemoryRedis();
  readonly observations = new Map<string, Evidence>();
  readonly missing = new Set<string>();
  readonly markets = new Map<string, Identity>();
  readonly notes: Record<string, unknown> = {};
  now = new Date('2030-01-01T00:00:00Z');
  private hour = 0;
  async start() {
    const { database, directory, token } = await this.owner.start();
    this.database = database;
    const adapter = new IsolatedV2Adapter(
      database,
      token,
      POLICY,
      async (identity) => {
        if (this.missing.has(identity.tokenMint)) throw new Error('FIXTURE_PRICE_MISSING');
        const i = this.markets.get(identity.tokenMint);
        if (!i) throw new Error('FIXTURE_MARKET_MISSING');
        return this.observations.get(identity.tokenMint) ?? synthetic(i, this.now.getTime());
      },
      new IsolatedHighWater(join(directory, 'provider-authority'), POLICY),
      () => this.now,
    );
    this.router = new ExecutionRouter([adapter]);
    this.router.mintResolver = async (mint) => ({
      protocolId: PROTOCOL,
      marketId: identifier(this.markets.get(mint)!.market, 'MarketId'),
      tokenMint: identifier(mint, 'TokenMint'),
    });
    this.competition = new IsolatedCompetitionService(
      database,
      this.router,
      () => this.now,
      POLICY,
    );
    const auth = new AuthService(database, this.redis, 300, 3_600_000, () => this.now);
    this.app = buildApp({
      config: { LOG_LEVEL: 'silent' },
      database,
      redis: this.redis,
      auth,
      competition: this.competition,
      logger: false,
    });
  }
  async round(model?: string, startsAt?: Date) {
    const automatic = new Date(Date.UTC(2030, 0, 1, this.hour++));
    const starts = startsAt ?? automatic,
      id = 'private-round:' + starts.toISOString(),
      cutoff = new Date(starts.getTime() + 3_600_000);
    this.now = new Date(starts.getTime() + 1000);
    this.observations.clear();
    this.missing.clear();
    await ensureDailyCompetition(this.database, starts);
    await createHourlyRound(this.database, {
      id,
      startsAt: starts,
      endsAtExclusive: cutoff,
      rulesVersion: 'FIXTURE_ONLY_V2',
      state: 'SCHEDULED',
    });
    await bindPrivateRound(this.database, id, POLICY, model);
    await this.database.pool.query("update hourly_rounds set state='OPEN' where id=$1", [id]);
    return { id, starts, cutoff };
  }
  async market() {
    const keys = generateKeyPairSync('ed25519');
    const mint = base58(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
    const market = await pumpBondingCurveAddress(mint);
    const identity: Identity = { mint, market, quote: 'SOL' };
    this.markets.set(mint, identity);
    await this.database.pool.query(
      'insert into assets(id,mint_address,decimals) values($1,$1,6) on conflict do nothing',
      [mint],
    );
    await this.database.pool.query(
      "insert into assets(id,mint_address,decimals) values('fixture-sol','fixture-sol',9) on conflict do nothing",
    );
    await this.database.pool.query(
      "insert into markets(id,base_asset_id,quote_asset_id,venue,provider_market_id) values($1,$2,'fixture-sol',$3,$1)",
      [market, mint, PROTOCOL],
    );
    return identity;
  }
  async user() {
    const keys = generateKeyPairSync('ed25519'),
      wallet = base58(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
    const challenge = (
      await this.app.inject({
        method: 'POST',
        url: '/api/v1/auth/challenge',
        payload: { walletAddress: wallet },
      })
    ).json();
    const response = await this.app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: {
        walletAddress: wallet,
        challengeId: challenge.challengeId,
        message: challenge.message,
        signature: sign(null, Buffer.from(challenge.message), keys.privateKey).toString('base64'),
        transport: 'extension',
      },
    });
    if (response.statusCode !== 200) throw new Error(response.body);
    const value = response.json(),
      headers = { authorization: 'Bearer ' + value.sessionToken };
    const account = (
      await this.app.inject({ method: 'POST', url: '/api/v1/rounds/current/enter', headers })
    ).json();
    const current = (
      await this.app.inject({ method: 'GET', url: '/api/v1/rounds/current/account', headers })
    ).json();
    return { id: value.user.id, headers, accountId: current.accountId, initial: account };
  }
  async buy(
    user: Awaited<ReturnType<IntegrationHarness['user']>>,
    i: Identity,
    sol = '1',
    key: string = randomUUID(),
  ) {
    return this.app.inject({
      method: 'POST',
      url: '/api/v1/trades/buy',
      headers: { ...user.headers, 'idempotency-key': key },
      payload: { mint: i.mint, paperSol: sol },
    });
  }
  async sell(
    user: Awaited<ReturnType<IntegrationHarness['user']>>,
    i: Identity,
    quantity = 'ALL',
    key: string = randomUUID(),
  ) {
    return this.app.inject({
      method: 'POST',
      url: '/api/v1/trades/sell',
      headers: { ...user.headers, 'idempotency-key': key },
      payload: { mint: i.mint, quantity },
    });
  }
  async positions(user: Awaited<ReturnType<IntegrationHarness['user']>>) {
    return this.app.inject({ method: 'GET', url: '/api/v1/positions', headers: user.headers });
  }
  move(i: Identity, p: Rational) {
    this.now = new Date(this.now.getTime() + 1);
    this.observations.set(i.mint, synthetic(i, this.now.getTime(), p));
  }
  async close() {
    writeFileSync(
      'artifacts/simple-price-v2-directional-review/api-numerical.json',
      JSON.stringify(this.notes, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2),
    );
    if (this.app) await this.app.close();
    await this.redis.close();
    await this.owner.close();
  }
}
export { SOL, POLICY };
export type { MarketIdentity };
