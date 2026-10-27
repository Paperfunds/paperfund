import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import type * as PumpSdk from '@pump-fun/pump-sdk';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import {
  canonicalExitPreflight,
  ExecutionRouter,
  type JsonObject,
  type MarketState,
} from '@paperfund/execution';
import {
  decodePumpBondingCurve,
  PumpFunProtocolAdapter,
  PUMP_FUN_ADAPTER_VERSION,
  PUMP_FUN_NORMALIZATION_VERSION,
  PUMP_FUN_PROTOCOL_ID,
} from '../src/pump-fun.js';
const { getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount } = createRequire(
  import.meta.url,
)('@pump-fun/pump-sdk') as typeof PumpSdk;

interface RecordedBuy {
  quantity: string;
  inputLamports: string;
  observedAt: string;
  slot: string;
  normalizedState: JsonObject;
  curveBase64: string;
}
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/pump-early-testeeee.json', import.meta.url), 'utf8'),
) as {
  market: string;
  mint: string;
  buys: RecordedBuy[];
};
function recorded(): MarketState {
  const row = fixture.buys[0]!;
  return {
    identity: {
      protocolId: PUMP_FUN_PROTOCOL_ID,
      marketId: identifier(fixture.market, 'MarketId'),
      tokenMint: identifier(fixture.mint, 'TokenMint'),
    },
    observedAt: utcInstant(row.observedAt),
    chainSlot: BigInt(row.slot),
    chainBlockId: null,
    adapterVersion: PUMP_FUN_ADAPTER_VERSION,
    normalizationVersion: PUMP_FUN_NORMALIZATION_VERSION,
    normalizedState: structuredClone(row.normalizedState),
    rawSource: { source: 'immutable-recorded-buy' },
  };
}
const request = (s: MarketState) => ({
  identity: s.identity,
  orderId: identifier('state-reproduction', 'OrderId'),
  executionId: identifier('state-reproduction', 'ExecutionId'),
  executedAt: utcInstant(s.observedAt),
});
const adapter = (s: MarketState) => new PumpFunProtocolAdapter({ loadMarketState: async () => s });
/** Explicit hypothetical instruction transition for SDK comparison; never a live observation. */
function transitioned(s: MarketState, postTrade: JsonObject): MarketState {
  return {
    ...s,
    normalizedState: { ...s.normalizedState, ...postTrade },
    rawSource: { source: 'hypothetical-sequential-instruction-state' },
  };
}
function sdkArguments(s: MarketState) {
  const n = s.normalizedState;
  // The recorded effective tier is used directly; this comparison tests instruction math,
  // not dynamic tier selection against a fabricated Global account.
  const global = {
    feeBasisPoints: new BN(String(n['protocolFeeBps'])),
    creatorFeeBasisPoints: new BN(String(n['creatorFeeBps'])),
    creatorFeeConfigurable: true,
  } as Parameters<typeof getBuyTokenAmountFromSolAmount>[0]['global'];
  const bondingCurve = {
    virtualTokenReserves: new BN(String(n['virtualTokenReserves'])),
    virtualQuoteReserves: new BN(String(n['virtualSolReserves'])),
    realTokenReserves: new BN(String(n['realTokenReserves'])),
    realQuoteReserves: new BN(String(n['realSolReserves'])),
    tokenTotalSupply: new BN(String(n['tokenTotalSupply'])),
    complete: false,
    creator: new PublicKey(String(n['creator'])),
    isMayhemMode: false,
    isCashbackCoin: false,
    quoteMint: PublicKey.default,
    creatorFeeBps: new BN(0),
    canEditCreatorFee: false,
    isHolderReward: false,
  } as NonNullable<Parameters<typeof getBuyTokenAmountFromSolAmount>[0]['bondingCurve']>;
  return {
    global,
    bondingCurve,
    mintSupply: new BN(String(n['mintSupply'])),
    feeConfig: null,
    quoteMint: PublicKey.default,
  };
}

// Explicitly unresolved pipeline requirement. The current source reloads the real pre-BUY
// curve. This must become a normal passing regression only after an approved durable
// counterfactual model exists; SDK mathematical output alone cannot fund the old state.
it.fails(
  'retains a paper BUY transition for the next independently loaded exit state',
  async () => {
    const pre = recorded();
    const a = adapter(pre);
    const buy = await a.simulateBuy(
      { ...request(pre), requestedPaperSol: paperSolBaseUnits(1_700_000_000n) },
      pre,
    );
    const next = await a.loadMarketState(pre.identity);
    const sell = await a.simulateSell(
      { ...request(next), requestedTokenQuantity: tokenBaseUnits(buy.actualOutput.amount) },
      next,
    );
    expect(sell.actualOutput.amount).toBeGreaterThan(1_600_000_000n);
  },
);

it('decodes the historical curve and reproduces both immutable BUY quantities against the independent SDK', async () => {
  for (const row of fixture.buys) {
    expect(decodePumpBondingCurve(Buffer.from(row.curveBase64, 'base64')).realSolReserves).toBe(5n);
    const s = { ...recorded(), normalizedState: row.normalizedState };
    const buy = await adapter(s).simulateBuy(
      { ...request(s), requestedPaperSol: paperSolBaseUnits(BigInt(row.inputLamports)) },
      s,
    );
    expect(buy.actualOutput.amount).toBe(BigInt(row.quantity));
    expect(buy.actualOutput.amount.toString()).toBe(
      getBuyTokenAmountFromSolAmount({
        ...sdkArguments(s),
        amount: new BN(row.inputLamports),
      }).toString(),
    );
  }
});

