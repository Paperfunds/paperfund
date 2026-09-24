import { describe, expect, it } from 'vitest';

import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import {
  createMarketStateEvidence,
  ExecutionRouter,
  type MarketState,
  type MarketStateSource,
} from '@paperfund/execution';

import {
  decodePumpBondingCurve,
  decodePumpFeeConfig,
  PUMP_FUN_PROTOCOL_ID,
  PumpFunProtocolAdapter,
  PumpFunSolanaMarketStateSource,
  SolanaRpcClient,
  validatePumpBondingCurve,
} from '../src/pump-fun.js';
import { RECORDED_PUMP_FIXTURES, recordedPumpState } from './fixtures/pump-real-chain.js';

const orderId = identifier('pump-order', 'OrderId');
const executionId = identifier('pump-execution', 'ExecutionId');
const executedAt = utcInstant('2026-09-24T16:02:00.000Z');

class RecordedSource implements MarketStateSource {
  constructor(readonly state: MarketState) {}
  async loadMarketState(): Promise<MarketState> {
    return this.state;
  }
}

function adapter(state = recordedPumpState('developed')): PumpFunProtocolAdapter {
  return new PumpFunProtocolAdapter(new RecordedSource(state));
}

function buyRequest(state: MarketState, amount: bigint) {
  return {
    orderId,
    executionId,
    identity: state.identity,
    requestedPaperSol: paperSolBaseUnits(amount),
    executedAt,
  };
}

function sellRequest(state: MarketState, amount: bigint) {
  return {
    orderId,
    executionId,
    identity: state.identity,
    requestedTokenQuantity: tokenBaseUnits(amount),
    executedAt,
  };
}

describe('Pump.fun recorded mainnet decoding', () => {
  it('decodes active early, normal, and developed curve snapshots', () => {
    for (const name of ['early', 'normal', 'developed'] as const) {
      const fixture = RECORDED_PUMP_FIXTURES[name];
      const decoded = decodePumpBondingCurve(Buffer.from(fixture.curveBase64, 'base64'));
      expect(decoded).toMatchObject({
        virtualTokenReserves: fixture.reserves.virtualToken,
        virtualSolReserves: fixture.reserves.virtualSol,
        realTokenReserves: fixture.reserves.realToken,
        realSolReserves: fixture.reserves.realSol,
        complete: false,
      });
      expect(() => validatePumpBondingCurve(decoded)).not.toThrow();
    }
  });

  it('rejects invalid discriminators and truncated curve data', () => {
    const valid = Buffer.from(RECORDED_PUMP_FIXTURES.early.curveBase64, 'base64');
    valid[0] = valid[0]! ^ 0xff;
    expect(() => decodePumpBondingCurve(valid)).toThrowError(
      expect.objectContaining({ code: 'INVALID_MARKET_STATE' }),
    );
    expect(() => decodePumpBondingCurve(Buffer.alloc(48))).toThrowError(
      expect.objectContaining({ code: 'INVALID_MARKET_STATE' }),
    );
  });

  it('decodes current dynamic fee tiers and validates ordering', () => {
    const bytes = Buffer.alloc(69 + 80);
    Buffer.from([143, 52, 146, 187, 219, 123, 76, 155]).copy(bytes);
    bytes.writeUInt32LE(2, 65);
    bytes.writeBigUInt64LE(95n, 69 + 24);
    bytes.writeBigUInt64LE(30n, 69 + 32);
    bytes.writeBigUInt64LE(1000n, 109);
    bytes.writeBigUInt64LE(80n, 109 + 24);
    bytes.writeBigUInt64LE(20n, 109 + 32);
    expect(decodePumpFeeConfig(bytes).feeTiers).toEqual([
      { marketCapLamportsThreshold: 0n, protocolFeeBps: 95n, creatorFeeBps: 30n },
      { marketCapLamportsThreshold: 1000n, protocolFeeBps: 80n, creatorFeeBps: 20n },
    ]);
  });

  it('classifies a completed real curve as migrated', () => {
    const decoded = decodePumpBondingCurve(
      Buffer.from(RECORDED_PUMP_FIXTURES.completed.curveBase64, 'base64'),
    );
    expect(decoded.complete).toBe(true);
    expect(() => validatePumpBondingCurve(decoded)).toThrowError(
      expect.objectContaining({ code: 'MARKET_MIGRATED' }),
    );
  });
});

