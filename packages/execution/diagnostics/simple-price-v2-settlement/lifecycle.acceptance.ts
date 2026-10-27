import { it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runHourlyLifecycleTick, reconcileAccountLedger } from '@paperfund/db';
import { ExecutionEngineError } from '@paperfund/execution';
import { withGenericActor } from '@paperfund/protocols';
import { ReplayHarness } from './harness.js';
import { recoveryTick } from './worker.js';
import { encode } from './fixtures.js';
it('existing unmodified lifecycle tick recovers safe archived replay, and exposes the private REVIEW integration gap', async () => {
  const h = new ReplayHarness(),
    cutoff = Date.parse('2030-01-01T13:00:00Z'),
    notes: Record<string, unknown> = {
      financialInput:
        'Unchanged archived economic data; controlled fixture chronology. Existing lifecycle function is called directly.',
    };
  const tick = () =>
    withGenericActor({ intent: 'READ', systemRead: true, isolateCaptures: true }, () =>
      runHourlyLifecycleTick(h.database, h.router, h.now),
    );
  try {
    h.now = new Date(cutoff - 500);
    await h.start();
    await recoveryTick(
      h.database,
      h.router,
      h.now,
      h.policy,
      'CONTROLLED_ARCHIVED_REPLAY',
      h.token,
    );
    const u = await h.user();
    expect((await h.buy(u, h.original.identity, '0.1')).statusCode).toBe(200);
    notes['beforeCutoff'] = await tick();
    expect(
      (await h.database.pool.query('select count(*)::int n from hourly_results')).rows[0].n,
    ).toBe(0);
    h.now = new Date(cutoff + 100);
    notes['restartAfterCutoff'] = await tick();
    expect(
      (await h.database.pool.query('select count(*)::int n from hourly_results')).rows[0].n,
    ).toBe(1);
    const fills = (await h.database.pool.query('select count(*)::int n from fills')).rows[0].n;
    expect(fills).toBe(2);
    await tick();
    expect((await h.database.pool.query('select count(*)::int n from fills')).rows[0].n).toBe(
      fills,
    );
    expect(
      (await h.database.pool.query('select count(*)::int n from daily_result_hourly_results'))
        .rows[0].n,
    ).toBe(1);
    expect((await reconcileAccountLedger(h.database, u.accountId)).reconciled).toBe(true);
    const next = await h.competition.enterRound(u.id);
    expect(next.paperSolBalanceLamports).toBe(10000000000n);
    h.now = new Date(cutoff + 3599500);
    await recoveryTick(
      h.database,
      h.router,
      h.now,
      h.policy,
      'CONTROLLED_ARCHIVED_REPLAY',
      h.token,
    );
    expect((await h.buy({ ...u, accountId: next.id }, h.original.identity, '0.1')).statusCode).toBe(
      200,
    );
    h.now = new Date(cutoff + 3600100);
    const missing = vi
      .spyOn(h.router, 'loadPositionRoute')
      .mockRejectedValue(
        new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'CONTROLLED_MISSING_EXIT'),
      );
    try {
      notes['existingMissingEvidence'] = await tick();
      expect(
        (await h.database.pool.query('select count(*)::int n from hourly_results')).rows[0].n,
      ).toBe(1);
      for (let n = 0; n < 3; n++)
        await recoveryTick(
          h.database,
          h.router,
          h.now,
          h.policy,
          'CONTROLLED_ARCHIVED_REPLAY',
          h.token,
        );
      const calls = missing.mock.calls.length;
      await recoveryTick(
        h.database,
        h.router,
        h.now,
        h.policy,
        'CONTROLLED_ARCHIVED_REPLAY',
        h.token,
      );
      expect(missing.mock.calls).toHaveLength(calls);
      notes['existingLifecycleAfterPrivateHold'] = await tick();
      expect(missing.mock.calls.length).toBeGreaterThan(calls);
      notes['integrationGap'] =
        'Unmodified lifecycle tick retries SETTLING and does not read private_v2 REVIEW controls. Only the isolated wrapper honors them. Production integration remains blocked.';
      notes['holds'] = (
        await h.database.pool.query('select * from private_v2.settlement_control')
      ).rows;
      expect(notes['integrationGap']).toContain('does not read');
    } finally {
      missing.mockRestore();
    }
  } finally {
    writeFileSync(
      'artifacts/simple-price-v2-blocker-review/existing-lifecycle-' + Date.now() + '.json',
      encode(notes),
    );
    await h.close();
  }
});