it('proves unchanged on-chain liquidity cannot fund the recorded aggregate position despite a positive SDK mathematical quote', async () => {
  const s = recorded(),
    a = adapter(s),
    quantity = fixture.buys.reduce((q, b) => q + BigInt(b.quantity), 0n);
  expect(
    BigInt(
      getSellSolAmountFromTokenAmount({
        ...sdkArguments(s),
        amount: new BN(quantity.toString()),
      }).toString(),
    ),
  ).toBeGreaterThan(5n);
  await expect(
    a.simulateSell({ ...request(s), requestedTokenQuantity: tokenBaseUnits(quantity) }, s),
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_EXECUTABLE_LIQUIDITY' });
  const max = await a.maxExecutableSellQuantity(
    { identity: s.identity, tokenQuantity: tokenBaseUnits(quantity) },
    s,
  );
  expect(max).toBeLessThan(quantity / 1_000_000n);
  const feasible = await a.simulateSell({ ...request(s), requestedTokenQuantity: max }, s);
  expect(BigInt(String(feasible.executionDetails?.['grossSolOutputLamports']))).toBeLessThanOrEqual(
    5n,
  );
});

it.each([1_700_000_000n, 1_797_964_910n])(
  'correctly funds and fully exits a hypothetical sequential BUY of %s without inventing initial liquidity',
  async (amount) => {
    const pre = recorded(),
      a = adapter(pre);
    const buy = await a.simulateBuy(
      { ...request(pre), requestedPaperSol: paperSolBaseUnits(amount) },
      pre,
    );
    const post = transitioned(pre, buy.executionDetails!['postTrade'] as JsonObject);
    const sell = await a.simulateSell(
      { ...request(post), requestedTokenQuantity: tokenBaseUnits(buy.actualOutput.amount) },
      post,
    );
    const sdk = getSellSolAmountFromTokenAmount({
      ...sdkArguments(post),
      amount: new BN(buy.actualOutput.amount.toString()),
    });
    expect(sell.actualOutput.amount.toString()).toBe(sdk.toString());
    expect(sell.actualOutput.amount).toBeGreaterThan((amount * 95n) / 100n);
    expect(sell.actualOutput.amount).toBeLessThan(amount);
    const value = await a.valuePositionForExit(
      { identity: post.identity, tokenQuantity: tokenBaseUnits(buy.actualOutput.amount) },
      post,
    );
    expect(value.paperSolValue).toBe(sell.actualOutput.amount);
    expect(
      await a.maxExecutableSellQuantity(
        { identity: post.identity, tokenQuantity: tokenBaseUnits(buy.actualOutput.amount) },
        post,
      ),
    ).toBe(buy.actualOutput.amount);
    const exit = await canonicalExitPreflight(
      new ExecutionRouter([adapter(post)]),
      post.identity,
      buy.actualOutput.amount,
      buy.actualInput.amount,
    );
    expect(exit.full.executable).toBe(true);
    expect(exit.full.outputLamports).toBe(sell.actualOutput.amount);
    expect(exit.executablePortionPnlLamports).toBe(
      sell.actualOutput.amount - buy.actualInput.amount,
    );
  },
);

it('supports a sequential partial exit followed by ALL with reserve and integer-fee conservation', async () => {
  const pre = recorded(),
    a = adapter(pre);
  const buy = await a.simulateBuy(
    { ...request(pre), requestedPaperSol: paperSolBaseUnits(1_700_000_000n) },
    pre,
  );
  const postBuy = transitioned(pre, buy.executionDetails!['postTrade'] as JsonObject);
  const partial = buy.actualOutput.amount / 4n;
  const sold = await a.simulateSell(
    { ...request(postBuy), requestedTokenQuantity: tokenBaseUnits(partial) },
    postBuy,
  );
  const postPartial = transitioned(postBuy, sold.executionDetails!['postTrade'] as JsonObject);
  const remaining = buy.actualOutput.amount - partial;
  expect(
    await a.maxExecutableSellQuantity(
      { identity: pre.identity, tokenQuantity: tokenBaseUnits(remaining) },
      postPartial,
    ),
  ).toBe(remaining);
  const all = await a.simulateSell(
    { ...request(postPartial), requestedTokenQuantity: tokenBaseUnits(remaining) },
    postPartial,
  );
  expect(all.actualOutput.amount).toBeGreaterThan(0n);
  for (const execution of [sold, all]) {
    const gross = BigInt(String(execution.executionDetails?.['grossSolOutputLamports']));
    expect(gross - execution.quote.fees.reduce((v, f) => v + f.amount.amount, 0n)).toBe(
      execution.actualOutput.amount,
    );
  }
});

it('does not treat virtual SOL as funding when real reserves are zero', async () => {
  const pre = recorded();
  const s = { ...pre, normalizedState: { ...pre.normalizedState, realSolReserves: '0' } };
  expect(
    await adapter(s).maxExecutableSellQuantity(
      { identity: s.identity, tokenQuantity: tokenBaseUnits(1_000_000_000n) },
      s,
    ),
  ).toBe(0n);
  await expect(
    adapter(s).valuePositionForExit(
      { identity: s.identity, tokenQuantity: tokenBaseUnits(1_000_000_000n) },
      s,
    ),
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_EXECUTABLE_LIQUIDITY' });
});