describe('Pump.fun deterministic execution math', () => {
  it.each([
    [1_000_000n, 999_999n, 35_318_129_953n, 9_383n, 2_963n],
    [100_000_000n, 100_000_000n, 3_520_345_275_562n, 938_272n, 296_297n],
    [1_000_000_000n, 1_000_000_000n, 34_193_712_693_785n, 9_382_717n, 2_962_963n],
  ])(
    'matches independent SDK-source golden BUY for maximum %s lamports',
    async (requested, actual, output, protocolFee, creatorFee) => {
      const state = recordedPumpState('early');
      const result = await adapter(state).simulateBuy(buyRequest(state, requested), state);
      expect(result.quote.requestedInput.amount).toBe(requested);
      expect(result.actualInput.amount).toBe(actual);
      expect(result.actualOutput.amount).toBe(output);
      expect(result.quote.fees.map(({ amount }) => amount.amount)).toEqual([
        protocolFee,
        creatorFee,
      ]);
    },
  );

  it.each([
    [1_000_000_000n, 98_524n, 97_292n, 936n, 296n],
    [1_000_000_000_000n, 98_352_986n, 97_123_573n, 934_354n, 295_059n],
    [100_000_000_000_000n, 8_385_471_026n, 8_280_652_637n, 79_661_975n, 25_156_414n],
  ])(
    'matches independent SDK-source golden SELL for %s base units',
    async (input, gross, net, protocolFee, creatorFee) => {
      const state = recordedPumpState('developed');
      const result = await adapter(state).simulateSell(sellRequest(state, input), state);
      expect(result.actualInput.amount).toBe(input);
      expect(result.actualOutput.amount).toBe(net);
      expect(result.quote.fees.map(({ amount }) => amount.amount)).toEqual([
        protocolFee,
        creatorFee,
      ]);
      expect(result.executionDetails).toMatchObject({ grossSolOutputLamports: gross.toString() });
    },
  );

  it('applies each fee once with per-fee ceiling and preserves total BUY semantics', async () => {
    const state = recordedPumpState('early');
    const result = await adapter(state).simulateBuy(buyRequest(state, 1_000_000n), state);
    const fees = result.quote.fees.reduce((sum, fee) => sum + fee.amount.amount, 0n);
    expect(fees).toBe(12_346n);
    expect(result.executionDetails).toMatchObject({ curveInputLamports: '987653' });
    expect(result.actualInput.amount).toBe(987_653n + fees);
  });

  it('produces worse average execution for larger buys and larger sells', async () => {
    const state = recordedPumpState('developed');
    const instance = adapter(state);
    const smallBuy = await instance.simulateBuy(buyRequest(state, 100_000_000n), state);
    const largeBuy = await instance.simulateBuy(buyRequest(state, 1_000_000_000n), state);
    expect(largeBuy.actualInput.amount * smallBuy.actualOutput.amount).toBeGreaterThan(
      largeBuy.actualOutput.amount * smallBuy.actualInput.amount,
    );
    const smallSell = await instance.simulateSell(sellRequest(state, 1_000_000_000_000n), state);
    const largeSell = await instance.simulateSell(sellRequest(state, 100_000_000_000_000n), state);
    expect(smallSell.actualOutput.amount * largeSell.actualInput.amount).toBeGreaterThan(
      largeSell.actualOutput.amount * smallSell.actualInput.amount,
    );
  });

  it('values a full exit by executable SELL rather than naive spot mark', async () => {
    const state = recordedPumpState('developed');
    const quantity = tokenBaseUnits(100_000_000_000_000n);
    const value = await adapter(state).valuePositionForExit(
      { identity: state.identity, tokenQuantity: quantity },
      state,
    );
    const normalized = state.normalizedState;
    const naiveSpot =
      (quantity * BigInt(normalized['virtualSolReserves'] as string)) /
      BigInt(normalized['virtualTokenReserves'] as string);
    expect(value.paperSolValue).toBe(8_280_652_637n);
    expect(value.paperSolValue).toBeLessThan(naiveSpot);
  });

  it('is evidence-bound, fingerprint-stable, and registered separately from reference', () => {
    const state = recordedPumpState('normal');
    const clone = { ...state, normalizedState: { ...state.normalizedState } };
    expect(createMarketStateEvidence(clone).fingerprint).toBe(
      createMarketStateEvidence(state).fingerprint,
    );
    const changed = {
      ...state,
      normalizedState: { ...state.normalizedState, virtualSolReserves: '30005896106' },
    };
    expect(createMarketStateEvidence(changed).fingerprint).not.toBe(
      createMarketStateEvidence(state).fingerprint,
    );
    expect(new ExecutionRouter([adapter(state)]).resolve(PUMP_FUN_PROTOCOL_ID)).toBeInstanceOf(
      PumpFunProtocolAdapter,
    );
  });
});

