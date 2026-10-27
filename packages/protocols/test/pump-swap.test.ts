import { describe, expect, it } from 'vitest';

import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import {
  ExecutionRouter,
  createMarketStateEvidence,
  type MarketIdentity,
  type MarketState,
  type MarketStateSource,
} from '@paperfund/execution';

import {
  PUMP_AMM_PROGRAM_ID,
  PUMP_SWAP_ADAPTER_VERSION,
  PUMP_SWAP_NORMALIZATION_VERSION,
  PUMP_SWAP_PROTOCOL_ID,
  PumpMigrationResolver,
  PumpSwapProtocolAdapter,
  canonicalPumpSwapPoolAddress,
  decodePumpSwapFeeConfig,
  decodePumpSwapPool,
  pumpPoolAuthorityAddress,
  simulatePumpSwapBuyAmount,
  simulatePumpSwapSellAmount,
} from '../src/pump-swap.js';
import {
  PUMP_FUN_PROTOCOL_ID,
  PUMP_PROGRAM_ID,
  WRAPPED_SOL_MINT,
  SolanaRpcClient,
} from '../src/pump-fun.js';
import { RECORDED_PUMP_SWAP_FIXTURES } from './fixtures/pump-swap-real-chain.js';

const mint = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
const pool = 'GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J';
const identity: MarketIdentity = {
  protocolId: PUMP_SWAP_PROTOCOL_ID,
  marketId: identifier(pool, 'MarketId'),
  tokenMint: identifier(mint, 'TokenMint'),
};

function state(overrides: Record<string, unknown> = {}): MarketState {
  return {
    identity,
    observedAt: utcInstant('2026-09-24T12:00:00.000Z'),
    chainSlot: 370_000_000n,
    chainBlockId: null,
    adapterVersion: PUMP_SWAP_ADAPTER_VERSION,
    normalizationVersion: PUMP_SWAP_NORMALIZATION_VERSION,
    normalizedState: {
      model: 'PUMP_SWAP_CANONICAL_POOL',
      programId: PUMP_AMM_PROGRAM_ID,
      feeProgramId: 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ',
      poolAddress: pool,
      canonicalCreator: '9XDYTfQKwW8sHPqnFdUreMmtmffmkHVPGTNV2e3LKxNW',
      baseMint: mint,
      quoteMint: WRAPPED_SOL_MINT,
      baseVault: '5jMpkf4JF4noHftLgNKyPNh6roVfPSGSjuEk3U4eLKRa',
      quoteVault: '43DVcZR4kQFjh4Xm2i3DcneRxNjZp7HMud8yDrJWrDr8',
      baseTokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      quoteTokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      tokenDecimals: '6',
      mintSupply: '1000000000000000',
      baseReserves: '300000000000000',
      rawQuoteReserves: '90000000000',
      virtualQuoteReserves: '0',
      effectiveQuoteReserves: '90000000000',
      coinCreator: '5L5k7gtNLbeXdzpvNrFshg1E1id1ceUDfc6vPUTxp98q',
      isMayhemMode: false,
      isCashbackCoin: false,
      disableFlags: '0',
      lpFeeBps: '2',
      protocolFeeBps: '93',
      creatorFeeBps: '30',
      creatorFeeApplies: true,
      feeTierMarketCapLamportsThreshold: '0',
      feeConfigAccountLength: '1024',
      poolAccountLength: '300',
      stateSlots: { configuration: '369999999', reserves: '370000000' },
      ...overrides,
    },
  };
}

class RecordedSource implements MarketStateSource {
  constructor(readonly value: MarketState) {}
  async loadMarketState(): Promise<MarketState> {
    return this.value;
  }
}

function writeKey(buffer: Buffer, offset: number, value: string) {
  // Known official fixture keys are inserted through @solana/addresses in production; decoder
  // discriminator/offset coverage below only needs deterministic 32-byte fields.
  buffer.fill(value.charCodeAt(0), offset, offset + 32);
}

