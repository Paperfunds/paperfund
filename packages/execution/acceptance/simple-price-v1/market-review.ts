/** Explicitly read-only acceptance evidence acquisition; no model changes and no financial DB access. */
import { readFileSync, writeFileSync } from 'node:fs';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import { createMarketStateEvidence } from '@paperfund/execution';
import type { MarketIdentity, MarketState, ProtocolAdapter } from '@paperfund/execution';
import {
  PumpSwapSolanaMarketStateSource,
  PumpSwapProtocolAdapter,
  PUMP_SWAP_PROTOCOL_ID,
  PumpFunSolanaMarketStateSource,
  PumpFunProtocolAdapter,
  PUMP_FUN_PROTOCOL_ID,
  pumpBondingCurveAddress,
  SolanaRpcClient,
  SolanaRouteSource,
  SolanaRouteAdapter,
  SOLANA_ROUTE_PROTOCOL_ID,
  WRAPPED_SOL_MINT,
} from '@paperfund/protocols';
import { quote, fingerprint } from '../../candidates/simple-price-v1/model.js';
import type { Evidence, Policy } from '../../candidates/simple-price-v1/model.js';
import { SOL } from './fixtures.js';

interface ExternalQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  swapMode: string;
  contextSlot: number;
  routePlan: {
    swapInfo: {
      ammKey: string;
      inputMint: string;
      outputMint: string;
      feeAmount?: string;
      feeMint?: string;
    };
  }[];
}
const rpcUrl = 'https://api.mainnet-beta.solana.com';
const rpc = new SolanaRpcClient({ url: rpcUrl, timeoutMs: 5000, commitment: 'confirmed' });
const swapSource = new PumpSwapSolanaMarketStateSource(rpc),
  swap = new PumpSwapProtocolAdapter(swapSource);
const pumpSource = new PumpFunSolanaMarketStateSource(rpc),
  pump = new PumpFunProtocolAdapter(pumpSource);
const routeSource = new SolanaRouteSource(rpc),
  route = new SolanaRouteAdapter(routeSource);
const policy: Policy = {
  version: 'UNAPPROVED_FIXED_COST_SENSITIVITY_ONLY',
  maxAgeMs: 5000,
  maxFutureMs: 1000,
  maxSkewMs: 2000,
  maxDiscrepancyBps: 300n,
  maxMovementBps: 20_000n,
  trustedSources: { chain: 'native-validated-solana', external: 'jupiter' },
  solQuote: WRAPPED_SOL_MINT,
};
const fixedCosts = { depthLamports: 100n * SOL, baseSpreadBps: 10n };
const errors = (e: unknown) =>
  e instanceof Error ? ('code' in e ? String(e.code) : e.message) : 'UNAVAILABLE';
