import { PublicKey } from '@solana/web3.js';
import { PUMP_AMM_PROGRAM_ID } from '../../src/pump-swap.js';
import { createHash } from 'node:crypto';
/** External actor inventory only. Never changes Paperfund balances or provides paper liquidity. */
import type { Receipt, Instruction } from './external-flow.js';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import {
  WRAPPED_SOL_MINT,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '../../src/pump-fun.js';
const N = 'lamports:',
  SYSTEM = '11111111111111111111111111111111';

function integer(n: unknown): bigint {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0)
    throw Error('NATIVE_BALANCE_EVIDENCE_UNSAFE');
  return BigInt(n);
}
export class WrappedSolFlow {
  readonly mints = new Map<string, string>();
  private readonly balances = new Map<string, bigint>();
  private readonly reserves = new Map<string, bigint>();
  private readonly touched = new Set<string>();
  private readonly initialTracked = new Set<string>();
  private readonly nativePre: readonly number[] | undefined;
  private readonly nativePost: readonly number[] | undefined;
  private readonly fee: number | undefined;
  private readonly rent: bigint | null;
  constructor(
    private readonly receipt: Receipt,
    private readonly keys: string[],
    private readonly deltas: Record<string, string>,
    private readonly protectedAccounts: Set<string>,
    s: Stage1Snapshot,
    private readonly persistedReserves: Record<string, string> = {},
  ) {
    for (const [a, value] of Object.entries(persistedReserves)) {
      const n = BigInt(value);
      if (n < 0n || n > (1n << 64n) - 1n) throw Error('NATIVE_RESERVE_CORRUPT');
      this.reserves.set(a, n);
    }
    const meta = receipt.meta as Receipt['meta'] & {
      preBalances?: number[];
      postBalances?: number[];
      fee?: number;
    };
    this.nativePre = meta.preBalances;
    this.nativePost = meta.postBalances;
    this.fee = meta.fee;
    for (const b of [...meta.preTokenBalances, ...meta.postTokenBalances])
      if (!this.mints.has(keys[b.accountIndex]!)) this.mints.set(keys[b.accountIndex]!, b.mint);
    for (const [address, a] of Object.entries(s.accounts)) {
      const raw = Buffer.from(a.base64, 'base64');
      if (a.owner === SPL_TOKEN_PROGRAM_ID && raw.length === 165 && raw.readUInt32LE(109) === 1) {
        this.mints.set(address, WRAPPED_SOL_MINT);
        this.reserve(address, raw.readBigUInt64LE(113));
      }
    }
    let rent: bigint | null = null;
    const rentAccount = s.accounts['SysvarRent111111111111111111111111111111111'];
    if (rentAccount) {
      const r = Buffer.from(rentAccount.base64, 'base64');
      if (
        rentAccount.owner !== 'Sysvar1111111111111111111111111111111111111' ||
        r.length !== 17 ||
        ![1, 2].includes(r.readDoubleLE(8))
      )
        throw Error('NATIVE_RENT_STATE_UNSUPPORTED');
      rent = BigInt(165 + 128) * r.readBigUInt64LE(0) * BigInt(r.readDoubleLE(8));
    }
    this.rent = rent;
    for (const b of meta.preTokenBalances) {
      const address = keys[b.accountIndex]!;
      if (b.mint === WRAPPED_SOL_MINT) {
        if (this.nativePre) {
          const reserve = integer(this.nativePre[b.accountIndex]) - BigInt(b.uiTokenAmount.amount);
          if (reserve < 0n) throw Error('NATIVE_TOKEN_BALANCE_MISMATCH');
          if (!this.reserves.has(address)) this.reserve(address, reserve);
        }
        if (
          !protectedAccounts.has(address) &&
          deltas[N + address] === undefined &&
          BigInt(deltas[address] ?? '0') !== 0n
        )
          deltas[N + address] = deltas[address]!;
      }
    }
    for (const key of keys) if (BigInt(deltas[N + key] ?? '0') !== 0n) this.initialTracked.add(key);
  }
  static tracked(keys: string[], deltas: Record<string, string>) {
    return keys.some((k) => BigInt(deltas[N + k] ?? '0') !== 0n);
  }
  private reserve(a: string, n: bigint) {
    this.reserves.set(a, n);
    this.persistedReserves[a] = n.toString();
  }
  private delta(a: string) {
    return this.protectedAccounts.has(a) ? 0n : BigInt(this.deltas[N + a] ?? '0');
  }
  private balance(a: string) {
    if (!this.balances.has(a)) {
      const i = this.keys.indexOf(a);
      if (i < 0 || !this.nativePre || !this.nativePost)
        throw Error('NATIVE_BALANCE_EVIDENCE_MISSING');
      let n = integer(this.nativePre[i]);
      if (i === 0) n -= integer(this.fee);
      if (n < 0n) throw Error('NATIVE_FEE_EVIDENCE');
      this.balances.set(a, n);
    }
    return this.balances.get(a)!;
  }
  private transfer(from: string, to: string, amount: bigint, shadow: bigint) {
    const n = this.balance(from);
    if (
      amount < 0n ||
      shadow < 0n ||
      n < amount ||
      (!this.protectedAccounts.has(from) && n + this.delta(from) < shadow)
    )
      throw Error('MODELED_NATIVE_INVENTORY_EXHAUSTED');
    this.balances.set(from, n - amount);
    this.balances.set(to, this.balance(to) + amount);
    if (!this.protectedAccounts.has(from))
      this.deltas[N + from] = (this.delta(from) + amount - shadow).toString();
    if (!this.protectedAccounts.has(to))
      this.deltas[N + to] = (this.delta(to) + shadow - amount).toString();
    this.touched.add(from);
    this.touched.add(to);
  }
  private readonly curveTouched = new Set<string>();
  curveTransfer(from: string, to: string, amount: bigint, shadow: bigint) {
    this.transfer(from, to, amount, shadow);
    this.curveTouched.add(from);
    this.curveTouched.add(to);
  }
  assertCurveBalance(address: string, expected: string) {
    if (this.balance(address) !== BigInt(expected)) throw Error('CURVE_NATIVE_CHECKPOINT_MISMATCH');
    this.curveTouched.add(address);
  }
  tokenTransfer(from: string, to: string, amount: bigint, shadow: bigint) {
    if (this.mints.get(from) !== WRAPPED_SOL_MINT && this.mints.get(to) !== WRAPPED_SOL_MINT)
      return;
    this.mints.set(from, WRAPPED_SOL_MINT);
    this.mints.set(to, WRAPPED_SOL_MINT);
    this.transfer(from, to, amount, shadow);
  }
  /** Returns true when handled; callers retain their fail-closed handling for other mutations. */
  instruction(
    ix: Instruction,
    raw: Buffer,
    _depth: number,
    _ancestors: string[],
    actualTokens: Map<string, bigint>,
  ) {
    const program = this.keys[ix.programIdIndex],
      a = ix.accounts.map((i) => this.keys[i]!);
    if (
      program === PUMP_AMM_PROGRAM_ID &&
      raw
        .subarray(0, 8)
        .equals(
          createHash('sha256')
            .update('global:close_user_volume_accumulator')
            .digest()
            .subarray(0, 8),
        )
    ) {
      const expected = PublicKey.findProgramAddressSync(
        [Buffer.from('user_volume_accumulator'), new PublicKey(a[0]!).toBuffer()],
        new PublicKey(PUMP_AMM_PROGRAM_ID),
      )[0].toBase58();
      if (a[1] !== expected) throw Error('NATIVE_VOLUME_PDA_MISMATCH');
      const refund = this.balance(a[1]!);
      this.transfer(a[1]!, a[0]!, refund, refund + this.delta(a[1]!));
      delete this.deltas[N + a[1]!];
      return true;
    }
    if (program === SYSTEM) {
      if (raw.length < 4) throw Error('NATIVE_SYSTEM_LAYOUT');
      const tag = raw.readUInt32LE(0);
      let amount: bigint | undefined;
      if (tag === 2 || tag === 0) {
        if (raw.length < 12) throw Error('NATIVE_SYSTEM_LAYOUT');
        amount = raw.readBigUInt64LE(4);
      } else if (tag === 3) {
        if (raw.length < 44) throw Error('NATIVE_SYSTEM_LAYOUT');
        const length = raw.readBigUInt64LE(36);
        if (length > 32n || raw.length < 52 + Number(length)) throw Error('NATIVE_SYSTEM_LAYOUT');
        amount = raw.readBigUInt64LE(44 + Number(length));
      }
      if (amount !== undefined) {
        // As with retained external swap inputs, funding replays the exact serialized CPI
        // amount. Different modeled proceeds remain inventory; unavailable inputs reject.
        this.transfer(a[0]!, a[1]!, amount, amount);
        return true;
      }
      if (a.some((x) => this.delta(x) !== 0n))
        throw Error('TRACKED_NATIVE_SYSTEM_MUTATION_UNSUPPORTED');
      return false;
    }
    if (![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(program ?? '')) return false;
    if ([1, 16, 18].includes(raw[0]!)) {
      const mint = a[1]!;
      this.mints.set(a[0]!, mint);
      if (mint === WRAPPED_SOL_MINT) {
        const balance = this.balance(a[0]!);
        const provenReserve =
          this.rent ?? ([...this.reserves.values()].includes(balance) ? balance : null);
        if (program !== SPL_TOKEN_PROGRAM_ID || provenReserve === null)
          throw Error('NATIVE_RENT_EVIDENCE_MISSING');
        if (balance < provenReserve) throw Error('NATIVE_RENT_BALANCE');
        this.reserves.set(a[0]!, provenReserve);
        actualTokens.set(a[0]!, balance - provenReserve);
        this.deltas[a[0]!] = this.delta(a[0]!).toString();
      }
      return true;
    }
    if (raw[0] === 17) {
      // This model supports the legacy native mint, not Token-2022's distinct native mint.
      if (program !== SPL_TOKEN_PROGRAM_ID) throw Error('NATIVE_SYNC_PROGRAM_UNSUPPORTED');
      if (raw.length !== 1 || a.length !== 1) throw Error('NATIVE_SYNC_LAYOUT');
      if (this.mints.get(a[0]!) !== WRAPPED_SOL_MINT) throw Error('NATIVE_SYNC_MINT_UNKNOWN');
      const reserve = this.reserves.get(a[0]!);
      if (reserve === undefined) throw Error('NATIVE_RESERVE_EVIDENCE_MISSING');
      const amount = this.balance(a[0]!) - reserve;
      const previous = actualTokens.get(a[0]!);
      if (previous === undefined) throw Error('NATIVE_SYNC_TOKEN_EVIDENCE_MISSING');
      if (amount < previous || amount < 0n) throw Error('NATIVE_SYNC_BALANCE');
      actualTokens.set(a[0]!, amount);
      this.deltas[a[0]!] = this.delta(a[0]!).toString();
      return true;
    }
    if (raw[0] === 9) {
      const source = a[0]!,
        destination = a[1]!,
        wrapped = this.mints.get(source) === WRAPPED_SOL_MINT;
      if (!wrapped && BigInt(this.deltas[source] ?? '0') !== 0n)
        throw Error('MODELED_TOKEN_CLOSE_NOT_EMPTY');
      if (wrapped) {
        if (!this.nativePre || !this.nativePost) throw Error('NATIVE_BALANCE_EVIDENCE_MISSING');
        const refund = this.balance(source),
          shadow = refund + this.delta(source);
        if (BigInt(this.deltas[source] ?? '0') !== this.delta(source))
          throw Error('NATIVE_CLOSE_UNSYNCED_DIFFERENCE');
        this.transfer(source, destination, refund, shadow);
        delete this.deltas[N + source];
        delete this.deltas[source];
        delete this.persistedReserves[source];
        this.reserves.delete(source);
        actualTokens.delete(source);
        return true;
      }
      if (this.nativePre && this.nativePost) {
        const refund = this.balance(source);
        this.transfer(source, destination, refund, refund + this.delta(source));
        delete this.deltas[N + source];
        actualTokens.delete(source);
        return true;
      }
      return false;
    }
    return false;
  }
  verify(tokens?: Map<string, bigint>) {
    if (tokens)
      for (const b of this.receipt.meta.postTokenBalances) {
        const a = this.keys[b.accountIndex]!;
        if (
          this.mints.get(a) === WRAPPED_SOL_MINT &&
          tokens.has(a) &&
          tokens.get(a) !== BigInt(b.uiTokenAmount.amount)
        )
          throw Error('NATIVE_SYNC_TOKEN_EFFECTS_UNRECONCILED:' + a);
      }

    for (const address of new Set([
      ...this.initialTracked,
      ...this.touched,
      ...this.curveTouched,
    ])) {
      if (
        !this.curveTouched.has(address) &&
        !this.initialTracked.has(address) &&
        this.delta(address) === 0n
      )
        continue;
      const i = this.keys.indexOf(address);
      if (i < 0 || !this.nativePost || this.balance(address) !== integer(this.nativePost[i]))
        throw Error(
          'NATIVE_TRANSACTION_EFFECTS_UNRECONCILED:' +
            address +
            ':' +
            this.balance(address) +
            ':' +
            this.nativePost?.[i] +
            ':' +
            this.receipt.transaction.signatures[0],
        );
    }
  }
}
