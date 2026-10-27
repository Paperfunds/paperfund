import { identifier } from '@paperfund/core';
import { join } from 'node:path';
import { AuthService } from '../../../../apps/api/src/auth.js';
import { buildApp } from '../../../../apps/api/src/app.js';
import { ExecutionRouter } from '@paperfund/execution';
import { IntegrationHarness } from '../../integration/simple-price-v2-directional/test-harness.js';
import {
  IsolatedV2Adapter,
  PROTOCOL,
} from '../../integration/simple-price-v2-directional/adapter.js';
import { IsolatedCompetitionService } from '../../integration/simple-price-v2-directional/service.js';
import { IsolatedHighWater } from '../../candidates/simple-price-v2-directional/high-water.js';
import { controlledReplay, solRecordings, REPLAY_POLICY } from './fixtures.js';
export class ReplayHarness extends IntegrationHarness {
  readonly original = solRecordings()[0]!.evidence;
  readonly policy = REPLAY_POLICY;
  directory = '';
  token = '';
  override async start() {
    const owned = await this.owner.start();
    this.database = owned.database;
    this.directory = join(owned.directory, 'recovery-authority');
    this.token = owned.token;
    const adapter = new IsolatedV2Adapter(
      this.database,
      this.token,
      this.policy,
      async () => controlledReplay(this.original, this.now.getTime()),
      new IsolatedHighWater(this.directory, this.policy),
      () => this.now,
    );
    this.router = new ExecutionRouter([adapter]);
    this.router.mintResolver = async (mint) => ({
      protocolId: PROTOCOL,
      marketId: identifier(this.original.identity.market, 'MarketId'),
      tokenMint: identifier(mint, 'TokenMint'),
    });
    this.competition = new IsolatedCompetitionService(
      this.database,
      this.router,
      () => this.now,
      this.policy,
    );
    const auth = new AuthService(this.database, this.redis, 300, 3600000, () => this.now);
    this.app = buildApp({
      config: { LOG_LEVEL: 'silent' },
      database: this.database,
      redis: this.redis,
      auth,
      competition: this.competition,
      logger: false,
    });
    const i = this.original.identity;
    this.markets.set(i.mint, i);
    await this.database.pool.query(
      'insert into assets(id,mint_address,decimals) values($1,$1,6),($2,$2,9)',
      [i.mint, i.quote],
    );
    await this.database.pool.query(
      'insert into markets(id,base_asset_id,quote_asset_id,venue,provider_market_id) values($1,$2,$3,$4,$1)',
      [i.market, i.mint, i.quote, PROTOCOL],
    );
  }
  override async close() {
    if (this.app) await this.app.close();
    await this.redis.close();
    await this.owner.close();
  }
}
