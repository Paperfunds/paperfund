import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import type * as PumpSdk from '@pump-fun/pump-sdk';
import { identifier, utcInstant } from '@paperfund/core';
import { type MarketState } from '@paperfund/execution';
import {
  PUMP_FUN_PROTOCOL_ID,
  PUMP_FUN_ADAPTER_VERSION,
  PUMP_FUN_NORMALIZATION_VERSION,
} from '../src/pump-fun.js';
import {
  createStage1Model,
  prepareStage1Transition,
  stage1Exit,
  replayStage1,
  stage1Continuity,
  classifyStage1Legacy,
  stage1Hash,
  type Stage1Scope,
  type Stage1Model,
  type Stage1Request,
} from '../src/experimental/pump-reserve-stage1.js';
const sdk = createRequire(import.meta.url)('@pump-fun/pump-sdk') as typeof PumpSdk;
const data = JSON.parse(
  readFileSync(new URL('./fixtures/pump-stage1-anchor.json', import.meta.url), 'utf8'),
);
const legacy = JSON.parse(
  readFileSync(new URL('./fixtures/pump-early-testeeee.json', import.meta.url), 'utf8'),
);
export const stage1Snapshot = (): MarketState => ({
  identity: {
    protocolId: PUMP_FUN_PROTOCOL_ID,
    marketId: identifier(data.normalizedState.bondingCurveAddress, 'MarketId'),
    tokenMint: identifier(data.normalizedState.tokenMint, 'TokenMint'),
  },
  observedAt: utcInstant(data.observedAt),
  chainSlot: BigInt(data.slot),
  chainBlockId: null,
  adapterVersion: PUMP_FUN_ADAPTER_VERSION,
  normalizationVersion: PUMP_FUN_NORMALIZATION_VERSION,
  normalizedState: structuredClone(data.normalizedState),
  rawSource: structuredClone(data.rawSource),
});
export const stage1Scope = (
  accountId = 'account-a',
  userId = 'user-a',
  roundId = 'round-a',
): Stage1Scope => ({
  userId,
  accountId,
  roundId,
  startsAt: '2026-10-10T23:00:00.000Z',
  endsAtExclusive: '2026-10-11T00:00:00.000Z',
  mint: data.normalizedState.tokenMint,
  curve: data.normalizedState.bondingCurveAddress,
});
export const stage1Request = (
  model: Stage1Model,
  side: 'BUY' | 'SELL' = 'BUY',
  amount = '1700000000',
  key = `operation-${model.revision}`,
): Stage1Request => ({
  key,
  executionId: key,
  side,
  amount,
  expectedRevision: model.revision,
  predecessorHash: model.hash,
  at: '2026-10-10T23:55:00.000Z',
  phase: 'OPEN',
  continuity: 'ISOLATED_FIXED_SNAPSHOT',
});
const base = () => createStage1Model(stage1Scope(), stage1Snapshot());

it('uses five real lamports and canonical BUY/SELL transitions, with independent SDK equality', async () => {
  const initial = await base();
  expect(initial.current.normalizedState['realSolReserves']).toBe('5');
  const buy = await prepareStage1Transition(initial, initial.scope, stage1Request(initial));
  expect(buy.transition.tokenUnits).toBe('56869836258290');
  expect(buy.transition.inputLamports).toBe(
    (BigInt(buy.transition.curveLamports) + BigInt(buy.transition.feeLamports)).toString(),
  );
  expect(buy.model.current.normalizedState['realSolReserves']).toBe(
    (5n + BigInt(buy.transition.curveLamports)).toString(),
  );
  const exit = await stage1Exit(buy.model);
  expect(exit.full).toBe(true);
  expect(exit.max).toBe(buy.model.heldUnits);
  const sell = await prepareStage1Transition(
    buy.model,
    initial.scope,
    stage1Request(buy.model, 'SELL', buy.model.heldUnits),
  );
  expect(sell.transition.outputLamports).toBe('1658024687');
  expect(exit.netLamports).toBe(sell.transition.outputLamports);
  const n = buy.model.current.normalizedState;
  const reference = sdk.getSellSolAmountFromTokenAmount({
    global: {
      feeBasisPoints: new BN(95),
      creatorFeeBasisPoints: new BN(30),
      creatorFeeConfigurable: true,
    } as PumpSdk.Global,
    feeConfig: null,
    mintSupply: new BN(String(n['mintSupply'])),
    bondingCurve: {
      virtualTokenReserves: new BN(String(n['virtualTokenReserves'])),
      virtualQuoteReserves: new BN(String(n['virtualSolReserves'])),
      creator: new PublicKey(String(n['creator'])),
      quoteMint: PublicKey.default,
      creatorFeeBps: new BN(0),
    } as PumpSdk.BondingCurve,
    amount: new BN(buy.model.heldUnits),
  });
  expect(sell.transition.outputLamports).toBe(reference.toString());
  expect(sell.model.heldUnits).toBe('0');
});

