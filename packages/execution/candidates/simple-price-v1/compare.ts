/** Read-only review runner. No database, configuration, routes, workers or extension writes. */
import { writeFileSync } from 'node:fs';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import { createMarketStateEvidence } from '@paperfund/execution';
import {
  PumpSwapSolanaMarketStateSource,
  PumpSwapProtocolAdapter,
  SolanaRpcClient,
  PUMP_SWAP_PROTOCOL_ID,
  WRAPPED_SOL_MINT,
} from '@paperfund/protocols';
import type { MarketIdentity, MarketState } from '@paperfund/execution';
import { quote, fingerprint } from './model.js';
import type { Evidence, Policy } from './model.js';

interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  swapMode: string;
  contextSlot: number;
  routePlan: { swapInfo: { ammKey: string } }[];
}
const pools = [
  {
    name: 'normal',
    mint: '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump',
    pool: 'GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J',
  },
  {
    name: 'deep',
    mint: '12PUFAUzgLj1onv3wSqX9ZagZBiaxofEjTd24CnQpump',
    pool: 'GQE8drmWfJBQ5djpHy39o4cFZNR1BDwcNb1eobGk531x',
  },
  {
    name: 'shallow',
    mint: '6FDw6jns8g7czuRucp5993RBNRPvqtMfv5Jv3hjnpump',
    pool: 'ATB9NBwxotPJPK43tyRuSecgKQBF5GmYuWohvr6f8tkZ',
  },
] as const;
const reviewPolicy: Policy = {
  version: 'QUOTE_REVIEW_ONLY_UNAPPROVED',
  maxAgeMs: 30_000,
  maxFutureMs: 1000,
  maxSkewMs: 30_000,
  maxDiscrepancyBps: 300n,
  maxMovementBps: 20_000n,
  trustedSources: { chain: 'solana-native-state', external: 'jupiter' },
  solQuote: WRAPPED_SOL_MINT,
};
async function external(
  inputMint: string,
  outputMint: string,
  amount: bigint,
): Promise<{ quote: JupiterQuote; receivedAt: string }> {
  const url = new URL('https://api.jup.ag/swap/v1/quote');
  for (const [k, v] of Object.entries({
    inputMint,
    outputMint,
    amount: amount.toString(),
    swapMode: 'ExactIn',
    onlyDirectRoutes: 'true',
  }))
    url.searchParams.set(k, v);
  // Public service budget: serial acquisition, below one request per second, bounded 429 retries.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  let response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  for (let retry = 0; response.status === 429 && retry < 2; retry++) {
    const requested = Number(response.headers.get('retry-after') ?? '3');
    if (!Number.isFinite(requested) || requested > 10) break;
    await new Promise((resolve) => setTimeout(resolve, Math.max(3, requested) * 1000));
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  }
  if (!response.ok) throw new Error(`EXTERNAL_QUOTE_HTTP_${response.status}`);
  const q = (await response.json()) as JupiterQuote;
  if (
    q.inputMint !== inputMint ||
    q.outputMint !== outputMint ||
    q.inAmount !== amount.toString() ||
    !/^[1-9][0-9]*$/.test(q.outAmount) ||
    !Number.isSafeInteger(q.contextSlot) ||
    q.swapMode !== 'ExactIn' ||
    !q.routePlan?.length
  )
    throw new Error('INVALID_EXTERNAL_QUOTE');
  return { quote: q, receivedAt: new Date().toISOString() };
}
const rpc = new SolanaRpcClient({
  url: 'https://api.mainnet-beta.solana.com',
  timeoutMs: 5000,
  commitment: 'confirmed',
});
const source = new PumpSwapSolanaMarketStateSource(rpc);
const adapter = new PumpSwapProtocolAdapter(source);
const records: unknown[] = [];
if (!process.argv.includes('--live'))
  throw new Error('Explicit --live required for bounded read-only public quote acquisition.');
