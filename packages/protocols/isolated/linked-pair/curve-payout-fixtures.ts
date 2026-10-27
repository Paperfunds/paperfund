/** Controlled curve fee-payout chronology. The initial account bytes are retained evidence, not the generated transactions. */
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import {
  PUMP_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '../../src/pump-fun.js';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import { CURVE, CURVE_MINT } from './mixed-fixtures.js';
import {
  validatePumpCurve,
  transitionExternalCurve,
  type CurveExternalSpec,
  type CurveNativeAccount,
} from './pump-curve.js';
import type { ProviderInterval, Instruction, Receipt } from './external-flow.js';
export async function curvePayoutSpec(
  s: Stage1Snapshot,
  buy: boolean,
  amount: bigint,
  exactOutput = buy,
): Promise<CurveExternalSpec> {
  const raw = Buffer.from(s.accounts[CURVE]!.base64, 'base64'),
    quote = new PublicKey(raw.subarray(83, 115)).toBase58(),
    v = await validatePumpCurve(s, CURVE, CURVE_MINT, quote),
    g = Buffer.from(s.accounts['4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf']!.base64, 'base64'),
    protocolWallet = new PublicKey(g.subarray(41, 73)).toBase58(),
    buybackWallet = new PublicKey(g.subarray(741, 773)).toBase58(),
    creatorVault = PublicKey.findProgramAddressSync(
      [Buffer.from('creator-vault'), new PublicKey(v.curve.creator).toBuffer()],
      new PublicKey(PUMP_PROGRAM_ID),
    )[0].toBase58(),
    sharingConfig = PublicKey.findProgramAddressSync(
      [Buffer.from('sharing-config'), new PublicKey(CURVE_MINT).toBuffer()],
      new PublicKey(PUMP_FEE_PROGRAM_ID),
    )[0].toBase58(),
    destination = (owner: string) =>
      v.native
        ? owner
        : getAssociatedTokenAddressSync(
            new PublicKey(quote),
            new PublicKey(owner),
            true,
            new PublicKey(s.accounts[quote]!.owner),
          ).toBase58();
  return {
    pool: CURVE,
    baseMint: CURVE_MINT,
    quoteMint: quote,
    legacy: true,
    buy,
    exactOutput,
    amount,
    bound: exactOutput ? (1n << 64n) - 1n : 1n,
    userBase: 'controlled-v2-base',
    userQuote: 'controlled-v2-quote',
    nativeUser: 'controlled-v2-user',
    protocolRecipient: destination(protocolWallet),
    creatorRecipient: destination(creatorVault),
    buybackRecipient: destination(buybackWallet),
    baseVault: v.baseVault,
    quoteVault: v.quoteVault,
    payouts: { protocolWallet, buybackWallet, creatorVault, sharingConfig },
  };
}
export async function controlledCurvePayoutInterval(
  s: Stage1Snapshot,
  spec: CurveExternalSpec,
  previousReceipt?: Receipt,
): Promise<ProviderInterval> {
  const r = await transitionExternalCurve(s, spec, {
      nowMs: Date.parse(s.observedAt),
      maxAgeMs: 10000,
    }),
    v = await validatePumpCurve(s, spec.pool, spec.baseMint, spec.quoteMint),
    a = spec.payouts!,
    native = v.native,
    keys = [
      PUMP_PROGRAM_ID,
      SPL_TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
      '11111111111111111111111111111111',
    ];
  const accounts = [
    '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf',
    spec.baseMint,
    spec.quoteMint,
    s.accounts[spec.baseMint]!.owner,
    s.accounts[spec.quoteMint]!.owner,
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    a.protocolWallet,
    native ? 'unused-protocol-ata' : spec.protocolRecipient,
    a.buybackWallet,
    native ? 'unused-buyback-ata' : spec.buybackRecipient,
    spec.pool,
    v.baseVault,
    v.quoteVault,
    spec.nativeUser!,
    spec.userBase,
    spec.userQuote,
    a.creatorVault,
    native ? 'unused-creator-ata' : spec.creatorRecipient,
    a.sharingConfig,
    ...(spec.buy ? ['volume'] : []),
    'user-volume',
    'user-volume-ata',
    '8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt',
    PUMP_FEE_PROGRAM_ID,
    '11111111111111111111111111111111',
    'event',
    PUMP_PROGRAM_ID,
  ];
  for (const k of [...accounts, ...r.transfers.flatMap((t) => [t.from, t.to])])
    if (!keys.includes(k)) keys.push(k);
  const raw = Buffer.alloc(spec.buy?25:24);
  createHash('sha256')
    .update(
      'global:' + (spec.buy ? (spec.exactOutput ? 'buy_v2' : 'buy_exact_quote_in_v2') : 'sell_v2'),
    )
    .digest()
    .copy(raw, 0, 0, 8);
  raw.writeBigUInt64LE(spec.amount, 8);
  raw.writeBigUInt64LE(spec.bound, 16);
  const ix: Instruction = {
      programIdIndex: 0,
      accounts: accounts.map((k) => keys.indexOf(k)),
      data: bs58.encode(raw),
    },
    preTokens = new Map<string, { mint: string; amount: bigint }>(),
    preNative = keys.map((k) =>
      k === spec.nativeUser
        ? 1000000000000
        : k === spec.pool && native
          ? Number((s.accounts[k] as CurveNativeAccount).lamports)
          : 0,
    ),
    postNative = [...preNative],
    inner: Instruction[] = [];
  for (const t of r.transfers)
    if (!t.kind)
      for (const k of [t.from, t.to])
        if (!preTokens.has(k)) {
          const x = s.accounts[k],
            b = Buffer.from(x?.base64 ?? '', 'base64');
          preTokens.set(
            k,
            x && [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(x.owner) && b.length >= 165
              ? { mint: new PublicKey(b.subarray(0, 32)).toBase58(), amount: b.readBigUInt64LE(64) }
              : {
                  mint: k === spec.userBase ? spec.baseMint : spec.quoteMint,
                  amount:
                    k === spec.userBase
                      ? spec.buy
                        ? 0n
                        : spec.amount
                      : k === spec.userQuote
                        ? 1000000000000n
                        : 0n,
                },
          );
        }
  const postTokens = structuredClone(preTokens);
  for (const t of r.transfers) {
    if (t.kind) {
      postNative[keys.indexOf(t.from)]! -= Number(t.amount);
      postNative[keys.indexOf(t.to)]! += Number(t.amount);
      if (t.kind === 'NATIVE_SYSTEM') {
        const d = Buffer.alloc(12);
        d.writeUInt32LE(2);
        d.writeBigUInt64LE(t.amount, 4);
        inner.push({
          programIdIndex: 3,
          accounts: [keys.indexOf(t.from), keys.indexOf(t.to)],
          data: bs58.encode(d),
          stackHeight: 2,
        });
      }
    } else {
      postTokens.get(t.from)!.amount -= t.amount;
      postTokens.get(t.to)!.amount += t.amount;
      const d = Buffer.alloc(9);
      d[0] = 3;
      d.writeBigUInt64LE(t.amount, 1);
      inner.push({
        programIdIndex: keys.indexOf(s.accounts[preTokens.get(t.from)!.mint]!.owner),
        accounts: [keys.indexOf(t.from), keys.indexOf(t.to)],
        data: bs58.encode(d),
        stackHeight: 2,
      });
    }
  }
  const balance = (m: typeof preTokens) =>
      [...m].map(([k, v]) => ({
        accountIndex: keys.indexOf(k),
        mint: v.mint,
        uiTokenAmount: { amount: v.amount.toString() },
      })),
    receipt: Receipt = {
      version: 0,
      transaction: {
        signatures: ['CONTROLLED-V2-' + s.slot + '-' + spec.buy],
        message: { accountKeys: keys, instructions: [ix] },
      },
      meta: {
        err: null,
        fee: 0,
        preBalances: preNative,
        postBalances: postNative,
        preTokenBalances: balance(preTokens),
        postTokenBalances: balance(postTokens),
        innerInstructions: [{ index: 0, instructions: inner }],
      },
    };
  if (previousReceipt) {
    const oldKeys = [
      ...previousReceipt.transaction.message.accountKeys,
      ...(previousReceipt.meta.loadedAddresses?.writable ?? []),
      ...(previousReceipt.meta.loadedAddresses?.readonly ?? []),
    ];
    for (const entry of receipt.meta.preTokenBalances) {
      const address = keys[entry.accountIndex]!;
      if (s.accounts[address]) continue;
      const old = previousReceipt.meta.postTokenBalances.find(
          (b) => oldKeys[b.accountIndex] === address && b.mint === entry.mint,
        ),
        post = receipt.meta.postTokenBalances.find((b) => b.accountIndex === entry.accountIndex);
      if (old && post) {
        const delta = BigInt(post.uiTokenAmount.amount) - BigInt(entry.uiTokenAmount.amount);
        entry.uiTokenAmount.amount = old.uiTokenAmount.amount;
        post.uiTokenAmount.amount = (BigInt(old.uiTokenAmount.amount) + delta).toString();
      }
    }
    for (const [i, address] of keys.entries()) {
      if (s.accounts[address]) continue;
      const j = oldKeys.indexOf(address),
        n = j >= 0 ? previousReceipt.meta.postBalances?.[j] : undefined;
      if (n !== undefined) {
        const delta = receipt.meta.postBalances![i]! - receipt.meta.preBalances![i]!;
        receipt.meta.preBalances![i] = n;
        receipt.meta.postBalances![i] = n + delta;
      }
    }
  }
  const after = r.next,
    clock = 'SysvarC1ock11111111111111111111111111111111',
    c = Buffer.from(after.accounts[clock]!.base64, 'base64'),
    time = c.readBigInt64LE(32) + 1n;
  after.slot++;
  c.writeBigUInt64LE(BigInt(after.slot), 0);
  c.writeBigInt64LE(time, 32);
  after.accounts[clock] = { ...after.accounts[clock]!, base64: c.toString('base64') };
  after.observedAt = new Date(Number(time) * 1000).toISOString();
  return {
    schema: 'LINKED_RETAINED_RPC_INTERVAL_V1',
    commitment: 'finalized',
    before: structuredClone(s),
    after,
    acquiredAt: after.observedAt,
    slots: [after.slot],
    anchor: { blockhash: 'CONTROLLED-V2-before' },
    blocks: [
      {
        slot: after.slot,
        result: {
          parentSlot: s.slot,
          previousBlockhash: 'CONTROLLED-V2-before',
          blockhash: 'CONTROLLED-V2-after',
          blockTime: Number(time),
          transactions: [receipt],
        },
      },
    ],
  };
}
