import { controlledNativeCurveInterval } from './mixed-fixtures.js';
import { controlledSolCurveBank } from './mixed-fixtures.js';
import {
  WRAPPED_SOL_MINT,
  PUMP_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '../../src/pump-fun.js';
import bs58 from 'bs58';
import { createHash } from 'node:crypto';
import type { CurveNativeAccount } from './pump-curve.js';
import type { ProviderInterval, Instruction, Receipt } from './external-flow.js';
import { it, expect } from 'vitest';
import {
  mixedBank,
  mixedInstruction,
  controlledMixedInterval,
  CURVE,
  CURVE_MINT,
} from './mixed-fixtures.js';
import { transitionMultiHop } from './pump-multihop.js';
import { transitionExternalCurve, validatePumpCurve } from './pump-curve.js';
import { newLinkedBranch, reconcileLinkedInterval, digest } from './external-flow.js';
import { transitionLinkedSnapshot } from './native-transition.js';
it('controlled pool/curve BUY then partial/full SELL applies route-wide fees once and protects retained buckets', async () => {
  let s = mixedBank();
  const original = structuredClone(s),
    x = await mixedInstruction(s, true, 10000000n),
    b = await transitionMultiHop(s, x.ix, x.keys);
  expect(s).toEqual(original);
  expect(b.steps[0]!.fees.creator).toBe(0n);
  expect(b.steps[1]!.fees.protocol).toBe(0n);
  expect(b.steps[1]!.fees.lp).toBe(0n);
  expect(b.steps[1]!.fees.creator).toBeGreaterThan(0n);
  let returned = 0n;
  s = b.next;
  for (const q of [b.output / 3n, b.output - b.output / 3n]) {
    const z = await mixedInstruction(s, false, q),
      sell = await transitionMultiHop(s, z.ix, z.keys);
    returned += sell.output;
    s = sell.next;
    expect(sell.steps[0]!.fees.protocol).toBe(0n);
    expect(sell.steps[1]!.fees.creator).toBe(0n);
  }
  expect(returned).toBeGreaterThan(0n);
  expect(returned).toBeLessThan(10000000n);
  await validatePumpCurve(s, CURVE, CURVE_MINT, s.quoteMint);
});
it('controlled mixed external flow preserves prior paper impact across repeated buys, reverse flow, restart and interval retry', async () => {
  const e = await controlledMixedInterval(),
    branch = newLinkedBranch('a', 'r', e.before);
  for (let i = 0; i < 2; i++)
    branch.simulated = (
      await transitionLinkedSnapshot(branch.simulated, 10000000n, true, {
        nowMs: Date.parse(branch.simulated.observedAt),
        maxAgeMs: 10000,
      })
    ).next;
  const before = digest(branch),
    a = await reconcileLinkedInterval(branch, e, Date.parse(e.after.observedAt), 10000);
  expect(digest(branch)).toBe(before);
  expect(a.events).toBe(2);
  expect(digest(a.branch.real)).not.toBe(digest(a.branch.simulated));
  const restart = JSON.parse(JSON.stringify(a.branch));
  expect(
    (await reconcileLinkedInterval(restart, e, Date.parse(e.after.observedAt), 10000)).replay,
  ).toBe(true);
  const sell = await controlledMixedInterval(e.after, false, 100000000n),
    b = await reconcileLinkedInterval(restart, sell, Date.parse(sell.after.observedAt), 10000);
  expect(b.events).toBe(2);
  expect(b.branch.intervals).toHaveLength(2);
  expect(digest(b.branch.real)).not.toBe(digest(b.branch.simulated));
});
it('mixed replay rejects missing physical transfers, wrong successor bytes, incomplete dependencies and signed minimum failure without mutating its branch', async () => {
  for (const mutate of [
    (e: ProviderInterval) =>
      e.blocks[0]!.result.transactions[0]!.meta.innerInstructions[0]!.instructions.pop(),
    (e: ProviderInterval) => {
      const a = e.after.accounts[CURVE]!;
      const b = Buffer.from(a.base64, 'base64');
      b[125] = b[125]! ^ 1;
      e.after.accounts[CURVE] = { ...a, base64: b.toString('base64') };
    },
  ]) {
    const e = await controlledMixedInterval(),
      branch = newLinkedBranch('a', 'r', e.before),
      before = digest(branch);
    mutate(e);
    await expect(
      reconcileLinkedInterval(branch, e, Date.parse(e.after.observedAt), 10000),
    ).rejects.toThrow();
    expect(digest(branch)).toBe(before);
  }
  const s = mixedBank(),
    x = await mixedInstruction(s, true, 10000000n);
  delete s.accounts[CURVE];
  await expect(transitionMultiHop(s, x.ix, x.keys)).rejects.toThrow('DEPENDENCY_MISSING');
});
it('native curve exact output has independently invertible cost, buckets and physical reserves; unsupported completion rejects', async () => {
  const s = mixedBank(),
    v = await validatePumpCurve(s, CURVE, CURVE_MINT, s.quoteMint),
    amount = 1000000n,
    spec = {
      pool: CURVE,
      baseMint: CURVE_MINT,
      quoteMint: s.quoteMint,
      buy: true,
      exactOutput: true,
      legacy: false,
      amount,
      bound: 100000000n,
      userBase: 'base',
      userQuote: 'quote',
      protocolRecipient: '',
      creatorRecipient: '',
      buybackRecipient: 'buyback',
    },
    r = await transitionExternalCurve(s, spec, {
      nowMs: Date.parse(s.observedAt),
      maxAgeMs: 10000,
    });
  const after = await validatePumpCurve(r.next, CURVE, CURVE_MINT, s.quoteMint);
  expect(after.curve.virtualTokenReserves).toBe(v.curve.virtualTokenReserves - amount);
  expect(after.quoteBalance - v.quoteBalance).toBe(r.input - r.quote.fees.buyback);
  expect(after.curve.realSolReserves - v.curve.realSolReserves).toBe(r.quote.grossQuote);
  expect(r.quote.fees.lp).toBe(0n);
  const completed = await transitionExternalCurve(
    s,
    { ...spec, amount: v.curve.realTokenReserves + 1000000n, bound: (1n << 64n) - 1n },
    { nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 },
  );
  const raw = Buffer.from(completed.next.accounts[CURVE]!.base64, 'base64');
  expect(raw[48]).toBe(1);
  expect(raw.readBigUInt64LE(24)).toBe(0n);
  expect(raw.readBigUInt64LE(150)).toBe(1000000n);
  expect(raw.readBigUInt64LE(158)).toBeGreaterThan(0n);
  await expect(validatePumpCurve(completed.next, CURVE, CURVE_MINT, s.quoteMint)).rejects.toThrow(
    'COMPLETION_UNSUPPORTED',
  );
});

it('controlled native-SOL V3 curve BUY and SELL reconcile wallet lamports separately from WSOL, including restart and exact endpoint rejection', async () => {
  let root = controlledSolCurveBank(),
    branch = newLinkedBranch('a', 'r', root),
    tokens = 0n;
  for (const buy of [true, false]) {
    const v = await validatePumpCurve(root, CURVE, CURVE_MINT, WRAPPED_SOL_MINT),
      input = buy ? 10000000n : tokens / 2n,
      spec = {
        pool: CURVE,
        baseMint: CURVE_MINT,
        quoteMint: WRAPPED_SOL_MINT,
        baseVault: v.baseVault,
        quoteVault: v.quoteVault,
        nativeUser: 'native-user',
        buy,
        exactOutput: false,
        legacy: false,
        amount: input,
        bound: 1n,
        userBase: 'user-base',
        userQuote: 'unused-wsol',
        protocolRecipient: '',
        creatorRecipient: '',
        buybackRecipient: 'native-buyback',
      };
    const r = await transitionExternalCurve(root, spec, {
      nowMs: Date.parse(root.observedAt),
      maxAgeMs: 10000,
    });
    const keys = [
      PUMP_PROGRAM_ID,
      SPL_TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
      '11111111111111111111111111111111',
    ];
    const a = [
      '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf',
      CURVE_MINT,
      WRAPPED_SOL_MINT,
      root.accounts[CURVE_MINT]!.owner,
      root.accounts[WRAPPED_SOL_MINT]!.owner,
      CURVE,
      v.baseVault,
      v.quoteVault,
      'native-user',
      'user-base',
      'unused-wsol',
      'volume',
      '8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt',
      'native-buyback',
      '11111111111111111111111111111111',
      'event',
      PUMP_PROGRAM_ID,
    ];
    for (const k of a) if (!keys.includes(k)) keys.push(k);
    const raw = Buffer.alloc(24);
    createHash('sha256')
      .update('global:' + (buy ? 'buy_exact_quote_in_v3' : 'sell_v3'))
      .digest()
      .copy(raw, 0, 0, 8);
    raw.writeBigUInt64LE(input, 8);
    raw.writeBigUInt64LE(1n, 16);
    const ix: Instruction = {
        programIdIndex: 0,
        accounts: a.map((k) => keys.indexOf(k)),
        data: bs58.encode(raw),
      },
      pre = keys.map((k) =>
        k === CURVE
          ? Number((root.accounts[CURVE] as CurveNativeAccount).lamports)
          : k === 'native-user'
            ? 1000000000
            : 0,
      ),
      post = [...pre],
      inner: Instruction[] = [];
    for (const t of r.transfers) {
      if (t.kind) {
        post[keys.indexOf(t.from)]! -= Number(t.amount);
        post[keys.indexOf(t.to)]! += Number(t.amount);
        if (t.kind === 'NATIVE_SYSTEM') {
          const d = Buffer.alloc(12);
          d.writeUInt32LE(2);
          d.writeBigUInt64LE(t.amount, 4);
          inner.push({
            programIdIndex: keys.indexOf('11111111111111111111111111111111'),
            accounts: [keys.indexOf(t.from), keys.indexOf(t.to)],
            data: bs58.encode(d),
            stackHeight: 2,
          });
        }
      } else {
        const d = Buffer.alloc(9);
        d[0] = 3;
        d.writeBigUInt64LE(t.amount, 1);
        inner.push({
          programIdIndex: keys.indexOf(root.accounts[CURVE_MINT]!.owner),
          accounts: [keys.indexOf(t.from), keys.indexOf(t.to)],
          data: bs58.encode(d),
          stackHeight: 2,
        });
      }
    }
    const balances = (base: bigint, user: bigint) => [
      {
        accountIndex: keys.indexOf(v.baseVault),
        mint: CURVE_MINT,
        uiTokenAmount: { amount: base.toString() },
      },
      {
        accountIndex: keys.indexOf('user-base'),
        mint: CURVE_MINT,
        uiTokenAmount: { amount: user.toString() },
      },
    ];
    const receipt: Receipt = {
      version: 0,
      transaction: {
        signatures: ['CONTROLLED-NATIVE-' + buy],
        message: { accountKeys: keys, instructions: [ix] },
      },
      meta: {
        err: null,
        fee: 0,
        preBalances: pre,
        postBalances: post,
        preTokenBalances: balances(v.baseBalance, tokens),
        postTokenBalances: balances(
          buy ? v.baseBalance - r.output : v.baseBalance + input,
          buy ? tokens + r.output : tokens - input,
        ),
        innerInstructions: [{ index: 0, instructions: inner }],
      },
    };
    const after = r.next,
      clock = 'SysvarC1ock11111111111111111111111111111111',
      b = Buffer.from(after.accounts[clock]!.base64, 'base64');
    after.slot++;
    b.writeBigUInt64LE(BigInt(after.slot), 0);
    b.writeBigInt64LE(b.readBigInt64LE(32) + 1n, 32);
    after.accounts[clock] = { ...after.accounts[clock]!, base64: b.toString('base64') };
    after.observedAt = new Date(Number(b.readBigInt64LE(32)) * 1000).toISOString();
    const e: ProviderInterval = {
      schema: 'LINKED_RETAINED_RPC_INTERVAL_V1',
      commitment: 'finalized',
      before: root,
      after,
      acquiredAt: after.observedAt,
      slots: [after.slot],
      anchor: { blockhash: 'controlled-before' },
      blocks: [
        {
          slot: after.slot,
          result: {
            parentSlot: root.slot,
            previousBlockhash: 'controlled-before',
            blockhash: 'controlled-after',
            blockTime: Number(b.readBigInt64LE(32)),
            transactions: [receipt],
          },
        },
      ],
    };
    const applied = await reconcileLinkedInterval(branch, e, Date.parse(after.observedAt), 10000);
    expect(applied.events).toBe(1);
    expect(applied.branch.real.accounts[CURVE]).toEqual(after.accounts[CURVE]);
    expect(
      (await reconcileLinkedInterval(applied.branch, e, Date.parse(after.observedAt), 10000))
        .replay,
    ).toBe(true);
    const bad = structuredClone(e);
    bad.blocks[0]!.result.transactions[0]!.meta.postBalances![keys.indexOf('native-user')]!++;
    await expect(
      reconcileLinkedInterval(branch, bad, Date.parse(after.observedAt), 10000),
    ).rejects.toThrow('NATIVE_TRANSACTION_EFFECTS_UNRECONCILED');
    branch = JSON.parse(JSON.stringify(applied.branch));
    root = after;
    tokens = buy ? tokens + r.output : tokens - input;
  }
});

it('native BUY/SELL and completing BUY outputs match pinned official SDK 4.1.0 pricing across SOL/exotic fees and rounding boundaries', async () => {
  const { default: BN } = await import('bn.js'),
    { PublicKey } = await import('@solana/web3.js');
  const oracleUrl = new URL(
    '../../../../docs/linked-pair-20261022/mixed-route/curve-sdk-oracle.mjs',
    import.meta.url,
  ).href;
  const sdk = (await import(oracleUrl)) as Record<
    string,
    (args: Record<string, unknown>) => { toString(): string }
  >;
  for (const s of [mixedBank(), controlledSolCurveBank()]) {
    const raw = Buffer.from(s.accounts[CURVE]!.base64, 'base64'),
      q = new PublicKey(raw.subarray(83, 115)).toBase58(),
      v = await validatePumpCurve(s, CURVE, CURVE_MINT, q),
      g = Buffer.from(s.accounts['4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf']!.base64, 'base64'),
      f = Buffer.from(s.accounts['8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt']!.base64, 'base64');
    const bn = (n: bigint) => new BN(n.toString()),
      fees = (p: number) => ({
        lpFeeBps: bn(f.readBigUInt64LE(p)),
        protocolFeeBps: bn(f.readBigUInt64LE(p + 8)),
        creatorFeeBps: bn(f.readBigUInt64LE(p + 16)),
      });
    let offset = 69;
    const tiers = (count: number) =>
      Array.from({ length: count }, () => {
        const p = offset;
        offset += 40;
        return {
          marketCapLamportsThreshold: bn(f.readBigUInt64LE(p) + (f.readBigUInt64LE(p + 8) << 64n)),
          fees: fees(p + 16),
        };
      });
    const feeTiers = tiers(f.readUInt32LE(65)),
      count = f.readUInt32LE(offset);
    offset += 4;
    const stableFeeTiers = tiers(count),
      feeConfig = { flatFees: fees(41), feeTiers, stableFeeTiers, exoticFlatFees: fees(offset) };
    const global = {
        creatorFeeConfigurable: g[1045] === 1,
        poolMigrationFee: bn(g.readBigUInt64LE(146)),
        feeBasisPoints: bn(g.readBigUInt64LE(105)),
        creatorFeeBasisPoints: bn(g.readBigUInt64LE(154)),
      },
      bondingCurve = {
        virtualTokenReserves: bn(v.curve.virtualTokenReserves),
        virtualQuoteReserves: bn(v.curve.virtualSolReserves),
        realTokenReserves: bn(v.curve.realTokenReserves),
        realQuoteReserves: bn(v.curve.realSolReserves),
        tokenTotalSupply: bn(v.curve.tokenTotalSupply),
        complete: false,
        creator: new PublicKey(v.curve.creator),
        isMayhemMode: false,
        quoteMint: new PublicKey(q),
        creatorFeeBps: bn(v.curve.creatorFeeBps),
      };
    const args = {
      global,
      feeConfig,
      mintSupply: bn(1000000000000000n),
      bondingCurve,
      curveBaseTokenBalance: bn(v.baseBalance),
    };
    for (const amount of [2n, 100n, 10001n, 10000000n, 10000001n, 1000000000n]) {
      const expected = BigInt(
          sdk.getBuyV3TokenAmountFromQuoteAmount!({ ...args, amount: bn(amount) }).toString(),
        ),
        spec = {
          pool: CURVE,
          baseMint: CURVE_MINT,
          quoteMint: q,
          nativeUser: 'user',
          buy: true,
          exactOutput: false,
          legacy: false,
          amount,
          bound: 0n,
          userBase: 'base',
          userQuote: 'quote',
          protocolRecipient: '',
          creatorRecipient: '',
          buybackRecipient: 'buyback',
        };
      if (expected === 0n) {
        await expect(
          transitionExternalCurve(s, spec, { nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 }),
        ).rejects.toThrow('CURVE_DUST');
        continue;
      }
      const actual = await transitionExternalCurve(s, spec, {
        nowMs: Date.parse(s.observedAt),
        maxAgeMs: 10000,
      });
      expect(actual.output).toBe(expected);
      const sellExpected = BigInt(
        sdk.getSellSolAmountFromTokenAmount!({ ...args, amount: bn(expected) }).toString(),
      );
      const sellPromise = transitionExternalCurve(
        s,
        { ...spec, buy: false, amount: expected },
        { nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 },
      );
      const gross =
        (expected * v.curve.virtualSolReserves) / (v.curve.virtualTokenReserves + expected);
      if (gross > v.curve.realSolReserves)
        await expect(sellPromise).rejects.toThrow('CURVE_REAL_QUOTE_RESERVES');
      else expect((await sellPromise).output).toBe(sellExpected);
    }
    for (const amount of [1000000n, v.curve.realTokenReserves + 1000000n]) {
      const expected = BigInt(
          sdk.getBuyV3QuoteAmountFromTokenAmount!({ ...args, amount: bn(amount) }).toString(),
        ),
        actual = await transitionExternalCurve(
          s,
          {
            pool: CURVE,
            baseMint: CURVE_MINT,
            quoteMint: q,
            nativeUser: 'user',
            buy: true,
            exactOutput: true,
            legacy: false,
            amount,
            bound: (1n << 64n) - 1n,
            userBase: 'base',
            userQuote: 'quote',
            protocolRecipient: '',
            creatorRecipient: '',
            buybackRecipient: 'buyback',
          },
          { nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 },
        );
      expect(actual.input).toBe(expected);
    }
  }
});

it('controlled mixed chronology ignores a failed on-chain instruction, rejects wrong CPI fees, signed slippage and incoherent Clock without consuming liquidity', async () => {
  const e = await controlledMixedInterval(),
    failed = structuredClone(e.blocks[0]!.result.transactions[0]!);
  failed.transaction.signatures = ['CONTROLLED-FAILED'];
  failed.meta.err = { InstructionError: [0, 'Custom'] };
  e.blocks[0]!.result.transactions.unshift(failed);
  const branch = newLinkedBranch('a', 'r', e.before),
    result = await reconcileLinkedInterval(branch, e, Date.parse(e.after.observedAt), 10000);
  expect(result.events).toBe(2);
  expect(result.failedTransactions).toBe(1);
  const wrong = structuredClone(e),
    tx = wrong.blocks[0]!.result.transactions[1]!,
    ix = tx.meta.innerInstructions[0]!.instructions.find(
      (i) => tx.transaction.message.accountKeys[i.programIdIndex] === PUMP_PROGRAM_ID,
    )!,
    raw = Buffer.from(bs58.decode(ix.data));
  raw[20] = 3;
  ix.data = bs58.encode(raw);
  await expect(
    reconcileLinkedInterval(branch, wrong, Date.parse(e.after.observedAt), 10000),
  ).rejects.toThrow('CURVE_CPI_BINDING');
  const x = await mixedInstruction(e.before, true, 10000000n),
    bound = Buffer.from(bs58.decode(x.ix.data));
  bound.writeBigUInt64LE((1n << 64n) - 1n, 16);
  x.ix.data = bs58.encode(bound);
  await expect(transitionMultiHop(e.before, x.ix, x.keys)).rejects.toThrow('SIGNED_MINIMUM');
  const bad = structuredClone(e);
  bad.before.slot++;
  await expect(
    reconcileLinkedInterval(
      newLinkedBranch('a', 'r', bad.before),
      bad,
      Date.parse(bad.after.observedAt),
      10000,
    ),
  ).rejects.toThrow('CLOCK_INCONSISTENT');
  expect(branch.intervals).toHaveLength(0);
});
it('native-SOL curves require retained lamports and reject unsupported fee/extension modes rather than substituting WSOL or midprices', async () => {
  const s = controlledSolCurveBank();
  delete (s.accounts[CURVE] as CurveNativeAccount).lamports;
  await expect(validatePumpCurve(s, CURVE, CURVE_MINT, WRAPPED_SOL_MINT)).rejects.toThrow(
    'LAMPORT_STATE_REQUIRED',
  );
  const exotic = mixedBank(),
    raw = Buffer.from(exotic.accounts[CURVE]!.base64, 'base64');
  raw[82] = 1;
  exotic.accounts[CURVE] = { ...exotic.accounts[CURVE]!, base64: raw.toString('base64') };
  await expect(validatePumpCurve(exotic, CURVE, CURVE_MINT, exotic.quoteMint)).rejects.toThrow(
    'FLAGS_OR_COMPLETION_UNSUPPORTED',
  );
});

it('controlled native SOL/curve/curve routes use one grouped CPI, native currency transfers and one fee at each end', async () => {
  const { PublicKey } = await import('@solana/web3.js'),
    { getAssociatedTokenAddressSync } = await import('@solana/spl-token'),
    { pumpBondingCurveAddress } = await import('../../src/pump-fun.js');
  const s = mixedBank(),
    cs = s.quoteMint,
    curve = await pumpBondingCurveAddress(cs),
    raw = Buffer.from(s.accounts[CURVE]!.base64, 'base64');
  new PublicKey(WRAPPED_SOL_MINT).toBuffer().copy(raw, 83);
  const vault = (mint: string) =>
      getAssociatedTokenAddressSync(
        new PublicKey(mint),
        new PublicKey(curve),
        true,
        new PublicKey(s.accounts[mint]!.owner),
      ).toBase58(),
    baseVault = vault(cs),
    quoteVault = vault(WRAPPED_SOL_MINT),
    existing = await validatePumpCurve(s, CURVE, CURVE_MINT, cs),
    token = Buffer.from(s.accounts[existing.baseVault]!.base64, 'base64');
  new PublicKey(cs).toBuffer().copy(token, 0);
  new PublicKey(curve).toBuffer().copy(token, 32);
  s.accounts[baseVault] = { owner: s.accounts[cs]!.owner, base64: token.toString('base64') };
  const rent = Buffer.from(
      s.accounts['SysvarRent111111111111111111111111111111111']!.base64,
      'base64',
    ),
    lamports =
      BigInt(raw.length + 128) * rent.readBigUInt64LE(0) * BigInt(rent.readDoubleLE(8)) +
      raw.readBigUInt64LE(32) +
      raw.readBigUInt64LE(125) +
      raw.readBigUInt64LE(133);
  s.accounts[curve] = {
    owner: PUMP_PROGRAM_ID,
    base64: raw.toString('base64'),
    lamports: lamports.toString(),
  } as (typeof s.accounts)[string];
  const x = await mixedInstruction(s, true, 10000000n),
    fixed = x.ix.accounts.slice(0, 16).map((i) => x.keys[i]!),
    h = [
      cs,
      WRAPPED_SOL_MINT,
      curve,
      baseVault,
      quoteVault,
      CURVE_MINT,
      cs,
      CURVE,
      existing.baseVault,
      existing.quoteVault,
    ];
  for (const a of h) if (!x.keys.includes(a)) x.keys.push(a);
  x.ix.accounts = [...fixed, ...h].map((a) => x.keys.indexOf(a));
  const b = await transitionMultiHop(s, x.ix, x.keys);
  expect(b.curveCalls).toHaveLength(1);
  expect(b.curveCalls[0]!.fees).toEqual([1, 2]);
  expect(b.transfers.filter((t) => t.kind === 'NATIVE_SYSTEM')).toHaveLength(1);
  expect(b.steps[0]!.fees.creator).toBe(0n);
  expect(b.steps[1]!.fees.protocol).toBe(0n);
  expect(b.transfers.some((t) => t.to === 'controlled-source')).toBe(false);
  const e = await controlledNativeCurveInterval(s, x.ix, x.keys),
    branch = newLinkedBranch('native-group', 'r', e.before);
  branch.simulated = (
    await transitionLinkedSnapshot(branch.simulated, 10000000n, true, {
      nowMs: Date.parse(s.observedAt),
      maxAgeMs: 10000,
    })
  ).next;
  const applied = await reconcileLinkedInterval(branch, e, Date.parse(e.after.observedAt), 10000);
  expect(applied.events).toBe(2);
  expect(applied.branch.simulated.accounts[s.bridgePool]).not.toEqual(
    applied.branch.real.accounts[s.bridgePool],
  );
  expect(
    (
      await reconcileLinkedInterval(
        JSON.parse(JSON.stringify(applied.branch)),
        e,
        Date.parse(e.after.observedAt),
        10000,
      )
    ).replay,
  ).toBe(true);
  const sell = structuredClone(x);
  sell.ix.accounts = [...fixed, ...h.slice(5), ...h.slice(0, 5)].map((a) => sell.keys.indexOf(a));
  const d = Buffer.from(bs58.decode(sell.ix.data));
  d.writeBigUInt64LE(b.output, 8);
  sell.ix.data = bs58.encode(d);
  const r = await transitionMultiHop(b.next, sell.ix, sell.keys);
  expect(r.curveCalls[0]!.fees).toEqual([2, 1]);
  expect(r.output).toBeGreaterThan(0n);
  expect(r.output).toBeLessThan(10000000n);
  expect(r.transfers.at(-1)!.kind).toBe('NATIVE_DIRECT');
  expect(r.transfers.at(-1)!.to).toBe('controlled-user');
});

it('controlled one-curve native route charges both end fees and rejects a fee recipient denominated in the wrong currency', async () => {
  const s = mixedBank(),
    x = await mixedInstruction(s, true, 10000000n);
  x.ix.accounts = [...x.ix.accounts.slice(0, 16), ...x.ix.accounts.slice(-5)];
  const mints = new Map([
      ['controlled-source', s.quoteMint],
      ['controlled-destination', CURVE_MINT],
      ['controlled-buyback', s.quoteMint],
    ]),
    r = await transitionMultiHop(s, x.ix, x.keys, mints);
  expect(r.curveCalls[0]!.fees).toEqual([3]);
  expect(r.steps[0]!.fees.protocol).toBeGreaterThan(0n);
  expect(r.steps[0]!.fees.creator).toBeGreaterThan(0n);
  mints.set('controlled-buyback', WRAPPED_SOL_MINT);
  await expect(transitionMultiHop(s, x.ix, x.keys, mints)).rejects.toThrow('FEE_MINT_BINDING');
});