for (const pool of pools) {
  const native: MarketIdentity = {
    protocolId: PUMP_SWAP_PROTOCOL_ID,
    marketId: identifier(pool.pool, 'MarketId'),
    tokenMint: identifier(pool.mint, 'TokenMint'),
  };
  let state: MarketState | null = null;
  let stateError: string | null = null;
  try {
    state = await source.loadMarketState(native);
  } catch (error) {
    stateError =
      error instanceof Error && 'code' in error ? String(error.code) : 'NATIVE_STATE_UNAVAILABLE';
  }
  // External observations are preserved even when the native capture fails; no fabricated candidate fill.
  const rows: unknown[] = [];
  let calibration: Evidence | null = null;
  for (const input of [10_000_000n, 100_000_000n, 1_000_000_000n, 2_000_000_000n]) {
    try {
      const buyQuote = await external(WRAPPED_SOL_MINT, pool.mint, input);
      const sellQuote = await external(
        pool.mint,
        WRAPPED_SOL_MINT,
        BigInt(buyQuote.quote.outAmount),
      );
      let currentBuy: unknown = null,
        candidateBuy: unknown = null,
        currentSell: unknown = null,
        candidateSell: unknown = null;
      if (state) {
        const s = state.normalizedState;
        const n = BigInt(String(s['effectiveQuoteReserves'])),
          d = BigInt(String(s['baseReserves']));
        const fees = [
          ['LP', 'lpFeeBps'],
          ['PROTOCOL', 'protocolFeeBps'],
          ['CREATOR', 'creatorFeeBps'],
        ].map(([category, field]) => ({ category: category!, bps: BigInt(String(s[field!])) }));
        const sum = fees.reduce((a, f) => a + f.bps, 0n),
          notional = (input * 10_000n) / (10_000n + sum);
        const tokenOutput = BigInt(buyQuote.quote.outAmount),
          equivalent = (tokenOutput * n) / d;
        if (buyQuote.quote.routePlan.some((h) => h.swapInfo.ammKey !== pool.pool))
          throw new Error('EXTERNAL_DIFFERENT_POOL');
        if (!calibration) {
          // One reference sample only: subsequent larger samples are held out for evaluation.
          if (equivalent >= notional || equivalent <= 0n)
            throw new Error('QUALITY_CALIBRATION_UNAVAILABLE');
          const depth = (notional * equivalent) / (notional - equivalent);
          const at = Date.parse(state.observedAt),
            identity = { mint: pool.mint, market: pool.pool, quote: WRAPPED_SOL_MINT };
          calibration = {
            identity,
            observations: [
              {
                source: 'chain',
                upstream: 'solana-native-state',
                reference: createMarketStateEvidence(state).fingerprint,
                price: { n, d },
                identity,
                observedAtMs: at,
                slot: state.chainSlot,
                tradeable: true,
              },
              {
                source: 'external',
                upstream: 'jupiter',
                reference: fingerprint(buyQuote),
                price: { n: notional, d: tokenOutput },
                identity,
                observedAtMs: Date.parse(buyQuote.receivedAt),
                slot: BigInt(buyQuote.quote.contextSlot),
                tradeable: true,
              },
            ],
            conversion: null,
            fees,
            feeReference: createMarketStateEvidence(state).fingerprint,
            feeObservedAtMs: at,
            quality: {
              depthLamports: depth,
              baseSpreadBps: 0n,
              reference: fingerprint(buyQuote),
              observedAtMs: Date.parse(buyQuote.receivedAt),
            },
          };
        }
        const at = utcInstant(state.observedAt);
        const buy = await adapter.simulateBuy(
          {
            identity: native,
            orderId: identifier('review-buy', 'OrderId'),
            executionId: identifier('review-buy-fill', 'ExecutionId'),
            requestedPaperSol: paperSolBaseUnits(input),
            executedAt: at,
          },
          state,
        );
        currentBuy = { input: buy.actualInput.amount, output: buy.actualOutput.amount };
        currentSell = await adapter.simulateSell(
          {
            identity: native,
            orderId: identifier('review-sell', 'OrderId'),
            executionId: identifier('review-sell-fill', 'ExecutionId'),
            requestedTokenQuantity: tokenBaseUnits(tokenOutput),
            executedAt: at,
          },
          state,
        );
        candidateBuy = quote(
          'BUY',
          input,
          calibration,
          calibration.identity,
          Date.parse(buyQuote.receivedAt),
          reviewPolicy,
        );
        candidateSell = quote(
          'SELL',
          tokenOutput,
          calibration,
          calibration.identity,
          Date.parse(buyQuote.receivedAt),
          reviewPolicy,
        );
      }
      rows.push({
        input,
        buyQuote,
        sellQuote,
        currentBuy,
        candidateBuy,
        currentSell,
        candidateSell,
      });
    } catch (error) {
      rows.push({ input, error: error instanceof Error ? error.message : 'UNAVAILABLE' });
    }
  }
  records.push({ pool, state, stateError, calibration, rows });
  console.log(`${pool.name}: native=${state ? 'captured' : stateError}, samples=${rows.length}`);
}
const path = 'artifacts/simple-price-v1-review/live-comparison.json';
writeFileSync(
  path,
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      label: 'READ_ONLY_REVIEW_RECEIPT_TIMES_NOT_EXECUTION_AUTHORITY',
      policy: reviewPolicy,
      records,
    },
    (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  ),
);
console.log(path);