let lastExternalAt = 0;
async function external(inputMint: string, outputMint: string, amount: bigint) {
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, 1500 - (Date.now() - lastExternalAt))),
  );
  const url = new URL('https://api.jup.ag/swap/v1/quote');
  for (const [k, v] of Object.entries({
    inputMint,
    outputMint,
    amount: amount.toString(),
    swapMode: 'ExactIn',
  }))
    url.searchParams.set(k, v);
  lastExternalAt = Date.now();
  let response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (response.status === 429) {
    const retry = Number(response.headers.get('retry-after') ?? '3');
    if (Number.isFinite(retry) && retry <= 10) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(3, retry) * 1000));
      lastExternalAt = Date.now();
      response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    }
  }
  const body = await response.text();
  if (!response.ok) throw new Error(`JUPITER_HTTP_${response.status}:${body.slice(0, 160)}`);
  const q = JSON.parse(body) as ExternalQuote;
  if (
    q.inputMint !== inputMint ||
    q.outputMint !== outputMint ||
    q.inAmount !== amount.toString() ||
    !/^[1-9][0-9]*$/.test(q.outAmount) ||
    !Number.isSafeInteger(q.contextSlot) ||
    q.swapMode !== 'ExactIn' ||
    !q.routePlan?.length
  )
    throw new Error('UNVERIFIED_EXTERNAL_QUOTE');
  return { quote: q, receivedAtMs: Date.now(), responseHash: fingerprint(q) };
}
async function blockTime(slot: bigint) {
  if (slot > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_SLOT');
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockTime', params: [Number(slot)] }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`BLOCK_TIME_HTTP_${response.status}`);
  const body = (await response.json()) as { result?: number; error?: unknown };
  if (body.error || !Number.isSafeInteger(body.result) || body.result! <= 0)
    throw new Error('BLOCK_TIME_UNAVAILABLE');
  return body.result! * 1000;
}
const samples: { label: string; mint: string; market: string; adapter: ProtocolAdapter }[] = [
  {
    label: 'liquid-pumpswap',
    mint: '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump',
    market: 'GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J',
    adapter: swap,
  },
  {
    label: 'moderate-pumpswap',
    mint: '12PUFAUzgLj1onv3wSqX9ZagZBiaxofEjTd24CnQpump',
    market: 'GQE8drmWfJBQ5djpHy39o4cFZNR1BDwcNb1eobGk531x',
    adapter: swap,
  },
  {
    label: 'recently-profiled-pump-curve-age-is-discovery-only',
    mint: 'CZQ7p7UzZoRiQ5LZRNHHTzcX2MybqPU4t9EbNWzMpump',
    market: await pumpBondingCurveAddress('CZQ7p7UzZoRiQ5LZRNHHTzcX2MybqPU4t9EbNWzMpump'),
    adapter: pump,
  },
  {
    label: 'non-sol-pinky-djt-composed',
    mint: '36sagUqFTtRexLToDforaTaWve4HdCuzH3EXNAtLwfUQ',
    market: 'solana-route:36sagUqFTtRexLToDforaTaWve4HdCuzH3EXNAtLwfUQ',
    adapter: route,
  },
];
if (!process.argv.includes('--read-only-live'))
  throw new Error('Explicit --read-only-live required.');
const records: unknown[] = [];
for (const sample of samples) {
  const native: MarketIdentity = {
    protocolId: sample.adapter.protocolId,
    marketId: identifier(sample.market, 'MarketId'),
    tokenMint: identifier(sample.mint, 'TokenMint'),
  };
  const row: { label: string; identity: MarketIdentity; samples: unknown[]; error?: string } = {
    label: sample.label,
    identity: native,
    samples: [],
  };
  for (const amount of [SOL / 10n, SOL]) {
    let state: MarketState | null = null;
    let nativeError: string | null = null;
    try {
      const [nativeCapture, buyQuote] = await Promise.all([
        sample.adapter
          .loadMarketState(native)
          .then((s) => {
            state = s;
            return s;
          })
          .catch((e) => {
            nativeError = errors(e);
            return null;
          }),
        external(WRAPPED_SOL_MINT, sample.mint, amount),
      ]);
      state = nativeCapture;
      const tokenQuantity = BigInt(buyQuote.quote.outAmount);
      const sellQuote = await external(sample.mint, WRAPPED_SOL_MINT, tokenQuantity);
      let currentBuy: unknown = null,
        currentSell: unknown = null,
        nativeMathError: string | null = null;
      if (state) {
        try {
          currentBuy = await sample.adapter.simulateBuy(
            {
              identity: native,
              orderId: identifier('acceptance-buy', 'OrderId'),
              executionId: identifier('acceptance-buy-fill', 'ExecutionId'),
              requestedPaperSol: paperSolBaseUnits(amount),
              executedAt: utcInstant(state.observedAt),
            },
            state,
          );
          currentSell = await sample.adapter.simulateSell(
            {
              identity: native,
              orderId: identifier('acceptance-sell', 'OrderId'),
              executionId: identifier('acceptance-sell-fill', 'ExecutionId'),
              requestedTokenQuantity: tokenBaseUnits(tokenQuantity),
              executedAt: utcInstant(state.observedAt),
            },
            state,
          );
        } catch (error) {
          nativeMathError = errors(error);
        }
      }
      let candidateBuy: unknown = null,
        candidateSell: unknown = null,
        candidateStatus = 'UNSUPPORTED_NATIVE_PRICE_EVIDENCE';
      let reviewEvidence: Evidence | null = null,
        receiptProjectionBuy: unknown = null,
        receiptProjectionSell: unknown = null;
      if (state && [PUMP_SWAP_PROTOCOL_ID, PUMP_FUN_PROTOCOL_ID].includes(native.protocolId)) {
        const s = state.normalizedState,
          isSwap = native.protocolId === PUMP_SWAP_PROTOCOL_ID;
        const n = BigInt(String(s[isSwap ? 'effectiveQuoteReserves' : 'virtualSolReserves']));
        const d = BigInt(String(s[isSwap ? 'baseReserves' : 'virtualTokenReserves']));
        const fees = [
          ...(isSwap ? [{ category: 'LP', bps: BigInt(String(s['lpFeeBps'])) }] : []),
          { category: 'PROTOCOL', bps: BigInt(String(s['protocolFeeBps'])) },
          {
            category: 'CREATOR',
            bps: (
              isSwap
                ? s['creatorFeeApplies'] === true
                : s['creator'] !== '11111111111111111111111111111111'
            )
              ? BigInt(String(s['creatorFeeBps']))
              : 0n,
          },
        ];
        const now = sellQuote.receivedAtMs,
          feeBps = fees.reduce((sum, f) => sum + f.bps, 0n);
        const reference = await external(WRAPPED_SOL_MINT, sample.mint, SOL / 100n);
        if (
          [buyQuote, sellQuote, reference].some(
            (record) =>
              record.quote.routePlan.length !== 1 ||
              record.quote.routePlan[0]!.swapInfo.ammKey !== sample.market,
          )
        )
          throw new Error('UNSUPPORTED_COMPARISON_DIFFERENT_NATIVE_ROUTE');
        const internalReference = ((SOL / 100n) * 10_000n) / (10_000n + feeBps);
        const identity = { mint: sample.mint, market: sample.market, quote: WRAPPED_SOL_MINT };
        reviewEvidence = {
          identity,
          observations: [
            {
              source: 'chain',
              upstream: 'native-validated-solana',
              reference: createMarketStateEvidence(state).fingerprint,
              identity,
              price: { n, d },
              observedAtMs: now,
              slot: state.chainSlot,
              tradeable: true,
            },
            {
              source: 'external',
              upstream: 'jupiter',
              reference: reference.responseHash,
              identity,
              price: { n: internalReference, d: BigInt(reference.quote.outAmount) },
              observedAtMs: now,
              slot: BigInt(reference.quote.contextSlot),
              tradeable: true,
            },
          ],
          conversion: null,
          fees,
          feeReference: createMarketStateEvidence(state).fingerprint,
          feeObservedAtMs: now,
          quality: {
            ...fixedCosts,
            reference: 'UNAPPROVED_FIXED_TEST_POLICY_NOT_A_LIQUIDITY_OBSERVATION',
            observedAtMs: now,
          },
        };
        // Always labelled sensitivity projection; these receipt timestamps never become authoritative evidence.
        try {
          receiptProjectionBuy = quote('BUY', amount, reviewEvidence, identity, now, policy);
          receiptProjectionSell = quote(
            'SELL',
            tokenQuantity,
            reviewEvidence,
            identity,
            now,
            policy,
          );
          candidateStatus = 'CONDITIONAL_FIXED_POLICY_PROJECTION_ONLY';
          const slots = [
            state.chainSlot!,
            BigInt(buyQuote.quote.contextSlot),
            BigInt(sellQuote.quote.contextSlot),
          ];
          if (
            slots.some((slot) => slot < 0n) ||
            slots.reduce((a, b) => (a > b ? a : b)) - slots.reduce((a, b) => (a < b ? a : b)) > 24n
          )
            throw new Error('QUOTE_STATE_SLOT_SKEW');
          const [nativeTime, referenceTime] = await Promise.all([
            blockTime(state.chainSlot!),
            blockTime(BigInt(reference.quote.contextSlot)),
          ]);
          const timed = structuredClone(reviewEvidence);
          Object.assign(timed.observations[0]!, { observedAtMs: nativeTime });
          Object.assign(timed.observations[1]!, { observedAtMs: referenceTime });
          Object.assign(timed, { feeObservedAtMs: nativeTime });
          // Fixed quality is a policy parameter, not verified market quality: never approve this for actual execution.
          candidateBuy = quote('BUY', amount, timed, identity, Date.now(), policy);
          candidateSell = quote('SELL', tokenQuantity, timed, identity, Date.now(), policy);
        } catch (error) {
          candidateStatus += `:${errors(error)}`;
        }
        row.samples.push({
          amount,
          state,
          nativeError,
          nativeMathError,
          buyQuote,
          sellQuote,
          referenceQuote: reference,
          currentBuy,
          currentSell,
          reviewEvidence,
          candidateBuy,
          candidateSell,
          receiptProjectionBuy,
          receiptProjectionSell,
          candidateStatus,
        });
      } else {
        if (native.protocolId === SOLANA_ROUTE_PROTOCOL_ID)
          candidateStatus = 'UNSUPPORTED_CANDIDATE_NON_SOL_PROVIDER_AND_FEE_NORMALIZATION';
        row.samples.push({
          amount,
          state,
          nativeError,
          nativeMathError,
          buyQuote,
          sellQuote,
          currentBuy,
          currentSell,
          candidateStatus,
        });
      }
    } catch (error) {
      row.samples.push({
        amount,
        state,
        nativeError,
        error: errors(error),
        candidateStatus: 'UNSUPPORTED_COMPARABLE_EVIDENCE_UNAVAILABLE',
      });
    }
  }
  records.push(row);
  console.log(`${sample.label}: captured ${row.samples.length} bounded sample outcomes`);
}
const historical = JSON.parse(
  readFileSync('packages/protocols/test/fixtures/operator-extreme-route.json', 'utf8'),
) as {
  side: string;
  base_quantity: string;
  actual_input_lamports: string | null;
  actual_output_lamports: string | null;
  executed_at: string;
  fee_breakdown: unknown;
}[];
records.push({
  label: 'historical-BabyBaton',
  status: 'UNSUPPORTED_INDEPENDENT_EXECUTION_TIME_PRICE_AND_COST_EVIDENCE',
  reason:
    'Historical multi-hop token-transfer fees cannot be replaced by todays prices or normalized into the current candidate without a verified provider.',
  recorded: historical.map((r) => ({
    side: r.side,
    quantity: r.base_quantity,
    input: r.actual_input_lamports,
    output: r.actual_output_lamports,
    executedAt: r.executed_at,
    fees: r.fee_breakdown,
  })),
});
writeFileSync(
  'artifacts/simple-price-v1-acceptance/market-results.json',
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      label: 'READ_ONLY_REVIEW_NO_PRODUCTION_EXECUTION_AUTHORITY',
      policy,
      fixedCosts,
      records,
    },
    (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  ),
);