describe('PumpSwap canonical adapter', () => {
  it('accepts signed negative virtual quote reserves but rejects inconsistent effective reserves', async () => {
    const adapter = new PumpSwapProtocolAdapter(new RecordedSource(state()));
    const signed = state({ virtualQuoteReserves: '-10000000000', effectiveQuoteReserves: '80000000000' });
    await expect(adapter.valuePositionForExit({ identity, tokenQuantity: tokenBaseUnits(1_000_000n) }, signed))
      .resolves.toMatchObject({ paperSolValue: expect.any(BigInt) });
    await expect(adapter.valuePositionForExit({ identity, tokenQuantity: tokenBaseUnits(1_000_000n) },
      state({ effectiveQuoteReserves: '80000000000' })))
      .rejects.toMatchObject({ code: 'INVALID_MARKET_STATE' });
  });
  it('finds exact capacity from raw reserves when virtual quote liquidity exceeds actual funding', async () => {
    const snapshot = state({ rawQuoteReserves: '1000000', virtualQuoteReserves: '89999000000' });
    const adapter = new PumpSwapProtocolAdapter(new RecordedSource(snapshot));
    const request = { identity, tokenQuantity: tokenBaseUnits(1_000_000_000_000n) };
    await expect(adapter.valuePositionForExit(request, snapshot)).rejects.toMatchObject({
      code: 'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
    });
    const max = await adapter.maxExecutableSellQuantity(request, snapshot);
    expect(max).toBeGreaterThan(0n);
    expect(max).toBeLessThan(request.tokenQuantity);
    await expect(
      adapter.valuePositionForExit({ ...request, tokenQuantity: max }, snapshot),
    ).resolves.toMatchObject({ tokenQuantity: max });
    await expect(
      adapter.valuePositionForExit(
        { ...request, tokenQuantity: tokenBaseUnits(max + 1n) },
        snapshot,
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_EXECUTABLE_LIQUIDITY' });
  });
  it('derives the official canonical pool and creator linkage', async () => {
    expect(await canonicalPumpSwapPoolAddress(mint)).toBe(pool);
    expect(await pumpPoolAuthorityAddress(mint)).toBe(
      '9XDYTfQKwW8sHPqnFdUreMmtmffmkHVPGTNV2e3LKxNW',
    );
  });

  it('decodes current and legacy-length pool fields with exact offsets', () => {
    const bytes = Buffer.alloc(270);
    Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]).copy(bytes);
    bytes[8] = 254;
    bytes.writeUInt16LE(0, 9);
    for (const offset of [11, 43, 75, 107, 139, 171, 211]) writeKey(bytes, offset, 'A');
    bytes.writeBigUInt64LE(4_194_352_106_721n, 203);
    bytes[243] = 1;
    bytes.writeBigUInt64LE(42n, 245);
    bytes.writeBigUInt64LE(7n, 261);
    bytes[269] = 1;
    const decoded = decodePumpSwapPool(bytes);
    expect(decoded).toMatchObject({
      index: 0,
      lpSupply: 4_194_352_106_721n,
      isMayhemMode: true,
      virtualQuoteReserves: 42n,
      creatorFeeBps: 7n,
      canEditCreatorFee: true,
    });
    const legacy = decodePumpSwapPool(bytes.subarray(0, 211));
    expect(legacy).toMatchObject({
      coinCreator: '11111111111111111111111111111111',
      virtualQuoteReserves: 0n,
      creatorFeeBps: 0n,
    });
  });

  it('decodes LP, protocol, and creator fee tiers independently', () => {
    const bytes = Buffer.alloc(109);
    Buffer.from([143, 52, 146, 187, 219, 123, 76, 155]).copy(bytes);
    bytes.writeBigUInt64LE(25n, 41);
    bytes.writeBigUInt64LE(5n, 49);
    bytes.writeBigUInt64LE(0n, 57);
    bytes.writeUInt32LE(1, 65);
    bytes.writeBigUInt64LE(420_000_000_000n, 69);
    bytes.writeBigUInt64LE(2n, 85);
    bytes.writeBigUInt64LE(93n, 93);
    bytes.writeBigUInt64LE(30n, 101);
    expect(decodePumpSwapFeeConfig(bytes)).toMatchObject({
      flatFees: { lpFeeBps: 25n, protocolFeeBps: 5n, creatorFeeBps: 0n },
      feeTiers: [
        {
          marketCapLamportsThreshold: 420_000_000_000n,
          fees: { lpFeeBps: 2n, protocolFeeBps: 93n, creatorFeeBps: 30n },
        },
      ],
    });
  });

  it('matches official SDK integer semantics for exact-budget BUY and exact-base SELL', () => {
    const math = {
      base: 300_000_000_000_000n,
      rawQuote: 90_000_000_000n,
      effectiveQuote: 90_000_000_000n,
      virtualQuote: 0n,
      lpFeeBps: 2n,
      protocolFeeBps: 93n,
      creatorFeeBps: 30n,
      creatorFeeApplies: true,
      disableFlags: 0,
    };
    const buy = simulatePumpSwapBuyAmount(1_000_000_000n, math);
    expect(buy).toMatchObject({
      totalInput: 999_999_999n,
      internalQuote: 987_654_319n,
      tokenOutput: 3_256_445_041_007n,
    });
    expect(buy.fees).toEqual({
      lp: 197_531n,
      protocol: 9_185_186n,
      creator: 2_962_963n,
      total: 12_345_680n,
    });
    const sell = simulatePumpSwapSellAmount(3_256_445_041_007n, math);
    expect(sell).toMatchObject({ grossQuoteOutput: 966_442_951n, netQuoteOutput: 954_362_413n });
    expect(sell.fees).toEqual({
      lp: 193_289n,
      protocol: 8_987_920n,
      creator: 2_899_329n,
      total: 12_080_538n,
    });
  });

  it('worsens average execution with size and full exit differs from spot', () => {
    const math = {
      base: 300_000_000_000_000n,
      rawQuote: 90_000_000_000n,
      effectiveQuote: 90_000_000_000n,
      virtualQuote: 0n,
      lpFeeBps: 2n,
      protocolFeeBps: 93n,
      creatorFeeBps: 30n,
      creatorFeeApplies: true,
      disableFlags: 0,
    };
    const smallBuy = simulatePumpSwapBuyAmount(100_000_000n, math);
    const largeBuy = simulatePumpSwapBuyAmount(10_000_000_000n, math);
    expect(largeBuy.totalInput * smallBuy.tokenOutput).toBeGreaterThan(
      smallBuy.totalInput * largeBuy.tokenOutput,
    );
    const smallSell = simulatePumpSwapSellAmount(1_000_000_000n, math);
    const largeSell = simulatePumpSwapSellAmount(100_000_000_000_000n, math);
    expect(smallSell.netQuoteOutput * largeSell.tokenInput).toBeGreaterThan(
      largeSell.netQuoteOutput * smallSell.tokenInput,
    );
    expect(largeSell.netQuoteOutput).not.toBe(
      (largeSell.tokenInput * math.effectiveQuote) / math.base,
    );
  });

  it('binds BUY, SELL, and full-exit values to migrated-pool evidence', async () => {
    const adapter = new PumpSwapProtocolAdapter(new RecordedSource(state()));
    const buy = await adapter.simulateBuy(
      {
        orderId: identifier('buy', 'OrderId'),
        executionId: identifier('buy-exec', 'ExecutionId'),
        identity,
        requestedPaperSol: paperSolBaseUnits(1_000_000_000n),
        executedAt: utcInstant('2026-09-24T12:00:01.000Z'),
      },
      state(),
    );
    const sell = await adapter.simulateSell(
      {
        orderId: identifier('sell', 'OrderId'),
        executionId: identifier('sell-exec', 'ExecutionId'),
        identity,
        requestedTokenQuantity: tokenBaseUnits(1_000_000_000n),
        executedAt: utcInstant('2026-09-24T12:00:02.000Z'),
      },
      state(),
    );
    const value = await adapter.valuePositionForExit(
      { identity, tokenQuantity: tokenBaseUnits(1_000_000_000n) },
      state(),
    );
    expect(buy.quote.marketStateFingerprint).toBe(createMarketStateEvidence(state()).fingerprint);
    expect(sell.actualOutput).toEqual({ asset: 'PAPER_SOL', amount: value.paperSolValue });
    expect(sell.quote.fees.map((fee) => fee.category)).toEqual([
      'PUMP_SWAP_LP_FEE',
      'PUMP_SWAP_PROTOCOL_FEE',
      'PUMP_SWAP_CREATOR_FEE',
    ]);
  });

  it('rejects disabled directions and mismatched pool identities', async () => {
    const adapter = new PumpSwapProtocolAdapter(new RecordedSource(state({ disableFlags: '16' })));
    await expect(
      adapter.simulateSell(
        {
          orderId: identifier('sell', 'OrderId'),
          executionId: identifier('exec', 'ExecutionId'),
          identity,
          requestedTokenQuantity: tokenBaseUnits(1n),
          executedAt: utcInstant('2026-09-24T12:00:00.000Z'),
        },
        state({ disableFlags: '16' }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_EXECUTION_RESULT' });
    await expect(
      adapter.loadMarketState({ ...identity, marketId: identifier('wrong', 'MarketId') }),
    ).rejects.toMatchObject({ code: 'INVALID_MARKET_STATE' });
  });
});

describe('Pump migration routing', () => {
  function curve(complete: boolean) {
    const bytes = Buffer.alloc(125);
    Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]).copy(bytes);
    bytes.writeBigUInt64LE(1_000n, 8);
    bytes.writeBigUInt64LE(1_000n, 16);
    bytes.writeBigUInt64LE(complete ? 0n : 500n, 24);
    bytes.writeBigUInt64LE(500n, 32);
    bytes.writeBigUInt64LE(1_000n, 40);
    bytes[48] = complete ? 1 : 0;
    return bytes;
  }
  function rpc(complete: boolean) {
    return {
      getMultipleAccounts: async () => ({
        context: { slot: 1 },
        value: [
          { owner: PUMP_PROGRAM_ID, data: [curve(complete).toString('base64'), 'base64'] as const },
        ],
      }),
    } as never;
  }
  it('keeps active curves on Pump and sends completed curves to canonical PumpSwap', async () => {
    const curveId = identifier(
      await (await import('../src/pump-fun.js')).pumpBondingCurveAddress(mint),
      'MarketId',
    );
    const origin = {
      protocolId: PUMP_FUN_PROTOCOL_ID,
      marketId: curveId,
      tokenMint: identifier(mint, 'TokenMint'),
    };
    await expect(
      new PumpMigrationResolver(rpc(false)).resolveExecutionRoute(origin),
    ).resolves.toMatchObject({ migrated: false, executionIdentity: origin });
    await expect(
      new PumpMigrationResolver(rpc(true)).resolveExecutionRoute(origin),
    ).resolves.toMatchObject({ migrated: true, executionIdentity: identity });
  });

  it('routes through the destination adapter without rewriting origin identity', async () => {
    const curveId = identifier(
      await (await import('../src/pump-fun.js')).pumpBondingCurveAddress(mint),
      'MarketId',
    );
    const origin = {
      protocolId: PUMP_FUN_PROTOCOL_ID,
      marketId: curveId,
      tokenMint: identifier(mint, 'TokenMint'),
    };
    const router = new ExecutionRouter([new PumpSwapProtocolAdapter(new RecordedSource(state()))]);
    router.registerRouteResolver(new PumpMigrationResolver(rpc(true)));
    const resolved = await router.resolvePositionRoute(origin, true);
    expect(resolved.route).toEqual({
      originIdentity: origin,
      executionIdentity: identity,
      migrated: true,
    });
    expect(resolved.adapter.protocolId).toBe(PUMP_SWAP_PROTOCOL_ID);
  });
});
const live = process.env['SOLANA_RPC_URL'] ? it : it.skip;
live('read-only live canonical PumpSwap RPC smoke test', async () => {
  const fixture = RECORDED_PUMP_SWAP_FIXTURES.normal;
  const { PumpSwapSolanaMarketStateSource } = await import('../src/pump-swap.js');
  const source = new PumpSwapSolanaMarketStateSource(
    new SolanaRpcClient({ url: process.env['SOLANA_RPC_URL']!, timeoutMs: 10_000 }),
  );
  const marketState = await source.loadMarketState({
    protocolId: PUMP_SWAP_PROTOCOL_ID,
    marketId: identifier(fixture.pool, 'MarketId'),
    tokenMint: identifier(fixture.mint, 'TokenMint'),
  });
  expect(marketState.chainSlot).not.toBeNull();
  expect(marketState.normalizedState['model']).toBe('PUMP_SWAP_CANONICAL_POOL');
  await expect(
    new PumpSwapProtocolAdapter(source).valuePositionForExit(
      { identity: marketState.identity, tokenQuantity: tokenBaseUnits(1_000_000_000n) },
      marketState,
    ),
  ).resolves.toBeDefined();
});
