/** CONTROLLED chronology using genuine retained account bytes. Not witnessed mainnet swaps. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { decodePumpSwapPool, PUMP_AMM_PROGRAM_ID } from '../../src/pump-swap.js';
import {
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  WRAPPED_SOL_MINT,
  PUMP_PROGRAM_ID,
} from '../../src/pump-fun.js';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import { transitionMultiHop } from './pump-multihop.js';
import { validatePumpCurve } from './pump-curve.js';
import type { ProviderInterval, Instruction, Receipt } from './external-flow.js';
export const CURVE_MINT = '4qiY4Sif7zjQRJiPiMkxwJzaDKgvrXBHKAXvuSPXpump',
  CURVE = 'GgKvwf8rXGwbX2xUTViCcrZMSK8RU1VL6ttga8JmiRo2';
export function mixedBank(): Stage1Snapshot {
  return JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          '../../../../docs/linked-pair-20261021/external-flow-completion/provider-459758217-459758224.json.gz',
          import.meta.url,
        ),
      ),
    ).toString(),
  ).before;
}
export async function mixedInstruction(s: Stage1Snapshot, buy: boolean, input: bigint) {
  const c = await validatePumpCurve(s, CURVE, CURVE_MINT, s.quoteMint),
    b = decodePumpSwapPool(Buffer.from(s.accounts[s.bridgePool]!.base64, 'base64'));
  const h = [
    {
      base: b.baseMint,
      quote: b.quoteMint,
      pool: s.bridgePool,
      baseVault: b.baseVault,
      quoteVault: b.quoteVault,
    },
    {
      base: CURVE_MINT,
      quote: s.quoteMint,
      pool: CURVE,
      baseVault: c.baseVault,
      quoteVault: c.quoteVault,
    },
  ];
  if (!buy) h.reverse();
  const keys = [PUMP_AMM_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, PUMP_PROGRAM_ID],
    a = [
      'controlled-user',
      'controlled-source',
      'controlled-destination',
      'ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw',
      '5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx',
      'controlled-volume',
      'controlled-buyback',
      SPL_TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
      '11111111111111111111111111111111',
      'event',
      PUMP_AMM_PROGRAM_ID,
      PUMP_PROGRAM_ID,
      '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf',
      '8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt',
      'curve-event',
    ];
  for (const v of h) a.push(v.base, v.quote, v.pool, v.baseVault, v.quoteVault);
  for (const v of a) if (!keys.includes(v)) keys.push(v);
  const raw = Buffer.alloc(24);
  createHash('sha256').update('global:multi_hop_swap').digest().copy(raw, 0, 0, 8);
  raw.writeBigUInt64LE(input, 8);
  raw.writeBigUInt64LE(1n, 16);
  return {
    keys,
    ix: {
      programIdIndex: 0,
      accounts: a.map((v) => keys.indexOf(v)),
      data: bs58.encode(raw),
    } as Instruction,
  };
}
export async function controlledMixedInterval(
  s = mixedBank(),
  buy = true,
  input = 10000000n,
): Promise<ProviderInterval> {
  const x = await mixedInstruction(s, buy, input),
    r = await transitionMultiHop(s, x.ix, x.keys),
    keys = x.keys;
  const pre = new Map<string, { mint: string; amount: bigint }>();
  for (const a of new Set(r.transfers.flatMap((t) => [t.from, t.to]))) {
    const acct = s.accounts[a],
      raw = Buffer.from(acct?.base64 ?? '', 'base64');
    if (
      acct &&
      [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(acct.owner) &&
      raw.length >= 165
    )
      pre.set(a, {
        mint: new PublicKey(raw.subarray(0, 32)).toBase58(),
        amount: raw.readBigUInt64LE(64),
      });
    else
      pre.set(a, {
        mint:
          a === 'controlled-source'
            ? buy
              ? WRAPPED_SOL_MINT
              : CURVE_MINT
            : a === 'controlled-buyback'
              ? WRAPPED_SOL_MINT
              : buy
                ? CURVE_MINT
                : WRAPPED_SOL_MINT,
        amount: a === 'controlled-source' ? input : 0n,
      });
    if (!keys.includes(a)) keys.push(a);
  }
  const post = structuredClone(pre),
    inner: Instruction[] = [];
  const call = r.curveCalls[0]!;
  for (const a of call.accounts) if (!keys.includes(a)) keys.push(a);
  const cpi = Buffer.alloc(20 + call.fees.length);
  createHash('sha256').update('global:multi_hop_curve_swap').digest().copy(cpi, 0, 0, 8);
  cpi.writeBigUInt64LE(call.input, 8);
  cpi.writeUInt32LE(call.fees.length, 16);
  Buffer.from(call.fees).copy(cpi, 20);
  let cpiStarted = false;
  for (const [i, t] of r.transfers.entries()) {
    if (!cpiStarted && (buy ? i === 2 : i === 0)) {
      inner.push({
        programIdIndex: keys.indexOf(PUMP_PROGRAM_ID),
        accounts: call.accounts.map((a) => keys.indexOf(a)),
        data: bs58.encode(cpi),
        stackHeight: 2,
      });
      cpiStarted = true;
    }
    post.get(t.from)!.amount -= t.amount;
    post.get(t.to)!.amount += t.amount;
    const d = Buffer.alloc(9);
    d[0] = 3;
    d.writeBigUInt64LE(t.amount, 1);
    const mint = pre.get(t.from)!.mint,
      program = s.accounts[mint]?.owner ?? SPL_TOKEN_PROGRAM_ID;
    inner.push({
      programIdIndex: keys.indexOf(program),
      accounts: [keys.indexOf(t.from), keys.indexOf(t.to)],
      data: bs58.encode(d),
      stackHeight: cpiStarted ? 3 : 2,
    });
  }
  const balances = (v: typeof pre) =>
    [...v].map(([a, b]) => ({
      accountIndex: keys.indexOf(a),
      mint: b.mint,
      uiTokenAmount: { amount: b.amount.toString() },
    }));
  const native = (v: typeof pre) =>
    keys.map((a) =>
      v.get(a)?.mint === WRAPPED_SOL_MINT ? Number(v.get(a)!.amount + 1488440n) : 0,
    );
  const receipt: Receipt = {
    version: 0,
    transaction: {
      signatures: ['CONTROLLED-MIXED-' + s.slot + '-' + buy],
      message: { accountKeys: keys, instructions: [x.ix] },
    },
    meta: {
      err: null,
      fee: 0,
      preBalances: native(pre),
      postBalances: native(post),
      preTokenBalances: balances(pre),
      postTokenBalances: balances(post),
      innerInstructions: [{ index: 0, instructions: inner }],
    },
  };
  const after = r.next;
  after.slot = s.slot + 1;
  const seconds = Math.floor(Date.parse(s.observedAt) / 1000) + 1;
  after.observedAt = new Date(seconds * 1000).toISOString();
  const clock = 'SysvarC1ock11111111111111111111111111111111',
    raw = Buffer.from(after.accounts[clock]!.base64, 'base64');
  raw.writeBigUInt64LE(BigInt(after.slot), 0);
  raw.writeBigInt64LE(BigInt(seconds), 32);
  after.accounts[clock] = { ...after.accounts[clock]!, base64: raw.toString('base64') };
  return {
    schema: 'LINKED_RETAINED_RPC_INTERVAL_V1',
    commitment: 'finalized',
    acquiredAt: after.observedAt,
    before: structuredClone(s),
    after,
    anchor: { blockhash: 'CONTROLLED-before-' + s.slot },
    slots: [after.slot],
    blocks: [
      {
        slot: after.slot,
        result: {
          parentSlot: s.slot,
          previousBlockhash: 'CONTROLLED-before-' + s.slot,
          blockhash: 'CONTROLLED-after-' + after.slot,
          blockTime: seconds,
          transactions: [receipt],
        },
      },
    ],
  };
}

/** CONTROLLED native-SOL curve made by redenominating retained curve reserves. */
export function controlledSolCurveBank() {
  const s = mixedBank(),
    r = Buffer.from(s.accounts[CURVE]!.base64, 'base64');
  new PublicKey(WRAPPED_SOL_MINT).toBuffer().copy(r, 83);
  const rentBytes = Buffer.from(
      s.accounts['SysvarRent111111111111111111111111111111111']!.base64,
      'base64',
    ),
    rent =
      BigInt(r.length + 128) * rentBytes.readBigUInt64LE(0) * BigInt(rentBytes.readDoubleLE(8)),
    lamports = rent + r.readBigUInt64LE(32) + r.readBigUInt64LE(125) + r.readBigUInt64LE(133);
  s.accounts[CURVE] = {
    ...s.accounts[CURVE]!,
    base64: r.toString('base64'),
    lamports: lamports.toString(),
  } as (typeof s.accounts)[string];
  return s;
}

