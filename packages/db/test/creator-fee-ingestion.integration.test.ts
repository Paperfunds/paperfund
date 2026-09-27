import { resolve } from 'node:path';

import { config as loadDotEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

import { PUMP_PROGRAM_ID, WRAPPED_SOL_MINT } from '@paperfund/protocols';

import {
  createDatabase,
  runCreatorFeeBackfill,
  runCreatorFeeIngestionTick,
  SolanaPumpCreatorFeeSource,
  type CreatorFeeTransaction,
  type DatabaseService,
  type ReadOnlySolanaRpc,
  type SignatureRecord,
  type SignatureStatusRecord,
} from '../src/index.js';

loadDotEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
const sourceDatabaseUrl = process.env.DATABASE_URL;
const databaseName = `paperfund_p5e_${process.pid.toString()}_${Date.now().toString()}`;
const signature =
  '3q1qyZGDbsaJPdswkoKWsWC38M8Qgk3gq1KYHmumwaQh1vtTkEHjuHJWH3AG4da9nFcXPTsi13ppjA52M7wJbC4f';
const mint = '5f3hEQy4H9UzhnzAhQfmfxnLEBHNnT4HrDP9ipPDpump';
const creator = 'ReM7jT2ofZPfvAwC6K5Hru9k64VJ5qsoEfzD8XhbUNP';
const event =
  'vdt/007mYe5FLd05sAoCohW3IzGlJypNY5TzKopwvcMl49szNtVrj9u2yBcAAAAAhfAfSLoMAAAANdjFdlRpksXfTXengQUtHORt/YuW52pjUoBSs3qO9Rk0dblqAAAAAEfk8QEHAAAAazsAy7rMAwBHOM4FAAAAAGuj7X4pzgIA4ATIfOuY+lzkf4A4Bv0seUXSlSSVmuwA3tl4FPOPeEZfAAAAAAAAAMHXOQAAAAAABlAq6JlhOTosYSC2nXldAIcTksSv5LHQftYlb3E+FvQeAAAAAAAAACJEEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAHNlbGwAAAAAAAAAAAAAAAAAAAAAAIgTAAAAAAAA4OscAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADbtsgXAAAAAEfk8QEHAAAARzjOBQAAAAAAAAAAAAAAAAAAAAAAAAAA';
const creatorVault = PublicKey.findProgramAddressSync(
  [Buffer.from('creator-vault'), new PublicKey(creator).toBuffer()],
  new PublicKey(PUMP_PROGRAM_ID),
)[0].toBase58();
const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const associatedTokenProgram = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const creatorVaultAta = PublicKey.findProgramAddressSync(
  [
    new PublicKey(creatorVault).toBuffer(),
    new PublicKey(tokenProgram).toBuffer(),
    new PublicKey(WRAPPED_SOL_MINT).toBuffer(),
  ],
  new PublicKey(associatedTokenProgram),
)[0].toBase58();

function fixtureTransaction(): CreatorFeeTransaction {
  return {
    slot: 451_097_471,
    blockTime: 1_790_539_060,
    meta: {
      err: null,
      logMessages: [
        `Program ${PUMP_PROGRAM_ID} invoke [1]`,
        `Program data: ${event}`,
        `Program ${PUMP_PROGRAM_ID} success`,
      ],
      loadedAddresses: { writable: [], readonly: [] },
      innerInstructions: [],
    },
    transaction: {
      message: {
        accountKeys: [
          PUMP_PROGRAM_ID,
          mint,
          WRAPPED_SOL_MINT,
          tokenProgram,
          creatorVault,
          creatorVaultAta,
        ],
        instructions: [
          {
            programIdIndex: 0,
            accounts: [0, 1, 2, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 5],
            data: bs58.encode(Uint8Array.from([93, 246, 130, 60, 231, 233, 64, 178])),
          },
        ],
      },
    },
  };
}

class DeterministicRpc implements ReadOnlySolanaRpc {
  signatures: SignatureRecord[] = [
    {
      signature,
      slot: 451_097_471,
      err: null,
      blockTime: 1_790_539_060,
      confirmationStatus: 'confirmed',
    },
  ];
  status: SignatureStatusRecord | null = {
    slot: 451_097_471,
    err: null,
    confirmationStatus: 'confirmed',
  };
  async getSignaturesForAddress(
    _address: string,
    options: { before?: string; until?: string; limit: number },
  ) {
    if (options.before === signature) return [];
    const values = options.until
      ? this.signatures.filter((item) => item.signature !== options.until)
      : this.signatures;
    return values.slice(0, options.limit);
  }
  async getTransaction(requestedSignature: string) {
    return this.signatures.some((item) => item.signature === requestedSignature)
      ? fixtureTransaction()
      : null;
  }
  async getSignatureStatuses(requestedSignatures: readonly string[]) {
    return requestedSignatures.map(() => this.status);
  }
  async getSlot() {
    return 451_097_500;
  }
}

let database: DatabaseService;
let adminPool: Pool;

describe('Phase 5E ingestion lifecycle', () => {
  beforeAll(async () => {
    if (!sourceDatabaseUrl) throw new Error('DATABASE_URL is required for integration tests.');
    const admin = new URL(sourceDatabaseUrl);
    admin.pathname = '/postgres';
    const test = new URL(sourceDatabaseUrl);
    test.pathname = `/${databaseName}`;
    adminPool = new Pool({ connectionString: admin.toString() });
    await adminPool.query(`create database "${databaseName}"`);
    database = createDatabase(test.toString());
    await migrate(database.client, {
      migrationsFolder: resolve(process.cwd(), 'packages/db/migrations'),
    });
    await database.pool.query(
      `insert into daily_competitions (id,utc_date,starts_at,ends_at_exclusive,state)
       values ('daily:2026-09-27','2026-09-27','2026-09-27T00:00:00Z','2026-09-28T00:00:00Z','OPEN')`,
    );
    await database.pool.query(
      `insert into hourly_rounds
        (id,starts_at,ends_at_exclusive,state,starting_paper_sol_lamports,max_unique_tokens,
         max_buy_ratio_bps,reward_finalization_grace_period_seconds,rules_version)
       values ('hour:19','2026-09-27T19:00:00Z','2026-09-27T20:00:00Z','FINALIZED',
               10000000000,5,2000,60,'test')`,
    );
  }, 30_000);

  afterAll(async () => {
    if (database) await database.close();
    if (adminPool) {
      await adminPool.query(`drop database if exists "${databaseName}" with (force)`);
      await adminPool.end();
    }
  });

  it('persists confirmed evidence, promotes only at finality, survives restart, and flags rollback', async () => {
    const rpc = new DeterministicRpc();
    const source = new SolanaPumpCreatorFeeSource(
      rpc,
      { tokenMint: mint, creatorWallet: creator },
      'mainnet-beta',
      25,
    );
    const first = await runCreatorFeeIngestionTick(
      database,
      source,
      new Date('2026-09-27T20:00:00Z'),
    );
    expect(first).toMatchObject({ discovered: 1, finalized: 0, rolledBack: 0 });
    expect(
      await database.pool.query(
        'select id from creator_fee_events where transaction_signature=$1',
        [signature],
      ),
    ).toHaveProperty('rowCount', 0);

    rpc.status = { slot: 451_097_471, err: null, confirmationStatus: 'finalized' };
    const second = await runCreatorFeeIngestionTick(
      database,
      source,
      new Date('2026-09-27T20:00:05Z'),
    );
    expect(second.finalized).toBe(1);
    const canonical = await database.pool.query<{
      creator_fee_lamports: string;
      hourly_round_id: string;
      accounting_status: string;
    }>(
      `select creator_fee_lamports,hourly_round_id,accounting_status
       from creator_fee_events where transaction_signature=$1`,
      [signature],
    );
    expect(canonical.rows[0]).toEqual({
      creator_fee_lamports: '1197090',
      hourly_round_id: 'hour:19',
      accounting_status: 'ATTRIBUTED',
    });

    const restart = await runCreatorFeeIngestionTick(
      database,
      source,
      new Date('2026-09-27T20:00:10Z'),
    );
    expect(restart).toMatchObject({ finalized: 0, reconciliationRequired: 0 });
    expect(
      await database.pool.query('select count(*)::int count from creator_fee_events'),
    ).toHaveProperty('rows.0.count', 1);

    rpc.status = null;
    await runCreatorFeeIngestionTick(database, source, new Date('2026-09-27T20:00:15Z'));
    await runCreatorFeeIngestionTick(database, source, new Date('2026-09-27T20:00:20Z'));
    const rollback = await runCreatorFeeIngestionTick(
      database,
      source,
      new Date('2026-09-27T20:00:25Z'),
    );
    expect(rollback.reconciliationRequired).toBe(1);
    expect(
      await database.pool.query(
        `select category from creator_fee_reconciliation_findings where status='OPEN'`,
      ),
    ).toHaveProperty('rows.0.category', 'FINALIZED_TRANSACTION_MISSING');
  });

  it('enforces bounded [start,end) backfills and is idempotent', async () => {
    await database.pool.query(
      `update creator_fee_observations
       set confirmation_status='FINALIZED',missing_status_checks=0
       where transaction_signature=$1`,
      [signature],
    );
    const rpc = new DeterministicRpc();
    rpc.status = { slot: 451_097_471, err: null, confirmationStatus: 'finalized' };
    const source = new SolanaPumpCreatorFeeSource(
      rpc,
      { tokenMint: mint, creatorWallet: creator },
      'mainnet-beta',
      25,
    );
    const input = { fromSlot: 451_097_471n, toSlotExclusive: 451_097_472n };
    const first = await runCreatorFeeBackfill(database, source, input);
    const second = await runCreatorFeeBackfill(database, source, input);
    expect(first).toMatchObject({ discoveredEvents: 1, inserted: 0, duplicates: 1 });
    expect(second).toMatchObject({ discoveredEvents: 1, inserted: 0, duplicates: 1 });
    const endBoundary = await runCreatorFeeBackfill(database, source, {
      fromSlot: 451_097_470n,
      toSlotExclusive: 451_097_471n,
    });
    expect(endBoundary.discoveredEvents).toBe(0);
    await expect(
      runCreatorFeeBackfill(database, source, {
        fromSlot: 0n,
        toSlotExclusive: 500_001n,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKFILL_RANGE' });
  });
});