it('multiple BUYs, partial exit, ALL, rebuy and replay preserve exact reserve continuity', async () => {
  const initial = await base();
  let model = initial;
  const records = [];
  for (const amount of ['946297321', '851667589']) {
    const r = await prepareStage1Transition(
      model,
      model.scope,
      stage1Request(model, 'BUY', amount),
    );
    records.push(r.transition);
    model = r.model;
  }
  expect(model.heldUnits).toBe('59963896741167');
  const partial = await prepareStage1Transition(
    model,
    model.scope,
    stage1Request(model, 'SELL', (BigInt(model.heldUnits) / 4n).toString()),
  );
  records.push(partial.transition);
  model = partial.model;
  expect((await stage1Exit(model)).full).toBe(true);
  const all = await prepareStage1Transition(
    model,
    model.scope,
    stage1Request(model, 'SELL', model.heldUnits),
  );
  records.push(all.transition);
  model = all.model;
  expect(model.heldUnits).toBe('0');
  const rebuy = await prepareStage1Transition(
    model,
    model.scope,
    stage1Request(model, 'BUY', '100000000'),
  );
  records.push(rebuy.transition);
  expect((await replayStage1(initial, JSON.parse(JSON.stringify(records)))).hash).toBe(
    rebuy.model.hash,
  );
  expect(initial.current.normalizedState['realSolReserves']).toBe('5');
});

it('isolates another owner and round and rejects forged scope and another user inventory', async () => {
  const a = await base();
  const b = await createStage1Model(stage1Scope('account-b', 'user-b'), stage1Snapshot());
  const c = await createStage1Model(
    {
      ...stage1Scope('account-next', 'user-a', 'round-next'),
      startsAt: '2026-10-11T00:00:00.000Z',
      endsAtExclusive: '2026-10-11T01:00:00.000Z',
    },
    stage1Snapshot(),
  );
  await prepareStage1Transition(a, a.scope, stage1Request(a));
  expect(b.heldUnits).toBe('0');
  expect(c.heldUnits).toBe('0');
  expect(b.hash).not.toBe(a.hash);
  await expect(prepareStage1Transition(a, b.scope, stage1Request(a))).rejects.toMatchObject({
    code: 'ACCOUNT_ROUND_SCOPE_MISMATCH',
  });
  await expect(
    prepareStage1Transition(b, b.scope, stage1Request(b, 'SELL', '1')),
  ).rejects.toMatchObject({ code: 'OWNED_INVENTORY_EXCEEDED' });
});

it.each(['revision', 'hash', 'amount', 'time', 'scope'] as const)(
  'rejects invalid %s without state repair',
  async (kind) => {
    const a = await base(),
      request = stage1Request(a);
    const bad = {
      ...request,
      ...(kind === 'revision'
        ? { expectedRevision: 8 }
        : kind === 'hash'
          ? { predecessorHash: 'missing' }
          : kind === 'amount'
            ? { amount: '1.7' }
            : kind === 'time'
              ? { at: a.scope.endsAtExclusive }
              : {}),
    };
    await expect(
      prepareStage1Transition(
        a,
        kind === 'scope' ? { ...a.scope, roundId: 'wrong' } : a.scope,
        bad,
      ),
    ).rejects.toThrow();
  },
);

