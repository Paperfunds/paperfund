import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthService } from '../../../../apps/api/src/auth.js';
import { buildApp } from '../../../../apps/api/src/app.js';
import { ExecutionRouter } from '@paperfund/execution';
import { identifier } from '@paperfund/core';
import { reconcileAccountLedger } from '@paperfund/db';
import { WRAPPED_SOL_MINT } from '@paperfund/protocols';
import { LiveHarness } from './live-harness.js';
import { REAL_POLICY } from './provider.js';
import { NonSolProvider, NON_SOL_SAMPLES } from './non-sol.js';
import { withNonSolEvidence } from './non-sol-adapter.js';
import { IsolatedCompetitionService } from '../../integration/simple-price-v2/service.js';
import { PROTOCOL } from '../../integration/simple-price-v2/adapter.js';
const h = new LiveHarness(),
  provider = new NonSolProvider(),
  notes: unknown[] = [];
describe.skipIf(process.env['PAPERFUND_V2_NON_SOL_LIVE'] !== '1')(
  'new non-SOL evidence gate through unchanged disposable API/accounting',
  () => {
    beforeAll(async () => {
      await h.start();
      await h.app.close();
      h.router = new ExecutionRouter([withNonSolEvidence(h.adapter, provider)]);
      h.router.mintResolver = async (mint) => ({
        protocolId: PROTOCOL,
        marketId: identifier('solana-route:' + mint, 'MarketId'),
        tokenMint: identifier(mint, 'TokenMint'),
      });
      h.competition = new IsolatedCompetitionService(
        h.database,
        h.router,
        () => new Date(),
        REAL_POLICY,
      );
      h.app = buildApp({
        config: { LOG_LEVEL: 'silent' },
        database: h.database,
        redis: h.redis,
        auth: new AuthService(h.database, h.redis, 300, 3600000, () => new Date()),
        competition: h.competition,
        logger: false,
      });
      await h.round();
      // Disposable metadata fixtures only: no price is assigned, and no such observation becomes real evidence.
      await h.database.pool.query('insert into assets(id,mint_address,decimals) values($1,$1,9)', [
        WRAPPED_SOL_MINT,
      ]);
      for (const s of NON_SOL_SAMPLES) {
        await h.database.pool.query(
          'insert into assets(id,mint_address,decimals) values($1,$1,6)',
          [s.mint],
        );
        await h.database.pool.query(
          'insert into markets(id,base_asset_id,quote_asset_id,venue,provider_market_id) values($1,$2,$3,$4,$1)',
          ['solana-route:' + s.mint, s.mint, WRAPPED_SOL_MINT, PROTOCOL],
        );
      }
    }, 60000);
    afterAll(async () => {
      writeFileSync(
        join('artifacts/simple-price-v2-non-sol-review', 'api-rejections.json'),
        JSON.stringify(notes, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2),
      );
      await h.close();
    }, 30000);
    for (const s of NON_SOL_SAMPLES)
      it(s.label + ' cannot debit on unverified mixed-cost evidence', async () => {
        const user = await h.user(),
          i = { mint: s.mint, market: 'solana-route:' + s.mint, quote: WRAPPED_SOL_MINT };
        const before = await reconcileAccountLedger(h.database, user.accountId);
        const result = await h.buy(user, i, '0.1');
        expect(result.statusCode, result.body).toBe(503);
        expect(result.json().error.code).toBe('MARKET_STATE_UNAVAILABLE');
        const after = await reconcileAccountLedger(h.database, user.accountId);
        expect(after.reconciled).toBe(true);
        expect(after.materializedCashLamports).toBe(before.materializedCashLamports);
        expect(after.materializedQuantity).toBe(0n);
        expect(after.journalCount).toBe(1);
        const counts = (
          await h.database.pool.query(
            'select (select count(*) from competition_token_slots where competition_account_id=$1)::int slots,(select count(*) from orders where competition_account_id=$1)::int orders',
            [user.accountId],
          )
        ).rows[0];
        expect(counts).toEqual({ slots: 0, orders: 0 });
        notes.push({
          sample: s,
          user: user.accountId,
          response: result.json(),
          reconciliation: after,
          counts,
          review: provider.reviews.get(s.mint),
        });
      });
  },
);
