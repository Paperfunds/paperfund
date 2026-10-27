import { PublicKey } from '@solana/web3.js';
import { WRAPPED_SOL_MINT } from '../../src/pump-fun.js';
import type { CurveTransfer } from './pump-curve.js';
import { transitionExternalCurve, validatePumpCurve } from './pump-curve.js';
import { PUMP_PROGRAM_ID, pumpGlobalAddress, pumpFeeConfigAddress } from '../../src/pump-fun.js';
import { SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '../../src/pump-fun.js';
/** Native pool/curve multi-hop replay. Dependency accounts must already be retained. */
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import {
  decodePumpSwapPool,
  PUMP_AMM_PROGRAM_ID,
  pumpSwapGlobalConfigAddress,
  pumpSwapFeeConfigAddress,
} from '../../src/pump-swap.js';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import { transitionExternalPump } from './pump-external.js';
import type { Instruction } from './external-flow.js';
const disc = createHash('sha256').update('global:multi_hop_swap').digest().subarray(0, 8);
export const isMultiHop = (ix: Instruction, keys: string[]) =>
  keys[ix.programIdIndex] === PUMP_AMM_PROGRAM_ID &&
  Buffer.from(bs58.decode(ix.data)).subarray(0, 8).equals(disc);
export function multiHopDependencies(ix: Instruction, keys: string[]) {
  if (!isMultiHop(ix, keys)) return [];
  const a = ix.accounts.map((i) => keys[i]!);
  if (a.length < 21 || (a.length - 16) % 5 !== 0) throw Error('MULTI_HOP_ACCOUNT_LAYOUT');
  return Array.from({ length: (a.length - 16) / 5 }, (_, i) => ({
    base: a[16 + 5 * i]!,
    quote: a[17 + 5 * i]!,
    pool: a[18 + 5 * i]!,
    baseVault: a[19 + 5 * i]!,
    quoteVault: a[20 + 5 * i]!,
  }));
}
export async function transitionMultiHop(
  snapshot: Stage1Snapshot,
  ix: Instruction,
  keys: string[],
  tokenMints?: ReadonlyMap<string, string>,
) {
  const a = ix.accounts.map((i) => keys[i]!),
    raw = Buffer.from(bs58.decode(ix.data)),
    hops = multiHopDependencies(ix, keys);
  if (raw.length !== 24 || hops.length < 1 || new Set(hops.map((h) => h.pool)).size !== hops.length)
    throw Error('MULTI_HOP_UNSUPPORTED_LAYOUT');
  if (
    a[3] !== (await pumpSwapGlobalConfigAddress()) ||
    a[4] !== (await pumpSwapFeeConfigAddress()) ||
    a[7] !== SPL_TOKEN_PROGRAM_ID ||
    a[8] !== TOKEN_2022_PROGRAM_ID ||
    a[9] !== '11111111111111111111111111111111' ||
    a[11] !== PUMP_AMM_PROGRAM_ID
  )
    throw Error('MULTI_HOP_PROGRAM_BINDING');
  const buy =
    hops.length === 1
      ? tokenMints?.get(a[1]!) === hops[0]!.quote
      : hops[0]!.base === hops[1]!.quote;
  if (hops.length === 1 && !tokenMints) throw Error('MULTI_HOP_DIRECTION_EVIDENCE_MISSING');
  if (
    tokenMints &&
    (tokenMints.get(a[1]!) !== (buy ? hops[0]!.quote : hops[0]!.base) ||
      tokenMints.get(a[2]!) !== (buy ? hops.at(-1)!.base : hops.at(-1)!.quote))
  )
    throw Error('MULTI_HOP_USER_MINT_BINDING');
  if (tokenMints && tokenMints.get(a[6]!) !== (buy ? hops[0]!.quote : hops.at(-1)!.quote))
    throw Error('MULTI_HOP_FEE_MINT_BINDING');
  for (let i = 0; i < hops.length; i++) {
    const h = hops[i]!,
      account = snapshot.accounts[h.pool];
    if (!account) throw Error('MULTI_HOP_DEPENDENCY_MISSING:' + h.pool);
    const p =
      account.owner === PUMP_AMM_PROGRAM_ID
        ? decodePumpSwapPool(Buffer.from(account.base64, 'base64'))
        : account.owner === PUMP_PROGRAM_ID
          ? {
              baseMint: h.base,
              quoteMint: h.quote,
              ...(await validatePumpCurve(snapshot, h.pool, h.base, h.quote)),
            }
          : (() => {
              throw Error('MULTI_HOP_VENUE_UNSUPPORTED:' + h.pool);
            })();
    if (
      account.owner === PUMP_PROGRAM_ID &&
      (a[12] !== PUMP_PROGRAM_ID ||
        a[13] !== (await pumpGlobalAddress()) ||
        a[14] !== (await pumpFeeConfigAddress()))
    )
      throw Error('MULTI_HOP_CURVE_PROGRAM_BINDING');
    if (
      p.baseMint !== h.base ||
      p.quoteMint !== h.quote ||
      p.baseVault !== h.baseVault ||
      p.quoteVault !== h.quoteVault
    )
      throw Error('MULTI_HOP_BINDING');
    if (i > 0 && (buy ? hops[i - 1]!.base !== h.quote : hops[i - 1]!.quote !== h.base))
      throw Error('MULTI_HOP_DISCONTINUOUS');
  }
  let next = structuredClone(snapshot),
    input = raw.readBigUInt64LE(8);
  const minimum = raw.readBigUInt64LE(16);
  if (input === 0n || minimum === 0n) throw Error('MULTI_HOP_ZERO_AMOUNT');
  const transfers: CurveTransfer[] = [],
    steps = [];
  for (let i = 0; i < hops.length; i++) {
    const h = hops[i]!,
      currency = buy ? i === 0 : i === hops.length - 1,
      token = buy ? i === hops.length - 1 : i === 0,
      source = i === 0 ? a[1]! : buy ? hops[i - 1]!.baseVault : hops[i - 1]!.quoteVault,
      destination =
        i === hops.length - 1 ? a[2]! : buy ? hops[i + 1]!.quoteVault : hops[i + 1]!.baseVault,
      q = await (
        next.accounts[h.pool]!.owner === PUMP_PROGRAM_ID
          ? transitionExternalCurve
          : transitionExternalPump
      )(
        next,
        {
          pool: h.pool,
          baseMint: h.base,
          quoteMint: h.quote,
          nativeUser: a[0]!,
          baseVault: h.baseVault,
          quoteVault: h.quoteVault,
          legacy: false,
          completionMode: 'MULTI_HOP' as const,
          exactOutput: false,
          buy,
          amount: input,
          bound: 0n,
          userBase: buy ? destination : source,
          userQuote: buy ? source : destination,
          protocolRecipient: '',
          creatorRecipient: '',
          buybackRecipient: a[6]!,
          feeRole:
            currency && token
              ? 'BOTH'
              : currency
                ? 'CURRENCY_END'
                : token
                  ? 'TOKEN_END'
                  : 'INTERMEDIATE',
        },
        { nowMs: Date.parse(next.observedAt), maxAgeMs: 10000 },
      );
    const native = next.accounts[h.pool]!.owner === PUMP_PROGRAM_ID && h.quote === WRAPPED_SOL_MINT;
    if (native && !currency) throw Error('MULTI_HOP_NATIVE_CURVE_DIRECTION');
    transfers.push(
      native && buy
        ? { from: a[0]!, to: h.pool, amount: input, kind: 'NATIVE_SYSTEM' }
        : { from: source, to: buy ? h.quoteVault : h.baseVault, amount: input },
    );
    if (q.quote.fees.buyback > 0n)
      transfers.push({
        from: native ? h.pool : h.quoteVault,
        to: a[6]!,
        amount: q.quote.fees.buyback,
        ...(native ? { kind: 'NATIVE_DIRECT' as const } : {}),
      });
    steps.push({ pool: h.pool, input, output: q.output, fees: q.quote.fees, post: q.quote.post });
    next = q.next;
    input = q.output;
  }
  const last = hops.at(-1)!;
  const nativeLast =
    !buy &&
    snapshot.accounts[last.pool]!.owner === PUMP_PROGRAM_ID &&
    last.quote === WRAPPED_SOL_MINT;
  transfers.push(
    nativeLast
      ? { from: last.pool, to: a[0]!, amount: input, kind: 'NATIVE_DIRECT' }
      : { from: buy ? last.baseVault : last.quoteVault, to: a[2]!, amount: input },
  );
  const curveCalls: { accounts: string[]; input: bigint; fees: number[] }[] = [];
  for (let i = 0; i < hops.length; i++) {
    if (snapshot.accounts[hops[i]!.pool]!.owner !== PUMP_PROGRAM_ID) continue;
    const start = i;
    while (i + 1 < hops.length && snapshot.accounts[hops[i + 1]!.pool]!.owner === PUMP_PROGRAM_ID)
      i++;
    const fees = hops.slice(start, i + 1).map((_, n) => {
      const pos = start + n;
      return (buy ? pos === 0 : pos === hops.length - 1)
        ? 1 | (hops.length === 1 ? 2 : 0)
        : (buy ? pos === hops.length - 1 : pos === 0)
          ? 2
          : 0;
    });
    const source =
        start === 0 ? a[1]! : buy ? hops[start - 1]!.baseVault : hops[start - 1]!.quoteVault,
      dest = i === hops.length - 1 ? a[2]! : buy ? hops[i + 1]!.quoteVault : hops[i + 1]!.baseVault;
    const event = PublicKey.findProgramAddressSync(
      [Buffer.from('__event_authority')],
      new PublicKey(PUMP_PROGRAM_ID),
    )[0].toBase58();
    const accounts = [
      a[13]!,
      a[14]!,
      a[3]!,
      a[0]!,
      start === 0 ? a[0]! : hops[start - 1]!.pool,
      source,
      dest,
      a[6]!,
      a[7]!,
      a[8]!,
      a[9]!,
      event,
      PUMP_PROGRAM_ID,
      ...hops
        .slice(start, i + 1)
        .flatMap((h) => [h.base, h.quote, h.pool, h.baseVault, h.quoteVault]),
    ];
    curveCalls.push({ accounts, input: steps[start]!.input, fees });
  }
  if (input < minimum) throw Error('EXTERNAL_SIGNED_MINIMUM_VIOLATED');
  return {
    next,
    output: input,
    transfers: transfers.filter((t) => t.amount > 0n),
    steps,
    curveCalls,
  };
}
