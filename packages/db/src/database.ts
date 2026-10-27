import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import type { MarketIdentity, MarketStateEvidence, SimulatedExecution } from '@paperfund/execution';

import * as schema from './schema.js';

export interface PersistedSettlementRequest {
  accountId: string; roundId: string; positionId: string; identity: MarketIdentity;
  quantity: bigint; basis: bigint;
}
export interface PersistedSettlementPlan {
  quantity: bigint; output: bigint; evidence: MarketStateEvidence; idempotencyKey: string;
  readonly writeoff?: boolean;
}
export interface PaperBuyAdmissionContext {
  readonly userId?: string;
  readonly accountId?: string;
  /** Authorizers using mutable DB state must lock it in this same transaction. */
  readonly client?: PoolClient;
}
export interface DatabaseService {
  /** Global entry ceiling. Only explicit true authorizes BUY; route controls still apply. */
  readonly authorizePaperBuy?: (context: PaperBuyAdmissionContext) => Promise<boolean>;
  /** Optional account dispatch; unrelated accounts keep the ordinary settlement path. */
  readonly persistedSettlementAccount?: (accountId: string, identity: MarketIdentity) => boolean;
  readonly client: NodePgDatabase<typeof schema>;
  readonly pool: Pool;
  /** Optional server-owned market-state participant; any failure rolls back the existing fill transaction. */
  readonly lockMarketExecution?: (client: PoolClient, accountId: string) => Promise<void>;
  readonly commitMarketExecution?: (client: PoolClient, input: { accountId: string; roundId: string; fillId: string; execution: SimulatedExecution; executionContext: 'NORMAL_USER' | 'FORCED_HOURLY_SETTLEMENT' }) => Promise<void>;
  /** Optional historical-bank participant; absent in the deployed runtime. */
  readonly prepareMarketSettlement?: (roundId: string, cutoff: Date) => Promise<void>;
  readonly prepareCurrentQuoteMarketSettlement?: (roundId: string, cutoff: Date) => Promise<void>;
  readonly bindMarketSettlementEvidence?: (accountId: string, evidence: MarketStateEvidence) => Promise<void>;
  /** Candidate continuation requires both a native plan and a same-transaction fill/receipt proof. */
  readonly preparePersistedSettlementStep?: (input: PersistedSettlementRequest) => Promise<PersistedSettlementPlan>;
  readonly commitPersistedSettlementStep?: (client: PoolClient, input: {
    accountId:string;roundId:string;positionId:string;quantityBefore:bigint;basisBefore:bigint;
    fillId:string;idempotencyKey:string;execution:SimulatedExecution;evidence:MarketStateEvidence;
  })=>Promise<void>;
  readonly commitPersistedSettlementWriteoff?: (client: PoolClient, input: PersistedSettlementRequest & {
    idempotencyKey:string;evidence:MarketStateEvidence;journalId:string;
  })=>Promise<void>;
  readonly verifySettlementFill?: (fillId:string)=>Promise<boolean>;
  /** Optional candidate portfolio liquidation; all positions share one ephemeral liquidity revision. */
  readonly valueMarketPortfolio?: (
    positions: readonly { positionId: string; identity: MarketIdentity; quantity: bigint }[],
  ) => Promise<
    readonly { positionId: string; value: bigint; evidence: MarketStateEvidence }[]
  >;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}

export function createDatabase(databaseUrl: string, admission: Pick<DatabaseService, 'authorizePaperBuy'> = {}): DatabaseService {
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on('error', () => {
    // Idle-client failures are surfaced by readiness checks without logging credentials.
  });
  const client = drizzle(pool, { schema });

  return {
    authorizePaperBuy: admission.authorizePaperBuy ?? (async () => false),
    client,
    pool,
    async healthCheck() {
      try {
        await client.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await pool.end();
    },
  };
}