/** CONTROLLED receipt for a native-SOL curve group, including buyback SyncNative. */
export async function controlledNativeCurveInterval(
  s: Stage1Snapshot,
  ix: Instruction,
  keysInput: string[],
) {
  const keys = [...keysInput],
    a = ix.accounts.map((i) => keys[i]!),
    r = await transitionMultiHop(s, ix, keys),
    pre = new Map<string, { mint: string; amount: bigint }>(),
    postNative = new Map<string, bigint>(),
    preNative = new Map<string, bigint>(),
    inner: Instruction[] = [];
  const inputMint = WRAPPED_SOL_MINT,
    outMint = CURVE_MINT,
    rentRaw = Buffer.from(
      s.accounts['SysvarRent111111111111111111111111111111111']!.base64,
      'base64',
    ),
    rent = BigInt(165 + 128) * rentRaw.readBigUInt64LE(0) * BigInt(rentRaw.readDoubleLE(8));
  const token = (address: string, mint?: string) => {
    if (pre.has(address)) return;
    const x = s.accounts[address],
      b = Buffer.from(x?.base64 ?? '', 'base64');
    if (x && [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(x.owner) && b.length >= 165)
      pre.set(address, {
        mint: new PublicKey(b.subarray(0, 32)).toBase58(),
        amount: b.readBigUInt64LE(64),
      });
    else pre.set(address, { mint: mint!, amount: 0n });
  };
  token(a[1]!, inputMint);
  token(a[2]!, outMint);
  token(a[6]!, WRAPPED_SOL_MINT);
  for (const t of r.transfers) {
    if (!keys.includes(t.from)) keys.push(t.from);
    if (!keys.includes(t.to)) keys.push(t.to);
    if (!t.kind) {
      token(t.from);
      token(t.to, t.to === a[2] ? outMint : undefined);
    }
  }
  const post = structuredClone(pre);
  for (const k of keys) {
    const n = (s.accounts[k] as { lamports?: string } | undefined)?.lamports;
    preNative.set(
      k,
      n
        ? BigInt(n)
        : k === a[0]
          ? 1000000000000n
          : pre.get(k)?.mint === WRAPPED_SOL_MINT
            ? pre.get(k)!.amount + rent
            : 0n,
    );
    postNative.set(k, preNative.get(k)!);
  }
  for (const call of r.curveCalls) {
    for (const k of call.accounts)
      if (!keys.includes(k)) {
        keys.push(k);
        preNative.set(k, 0n);
        postNative.set(k, 0n);
      }
    const d = Buffer.alloc(20 + call.fees.length);
    createHash('sha256').update('global:multi_hop_curve_swap').digest().copy(d, 0, 0, 8);
    d.writeBigUInt64LE(call.input, 8);
    d.writeUInt32LE(call.fees.length, 16);
    Buffer.from(call.fees).copy(d, 20);
    inner.push({
      programIdIndex: keys.indexOf(PUMP_PROGRAM_ID),
      accounts: call.accounts.map((k) => keys.indexOf(k)),
      data: bs58.encode(d),
      stackHeight: 2,
    });
  }
  for (const t of r.transfers) {
    if (t.kind) {
      postNative.set(t.from, postNative.get(t.from)! - t.amount);
      postNative.set(t.to, postNative.get(t.to)! + t.amount);
      if (t.kind === 'NATIVE_SYSTEM') {
        const d = Buffer.alloc(12);
        d.writeUInt32LE(2);
        d.writeBigUInt64LE(t.amount, 4);
        inner.push({
          programIdIndex: keys.indexOf('11111111111111111111111111111111'),
          accounts: [keys.indexOf(t.from), keys.indexOf(t.to)],
          data: bs58.encode(d),
          stackHeight: 3,
        });
      } else if (pre.get(t.to)?.mint === WRAPPED_SOL_MINT) {
        post.get(t.to)!.amount += t.amount;
        inner.push({
          programIdIndex: keys.indexOf(SPL_TOKEN_PROGRAM_ID),
          accounts: [keys.indexOf(t.to)],
          data: bs58.encode(Buffer.from([17])),
          stackHeight: 3,
        });
      }
    } else {
      post.get(t.from)!.amount -= t.amount;
      post.get(t.to)!.amount += t.amount;
      const d = Buffer.alloc(9);
      d[0] = 3;
      d.writeBigUInt64LE(t.amount, 1);
      inner.push({
        programIdIndex: keys.indexOf(s.accounts[pre.get(t.from)!.mint]!.owner),
        accounts: [keys.indexOf(t.from), keys.indexOf(t.to)],
        data: bs58.encode(d),
        stackHeight: 3,
      });
    }
  }
  const balances = (v: typeof pre) =>
      [...v].map(([k, b]) => ({
        accountIndex: keys.indexOf(k),
        mint: b.mint,
        uiTokenAmount: { amount: b.amount.toString() },
      })),
    receipt: Receipt = {
      version: 0,
      transaction: {
        signatures: ['CONTROLLED-NATIVE-GROUP'],
        message: { accountKeys: keys, instructions: [ix] },
      },
      meta: {
        err: null,
        fee: 0,
        preBalances: keys.map((k) => Number(preNative.get(k))),
        postBalances: keys.map((k) => Number(postNative.get(k))),
        preTokenBalances: balances(pre),
        postTokenBalances: balances(post),
        innerInstructions: [{ index: 0, instructions: inner }],
      },
    };
  const after = structuredClone(r.next),
    clock = 'SysvarC1ock11111111111111111111111111111111',
    b = Buffer.from(after.accounts[clock]!.base64, 'base64');
  after.slot++;
  const time = b.readBigInt64LE(32) + 1n;
  b.writeBigUInt64LE(BigInt(after.slot), 0);
  b.writeBigInt64LE(time, 32);
  after.accounts[clock] = { ...after.accounts[clock]!, base64: b.toString('base64') };
  after.observedAt = new Date(Number(time) * 1000).toISOString();
  return {
    schema: 'LINKED_RETAINED_RPC_INTERVAL_V1',
    commitment: 'finalized',
    acquiredAt: after.observedAt,
    before: structuredClone(s),
    after,
    slots: [after.slot],
    anchor: { blockhash: 'controlled-group-before' },
    blocks: [
      {
        slot: after.slot,
        result: {
          parentSlot: s.slot,
          previousBlockhash: 'controlled-group-before',
          blockhash: 'controlled-group-after',
          blockTime: Number(time),
          transactions: [receipt],
        },
      },
    ],
  } as ProviderInterval;
}
