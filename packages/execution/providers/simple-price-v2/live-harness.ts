import { join } from 'node:path';
import { AuthService } from '../../../../apps/api/src/auth.js';
import { buildApp } from '../../../../apps/api/src/app.js';
import { ExecutionRouter } from '@paperfund/execution';
import { identifier } from '@paperfund/core';
import { createHourlyRound, ensureDailyCompetition } from '@paperfund/db';
import { canonicalPumpSwapPoolAddress, WRAPPED_SOL_MINT } from '@paperfund/protocols';
import { IntegrationHarness } from '../../integration/simple-price-v2/test-harness.js';
import { PROTOCOL } from '../../integration/simple-price-v2/adapter.js';
import {
  IsolatedCompetitionService,
  bindPrivateRound,
} from '../../integration/simple-price-v2/service.js';
import { RealIsolatedAdapter } from './adapter.js';
import { REAL_POLICY } from './provider.js';
import type { Identity } from '../../candidates/simple-price-v2/model.js';
/** Reuses disposable PostgreSQL owner, actual API and unchanged financial service from prior acceptance. */
export class LiveHarness extends IntegrationHarness {
  adapter!: RealIsolatedAdapter;
  override async start() {
    const { database, directory, token } = await this.owner.start();
    this.database = database;
    this.adapter = new RealIsolatedAdapter(
      database,
      token,
      join(directory, 'real-provider-authority'),
    );
    this.router = new ExecutionRouter([this.adapter]);
    this.router.mintResolver = async (mint) => ({
      protocolId: PROTOCOL,
      marketId: identifier(await canonicalPumpSwapPoolAddress(mint), 'MarketId'),
      tokenMint: identifier(mint, 'TokenMint'),
    });
    this.competition = new IsolatedCompetitionService(
      database,
      this.router,
      () => new Date(),
      REAL_POLICY,
    );
    const auth = new AuthService(database, this.redis, 300, 3600000, () => new Date());
    this.app = buildApp({
      config: { LOG_LEVEL: 'silent' },
      database,
      redis: this.redis,
      auth,
      competition: this.competition,
      logger: false,
    });
  }
  override async round(model?: string) {
    const starts = new Date(Math.floor(Date.now() / 3600000) * 3600000),
      cutoff = new Date(starts.getTime() + 3600000),
      id = 'private-real:' + crypto.randomUUID();
    await ensureDailyCompetition(this.database, starts);
    await createHourlyRound(this.database, {
      id,
      startsAt: starts,
      endsAtExclusive: cutoff,
      rulesVersion: 'UNAPPROVED_REAL_PRIVATE_V2',
      state: 'SCHEDULED',
    });
    await bindPrivateRound(this.database, id, REAL_POLICY, model);
    await this.database.pool.query("update hourly_rounds set state='OPEN' where id=$1", [id]);
    return { id, starts, cutoff };
  }
  async register(mint: string): Promise<Identity> {
    const capture = await this.adapter.provider.capture(mint),
      i = capture.evidence.identity;
    this.markets.set(mint, i);
    await this.database.pool.query(
      'insert into assets(id,mint_address,decimals) values($1,$1,$2) on conflict do nothing',
      [mint, Number(capture.tokenDecimals)],
    );
    await this.database.pool.query(
      'insert into assets(id,mint_address,decimals) values($1,$1,9) on conflict do nothing',
      [WRAPPED_SOL_MINT],
    );
    await this.database.pool.query(
      'insert into markets(id,base_asset_id,quote_asset_id,venue,provider_market_id) values($1,$2,$3,$4,$1)',
      [i.market, mint, WRAPPED_SOL_MINT, PROTOCOL],
    );
    return i;
  }
  override async close() {
    if (this.app) await this.app.close();
    await this.redis.close();
    await this.owner.close();
  }
}
