import { join } from 'node:path';
import { AuthService } from '../../../../apps/api/src/auth.js';
import { buildApp } from '../../../../apps/api/src/app.js';
import { ExecutionRouter } from '@paperfund/execution';
import { createHourlyRound, ensureDailyCompetition } from '@paperfund/db';
import { identifier } from '@paperfund/core';
import { WRAPPED_SOL_MINT } from '@paperfund/protocols';
import { IntegrationHarness } from '../../integration/simple-price-v2-directional/test-harness.js';
import { PROTOCOL } from '../../integration/simple-price-v2-directional/adapter.js';
import {
  IsolatedCompetitionService,
  bindPrivateRound,
} from '../../integration/simple-price-v2-directional/service.js';
import type { Identity } from '../../candidates/simple-price-v2-directional/model.js';
import { AtomicIsolatedAdapter } from './adapter.js';
import { ATOMIC_POLICY } from './provider.js';
import type { AtomicCapture } from './provider.js';
/** New disposable server only; real read-only acquisition, unchanged auth/API/accounting. */
export class AtomicHarness extends IntegrationHarness {
  private lastRequest = 0;
  private async requestBudget() {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 750 - (Date.now() - this.lastRequest))),
    );
    this.lastRequest = Date.now();
  }
  override async buy(...args: Parameters<IntegrationHarness['buy']>) {
    await this.requestBudget();
    return super.buy(...args);
  }
  override async sell(...args: Parameters<IntegrationHarness['sell']>) {
    await this.requestBudget();
    return super.sell(...args);
  }
  override async positions(...args: Parameters<IntegrationHarness['positions']>) {
    await this.requestBudget();
    return super.positions(...args);
  }
  adapter!: AtomicIsolatedAdapter;
  readonly kinds = new Map<string, 'SOL' | 'NON_SOL'>();
  readonly registrationFailures = new Map<string, string>();
  override async start() {
    const { database, directory, token } = await this.owner.start();
    this.database = database;
    this.adapter = new AtomicIsolatedAdapter(
      database,
      token,
      join(directory, 'atomic-provider-authority'),
      (mint) => {
        const kind = this.kinds.get(mint);
        if (!kind) throw new Error('PRIVATE_MARKET_NOT_REGISTERED');
        return kind;
      },
    );
    this.router = new ExecutionRouter([this.adapter]);
    this.router.mintResolver = async (mint) => {
      const i = this.markets.get(mint);
      if (!i) throw new Error('PRIVATE_MARKET_NOT_REGISTERED');
      return {
        protocolId: PROTOCOL,
        marketId: identifier(i.market, 'MarketId'),
        tokenMint: identifier(mint, 'TokenMint'),
      };
    };
    this.competition = new IsolatedCompetitionService(
      database,
      this.router,
      () => new Date(),
      ATOMIC_POLICY,
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
      id = 'private-atomic:' + crypto.randomUUID();
    await ensureDailyCompetition(this.database, starts);
    await createHourlyRound(this.database, {
      id,
      startsAt: starts,
      endsAtExclusive: cutoff,
      rulesVersion: 'UNAPPROVED_ATOMIC_PRIVATE_V2',
      state: 'SCHEDULED',
    });
    await bindPrivateRound(this.database, id, ATOMIC_POLICY, model);
    await this.database.pool.query("update hourly_rounds set state='OPEN' where id=$1", [id]);
    return { id, starts, cutoff };
  }
  async register(mint: string, kind: 'SOL' | 'NON_SOL'): Promise<Identity> {
    this.kinds.set(mint, kind);
    let i: Identity, decimals: number, quoteDecimals: number;
    if (kind === 'SOL') {
      const c = await this.adapter.provider.captureSol(mint);
      i = c.evidence.identity;
      decimals = Number(c.tokenDecimals);
      quoteDecimals = 9;
    } else {
      try {
        const c = await this.adapter.provider.captureNonSol(mint);
        i = c.evidence.identity;
        decimals = c.tokenDecimals;
        quoteDecimals = c.quoteDecimals;
      } catch (error) {
        this.registrationFailures.set(mint, String(error));
        const diagnostic = (
          this.adapter.provider.reviews.get(mint) as
            { diagnostic?: AtomicCapture['normalized'] } | undefined
        )?.diagnostic;
        if (!diagnostic) throw error;
        // Only validated route metadata is registered. Unsupported fees still cannot supply financial fills.
        i = diagnostic.evidence.identity;
        decimals = diagnostic.references[0]!.observation.baseDecimals;
        quoteDecimals = diagnostic.references[0]!.observation.quoteDecimals;
      }
    }
    this.markets.set(mint, i);
    await this.database.pool.query(
      'insert into assets(id,mint_address,decimals) values($1,$1,$2) on conflict do nothing',
      [mint, decimals],
    );
    await this.database.pool.query(
      'insert into assets(id,mint_address,decimals) values($1,$1,$2) on conflict do nothing',
      [i.quote === WRAPPED_SOL_MINT ? WRAPPED_SOL_MINT : i.quote, quoteDecimals],
    );
    await this.database.pool.query(
      'insert into markets(id,base_asset_id,quote_asset_id,venue,provider_market_id) values($1,$2,$3,$4,$1) on conflict do nothing',
      [i.market, mint, i.quote, PROTOCOL],
    );
    return i;
  }
  override async close() {
    if (this.app) await this.app.close();
    await this.redis.close();
    await this.owner.close();
  }
}
