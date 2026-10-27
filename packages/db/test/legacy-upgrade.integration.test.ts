import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fixture } from './legacy-beta-fixture.js';
import { executePaperSellAll, replayPersistedFill } from '../src/financial-service.js';
import { legacyHourlyProof } from '../src/legacy-proof.js';
it('upgrades original-schema versioned BUY/SELL/results byte-for-byte and retains history without financially relabelling it', async () => {
  const f = await fixture(new Date('2043-01-01T00:00:00Z'), false, true);
  let retained = false;
  try {
    for (const user of f.users)
      await executePaperSellAll(f.db, f.router, {
        competitionAccountId: user,
        marketId: f.state.identity.marketId,
        idempotencyKey: 'legacy-full-' + user,
        authoritativeTimestamp: new Date(+f.start + 120000),
      });
    expect((await f.close()).state).toBe('FINALIZED');
    const tables = [
      'competition_accounts',
      'positions',
      'fills',
      'orders',
      'market_state_evidence',
      'journal_transactions',
      'ledger_entries',
      'hourly_results',
      'daily_results',
      'daily_result_hourly_results',
    ];
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          tables.map(async (table) => [
            table,
            (
              await f.db.pool.query(
                "select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text data from " +
                  table +
                  ' t',
              )
            ).rows[0].data,
          ]),
        ),
      );
    const before = await snapshot();
    await migrate(f.db.client, { migrationsFolder: resolve('packages/db/migrations') });
    const after = await snapshot();
    expect(after).toEqual(before);
    const fills = (await f.db.pool.query('select id,adapter_version from fills order by id')).rows;
    for (const fill of fills)
      expect((await replayPersistedFill(f.db, f.router, fill.id)).matched).toBe(true);
    const proof = await legacyHourlyProof(f.db, f.router, f.round);
    expect(proof.structural).toBe(true);
    expect(proof.realFinancialAccepted).toBe(false);
    expect(proof.localnetTestAccepted).toBe(false);
    const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
    const name = await f.releaseWithoutDrop();
    retained = true;
    writeFileSync(
      new URL('../../../../evidence/upgrade-history.json', import.meta.url),
      JSON.stringify(
        {
          sourceDatabase: name,
          beforeHash: digest(before),
          afterHash: digest(after),
          tables: tables.length,
          originalFills: fills,
          qualification: proof,
          restoreSourceRetained: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (!retained) await f.cleanup();
  }
}, 30000);