describe('Pump.fun Solana RPC failures', () => {
  it('rejects a wrong program owner before decoding', async () => {
    const fixture = RECORDED_PUMP_FIXTURES.early;
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            context: { slot: Number(fixture.slot) },
            value: Array.from({ length: 4 }, () => ({
              owner: '11111111111111111111111111111111',
              data: ['', 'base64'],
            })),
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const source = new PumpFunSolanaMarketStateSource(
      new SolanaRpcClient({ url: 'https://redacted.invalid', fetchImplementation: fakeFetch }),
    );
    await expect(
      source.loadMarketState({
        protocolId: PUMP_FUN_PROTOCOL_ID,
        marketId: identifier(fixture.market, 'MarketId'),
        tokenMint: identifier(fixture.mint, 'TokenMint'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MARKET_STATE' });
  });

  it('returns typed missing-account and timeout errors', async () => {
    const fixture = RECORDED_PUMP_FIXTURES.early;
    const identity = {
      protocolId: PUMP_FUN_PROTOCOL_ID,
      marketId: identifier(fixture.market, 'MarketId'),
      tokenMint: identifier(fixture.mint, 'TokenMint'),
    };
    const missingFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { context: { slot: Number(fixture.slot) }, value: [null, null, null, null] },
        }),
      );
    await expect(
      new PumpFunSolanaMarketStateSource(
        new SolanaRpcClient({ url: 'https://redacted.invalid', fetchImplementation: missingFetch }),
      ).loadMarketState(identity),
    ).rejects.toMatchObject({ code: 'MARKET_ACCOUNT_NOT_FOUND' });

    const timeoutFetch = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as typeof fetch;
    await expect(
      new PumpFunSolanaMarketStateSource(
        new SolanaRpcClient({
          url: 'https://redacted.invalid',
          timeoutMs: 1,
          fetchImplementation: timeoutFetch,
        }),
      ).loadMarketState(identity),
    ).rejects.toMatchObject({ code: 'RPC_TIMEOUT' });
  });
});

const live = process.env['SOLANA_RPC_URL'] ? it : it.skip;
live('read-only live Pump.fun RPC smoke test', async () => {
  const fixture = RECORDED_PUMP_FIXTURES.early;
  const source = new PumpFunSolanaMarketStateSource(
    new SolanaRpcClient({ url: process.env['SOLANA_RPC_URL']!, timeoutMs: 10_000 }),
  );
  const instance = new PumpFunProtocolAdapter(source);
  const state = await instance.loadMarketState({
    protocolId: PUMP_FUN_PROTOCOL_ID,
    marketId: identifier(fixture.market, 'MarketId'),
    tokenMint: identifier(fixture.mint, 'TokenMint'),
  });
  expect(state.chainSlot).not.toBeNull();
  await expect(instance.simulateBuy(buyRequest(state, 1_000_000n), state)).resolves.toBeDefined();
  await expect(
    instance.valuePositionForExit(
      { identity: state.identity, tokenQuantity: tokenBaseUnits(1_000_000_000n) },
      state,
    ),
  ).resolves.toBeDefined();
});