it('rejects missing/reordered/duplicate/corrupt history and an inconsistent rehashed state', async () => {
  const a = await base(),
    b = await prepareStage1Transition(a, a.scope, stage1Request(a));
  const c = await prepareStage1Transition(
    b.model,
    a.scope,
    stage1Request(b.model, 'BUY', '100000000'),
  );
  for (const records of [
    [c.transition],
    [c.transition, b.transition],
    [b.transition, b.transition],
    [{ ...b.transition, outputLamports: '42' }],
  ])
    await expect(replayStage1(a, records)).rejects.toThrow();
  const { hash: _hash, ...body } = b.model;
  void _hash;
  const altered = {
    ...body,
    current: {
      ...body.current,
      normalizedState: { ...body.current.normalizedState, realSolReserves: '0' },
    },
  };
  await expect(stage1Exit({ ...altered, hash: stage1Hash(altered) })).rejects.toMatchObject({
    code: 'RESERVE_BALANCE_INCONSISTENT',
  });
});

it('requires reconciliation even for unchanged fresh reserves and prevents migration handoff guesses', async () => {
  const a = await base();
  expect(stage1Continuity(a, stage1Snapshot())).toEqual({
    available: false,
    reason: 'EXTERNAL_RECONCILIATION_REQUIRED',
  });
  expect(stage1Continuity(a, { ...stage1Snapshot(), chainSlot: 999999999n }).available).toBe(false);
  expect(
    stage1Continuity(a, {
      ...stage1Snapshot(),
      normalizedState: { ...stage1Snapshot().normalizedState, complete: true },
    }).reason,
  ).toBe('AUTHORITATIVE_MIGRATION_HANDOFF_REQUIRED');
  await expect(
    prepareStage1Transition(a, a.scope, {
      ...stage1Request(a),
      continuity: 'LIVE' as Stage1Request['continuity'],
    }),
  ).rejects.toMatchObject({ code: 'EXTERNAL_RECONCILIATION_REQUIRED' });
});

it('near-completion BUY records a terminal completion state and rejects unsupported follow-up execution', async () => {
  const s = stage1Snapshot(),
    bytes = [...(s.rawSource!['accountDataBase64'] as string[])],
    curve = Buffer.from(bytes[0]!, 'base64');
  curve.writeBigUInt64LE(100000000n, 24);
  bytes[0] = curve.toString('base64');
  const near = {
    ...s,
    rawSource: { ...s.rawSource, accountDataBase64: bytes },
    normalizedState: { ...s.normalizedState, realTokenReserves: '100000000' },
  };
  const a = await createStage1Model(stage1Scope(), near),
    b = await prepareStage1Transition(a, a.scope, stage1Request(a));
  expect(b.model.status).toBe('SIMULATED_COMPLETION');
  expect(b.model.current.normalizedState['complete']).toBe(true);
  await expect(stage1Exit(b.model)).rejects.toMatchObject({
    code: 'SIMULATED_COMPLETION_PENDING_MIGRATION',
  });
  await expect(
    createStage1Model(a.scope, {
      ...near,
      normalizedState: { ...near.normalizedState, complete: true },
    }),
  ).rejects.toThrow();
});

it('rejects unsupported fee evidence before committing a simulated operation', async () => {
  const s = stage1Snapshot(),
    bytes = [...(s.rawSource!['accountDataBase64'] as string[])],
    fees = Buffer.from(bytes[2]!, 'base64');
  fees.writeBigUInt64LE(10001n, 69 + 24);
  bytes[2] = fees.toString('base64');
  await expect(
    createStage1Model(stage1Scope(), {
      ...s,
      rawSource: { ...s.rawSource, accountDataBase64: bytes },
    }),
  ).rejects.toMatchObject({ code: 'UNSUPPORTED_FEE_CONFIGURATION' });
});

it('settlement uses existing old-round reserves once and normal BUY/SELL stop at exclusive cutoff', async () => {
  const a = await base(),
    b = await prepareStage1Transition(a, a.scope, stage1Request(a));
  const request = {
    ...stage1Request(b.model, 'SELL', b.model.heldUnits),
    phase: 'SETTLEMENT' as const,
    at: a.scope.endsAtExclusive,
  };
  const settled = await prepareStage1Transition(b.model, a.scope, request);
  expect(settled.model.heldUnits).toBe('0');
  await expect(prepareStage1Transition(settled.model, a.scope, request)).rejects.toThrow();
  await expect(
    prepareStage1Transition(b.model, a.scope, { ...request, side: 'BUY' }),
  ).rejects.toMatchObject({ code: 'UTC_ROUND_BOUNDARY' });
});

