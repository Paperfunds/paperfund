import { identifier, paperSolBaseUnits, utcInstant } from '@paperfund/core';
import {
  ExecutionEngineError,
  ExecutionRouter,
  marketStateFingerprint,
  type MarketIdentity,
  type ProtocolAdapter,
} from '@paperfund/execution';
import { describe, expect, it } from 'vitest';

import { CompetitionService } from '../src/competition.js';

const now = new Date('2026-09-25T12:30:00.000Z');
const originProtocol = identifier('PUMP_FUN', 'ProtocolId');
const migratedProtocol = identifier('PUMP_SWAP', 'ProtocolId');

type PositionFixture = {
  id: string;
  market_id: string;
  mint_address: string;
  decimals: number;
  venue: string;
  remaining_base_units: string;
  cost_basis_lamports: string;
  realized_pnl_lamports: string;
};

function adapter(protocolId: typeof originProtocol, multiplier: bigint): ProtocolAdapter {
  return {
    protocolId,
    adapterVersion: 'preflight-fixture-v1',
    async loadMarketState(identity) {
      return {
        identity,
        observedAt: utcInstant(now.toISOString()),
        chainSlot: 123n,
        chainBlockId: 'fixture-block',
        adapterVersion: 'preflight-fixture-v1',
        normalizationVersion: 'fixture-v1',
        normalizedState: { multiplier: multiplier.toString() },
      };
    },
    async simulateBuy() {
      throw new Error('not used');
    },
    async simulateSell() {
      throw new Error('not used');
    },
    async valuePositionForExit(request, state) {
      return {
        identity: request.identity,
        tokenQuantity: request.tokenQuantity,
        paperSolValue: paperSolBaseUnits(request.tokenQuantity * multiplier),
        feeBreakdown: { fees: [], totalPaperSolFees: paperSolBaseUnits(0n) },
        marketStateFingerprint: marketStateFingerprint(state),
        adapterVersion: 'preflight-fixture-v1',
      };
    },
  };
}

function position(id: string, valueLamports: bigint): PositionFixture {
  return {
    id,
    market_id: `market:${id}`,
    mint_address: `mint:${id}`,
    decimals: 0,
    venue: originProtocol,
    remaining_base_units: valueLamports.toString(),
    cost_basis_lamports: valueLamports.toString(),
    realized_pnl_lamports: '0',
  };
}

class TestCompetitionService extends CompetitionService {
  override async marketSupport(mint: string) {
    return {
      mint,
      supported: true as const,
      executionProtocol: originProtocol,
      status: 'ACTIVE_BONDING_CURVE',
      marketId: 'market:target',
      originMarketId: 'market:target',
      tokenDecimals: 6,
    };
  }
}

function service(options: {
  cash: bigint;
  positions?: PositionFixture[];
  slotsUsed?: number;
  targetExisting?: boolean;
  unavailable?: boolean;
  migrated?: boolean;
}) {
  const positions = options.positions ?? [];
  const query = async (sql: string) => {
    if (sql.includes('from competition_accounts ca join hourly_rounds')) {
      return {
        rows: [
          {
            id: 'account:one',
            hourly_round_id: 'round:one',
            starting_paper_sol_lamports: '10000000000',
            paper_sol_balance_lamports: options.cash.toString(),
            realized_pnl_lamports: '0',
            state: 'OPEN',
            max_unique_tokens: 5,
            max_buy_ratio_bps: 2000,
            slots_used: options.slotsUsed ?? positions.length,
          },
        ],
      };
    }
    if (sql.includes('from positions p join assets')) return { rows: positions };
    if (sql.includes('from competition_token_slots')) {
      return { rows: [{ existing: options.targetExisting ? 1 : 0 }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const origin = adapter(originProtocol, 1n);
  if (options.unavailable) {
    origin.loadMarketState = async () => {
      throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'fixture unavailable');
    };
  }
  const router = new ExecutionRouter([origin, adapter(migratedProtocol, 2n)]);
  if (options.migrated) {
    router.registerRouteResolver({
      originProtocolId: originProtocol,
      async resolveExecutionRoute(identity: MarketIdentity) {
        return {
          originIdentity: identity,
          executionIdentity: { ...identity, protocolId: migratedProtocol },
          migrated: true,
        };
      },
    });
  }
  return new TestCompetitionService({ pool: { query } } as never, router, () => now);
}

describe('authoritative BUY preflight', () => {
  it('uses exact cash as equity when no positions are open', async () => {
    const result = await service({ cash: 10_000_000_000n }).buyPreflight('user:one', 'mint:target');
    expect(result).toMatchObject({
      executablePositionsLamports: 0n,
      portfolioEquityLamports: 10_000_000_000n,
      maxBuyByRatioLamports: 2_000_000_000n,
      maxBuyLamports: 2_000_000_000n,
      valuationStatus: 'AVAILABLE',
    });
  });

  it.each([
    ['one position', 7_000_000_000n, [position('one', 3_000_000_000n)]],
    [
      'multiple and partial positions',
      5_000_000_000n,
      [position('one', 2_000_000_000n), position('partial', 3_000_000_000n)],
    ],
  ])('values %s into the exact equity cap', async (_label, cash, positions) => {
    const result = await service({ cash, positions }).buyPreflight('user:one', 'mint:target');
    expect(result.portfolioEquityLamports).toBe(10_000_000_000n);
    expect(result.maxBuyLamports).toBe(2_000_000_000n);
  });

  it('caps the ratio limit at available cash', async () => {
    const result = await service({
      cash: 1_000_000_000n,
      positions: [position('one', 9_000_000_000n)],
    }).buyPreflight('user:one', 'mint:target');
    expect(result.maxBuyByRatioLamports).toBe(2_000_000_000n);
    expect(result.maxBuyLamports).toBe(1_000_000_000n);
  });

  it('allows an existing token but rejects a new token when all slots are consumed', async () => {
    const existing = await service({
      cash: 10_000_000_000n,
      slotsUsed: 5,
      targetExisting: true,
    }).buyPreflight('user:one', 'mint:target');
    const newToken = await service({
      cash: 10_000_000_000n,
      slotsUsed: 5,
      targetExisting: false,
    }).buyPreflight('user:one', 'mint:target');
    expect(existing).toMatchObject({ requiresNewSlot: false, slotAvailable: true });
    expect(newToken).toMatchObject({ requiresNewSlot: true, slotAvailable: false });
  });

  it('fails closed when any position cannot be valued', async () => {
    const result = await service({
      cash: 7_000_000_000n,
      positions: [position('one', 3_000_000_000n)],
      unavailable: true,
    }).buyPreflight('user:one', 'mint:target');
    expect(result).toMatchObject({
      valuationStatus: 'UNAVAILABLE',
      portfolioEquityLamports: null,
      maxBuyLamports: null,
      unavailablePositionIds: ['one'],
    });
  });

  it('values a migrated position through its current execution protocol', async () => {
    const result = await service({
      cash: 4_000_000_000n,
      positions: [position('one', 3_000_000_000n)],
      migrated: true,
    }).getPositions('user:one');
    expect(result?.positions[0]?.valuation).toMatchObject({
      status: 'AVAILABLE',
      currentProtocol: migratedProtocol,
      executablePaperSolLamports: 6_000_000_000n,
    });
    expect(result?.portfolioEquityLamports).toBe(10_000_000_000n);
  });
});
