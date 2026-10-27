import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fixture } from './legacy-beta-fixture.js';
import { executePaperSell } from '../src/financial-service.js';
it('performs current-engine forced liquidation at a real canonical host-labelled UTC boundary', async () => {
  const started = new Date(),
    start = new Date(started);
  start.setUTCMinutes(0, 0, 0);
  const f = await fixture(start, true);
  try {
    const before = await f.db.pool.query('select clock_timestamp() db_time');
    console.log(
      'Boundary rehearsal waiting for ' +
        f.end.toISOString() +
        '; test market bytes are fixtures and host UTC is unqualified.',
    );
    await new Promise((done) => setTimeout(done, Math.max(0, +f.end - Date.now() + 150)));
    const receipt = new Date();
    expect(+receipt).toBeGreaterThanOrEqual(+f.end);
    const outcome = await f.close();
    expect(outcome.state).toBe('FINALIZED');
    expect(outcome.forcedSells).toHaveLength(2);
    await expect(
      executePaperSell(f.db, f.router, {
        competitionAccountId: 'alice',
        marketId: f.state.identity.marketId,
        requestedTokenQuantity: f.buys[0]!.actualTokenOutputBaseUnits,
        idempotencyKey: 'late',
        authoritativeTimestamp: receipt,
      }),
    ).rejects.toMatchObject({ code: 'ROUND_NOT_OPEN' });
    const rows = (
      await f.db.pool.query('select * from legacy_settlement_liquidations order by position_id')
    ).rows;
    const results = (await f.db.pool.query('select * from hourly_results order by user_id')).rows;
    const ending = (await f.db.pool.query('select clock_timestamp() db_time')).rows[0];
    writeFileSync(
      new URL('../../../../evidence/actual-utc-boundary.json', import.meta.url),
      JSON.stringify(
        {
          started: started.toISOString(),
          canonicalStart: start.toISOString(),
          canonicalCutoff: f.end.toISOString(),
          hostReceipt: receipt.toISOString(),
          dbBefore: before.rows[0],
          dbAfter: ending,
          scope: 'ACTUAL_HOST_UTC_BOUNDARY_WITH_RECORDED_ECONOMIC_FIXTURES',
          absoluteUtcQualified: false,
          realMarketCutoffQualified: false,
          forcedFills: rows,
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    await f.cleanup();
  }
}, 3900000);