it('classifies coherent Stage 1 evidence, incomplete legacy evidence and the actual inconsistent historical BUYs without mutation', async () => {
  const a = await base(),
    b = await prepareStage1Transition(a, a.scope, stage1Request(a));
  expect(
    (
      await classifyStage1Legacy(a, [
        { side: 'BUY', amount: '1700000000', transition: b.transition },
      ])
    ).classification,
  ).toBe('FULLY_RECONSTRUCTABLE');
  expect(
    (await classifyStage1Legacy(a, [{ side: 'BUY', amount: '1700000000' }])).classification,
  ).toBe('PARTIALLY_RECONSTRUCTABLE');
  const rows = legacy.buys.map((row: { inputLamports: string; quantity: string }) => ({
    side: 'BUY' as const,
    amount: row.inputLamports,
    tokenUnits: row.quantity,
  }));
  expect((await classifyStage1Legacy(a, rows)).classification).toBe('NOT_SAFELY_RECONSTRUCTABLE');
  expect(a.revision).toBe(0);
});

it('rejects a wrong curve and malformed state version before a canonical execution', async () => {
  await expect(
    createStage1Model(
      { ...stage1Scope(), curve: '11111111111111111111111111111111' },
      stage1Snapshot(),
    ),
  ).rejects.toMatchObject({ code: 'CANONICAL_CURVE_MISMATCH' });
  const a = await base();
  await expect(stage1Exit({ ...a, revision: -1 })).rejects.toMatchObject({
    code: 'STATE_VERSION_INVALID',
  });
});

it('does not classify a mismatched associated legacy fill as fully reconstructable', async () => {
  const a = await base(),
    b = await prepareStage1Transition(a, a.scope, stage1Request(a));
  expect(
    (
      await classifyStage1Legacy(a, [
        { side: 'BUY', amount: '1700000000', tokenUnits: '1', transition: b.transition },
      ])
    ).classification,
  ).toBe('NOT_SAFELY_RECONSTRUCTABLE');
});

it('reselects a synthetic fee tier from projected capitalization and matches independent SDK SELL fees', async () => {
  const s = stage1Snapshot(),
    bytes = [...(s.rawSource!['accountDataBase64'] as string[])],
    config = Buffer.from(bytes[2]!, 'base64');
  // Synthetic second tier, not a claim about the recorded chain fee schedule.
  config.writeUInt32LE(2, 65);
  config.fill(0, 109, 149);
  config.writeBigUInt64LE(30_000_000_000n, 109);
  config.writeBigUInt64LE(80n, 133);
  config.writeBigUInt64LE(20n, 141);
  bytes[2] = config.toString('base64');
  const a = await createStage1Model(stage1Scope(), {
    ...s,
    rawSource: { ...s.rawSource, accountDataBase64: bytes },
  });
  const b = await prepareStage1Transition(a, a.scope, stage1Request(a));
  const sell = await prepareStage1Transition(
    b.model,
    a.scope,
    stage1Request(b.model, 'SELL', b.model.heldUnits),
  );
  expect(sell.model.current.normalizedState['protocolFeeBps']).toBe('80');
  expect(sell.model.current.normalizedState['creatorFeeBps']).toBe('20');
  const n = b.model.current.normalizedState;
  const expected = sdk.getSellSolAmountFromTokenAmount({
    global: {
      feeBasisPoints: new BN(80),
      creatorFeeBasisPoints: new BN(20),
      creatorFeeConfigurable: true,
    } as PumpSdk.Global,
    feeConfig: null,
    mintSupply: new BN(String(n['mintSupply'])),
    bondingCurve: {
      virtualTokenReserves: new BN(String(n['virtualTokenReserves'])),
      virtualQuoteReserves: new BN(String(n['virtualSolReserves'])),
      creator: new PublicKey(String(n['creator'])),
      quoteMint: PublicKey.default,
      creatorFeeBps: new BN(0),
    } as PumpSdk.BondingCurve,
    amount: new BN(b.model.heldUnits),
  });
  expect(sell.transition.outputLamports).toBe(expected.toString());
});

it('rejects a later revision carrying a backward action timestamp', async () => {
  const a = await base(),
    b = await prepareStage1Transition(a, a.scope, stage1Request(a));
  await expect(
    prepareStage1Transition(b.model, a.scope, {
      ...stage1Request(b.model),
      at: '2026-10-10T23:54:00.000Z',
    }),
  ).rejects.toMatchObject({ code: 'OUT_OF_ORDER_ACTION_TIME' });
});
