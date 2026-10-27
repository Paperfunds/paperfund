/** Opt-in worker evidence capture. Does not alter ordinary quote or trade reads. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import {
  canonicalJson,
  createMarketStateEvidence,
  type MarketState,
  type MarketStateEvidence,
} from '@paperfund/execution';
export const CUTOFF_CLOCK = 'SysvarC1ock11111111111111111111111111111111';
export interface CutoffAccount {
  readonly owner: string;
  readonly data: readonly [string, string];
}
export interface CutoffBatch {
  readonly addresses: readonly string[];
  readonly result: {
    readonly context: { readonly slot: number };
    readonly value: readonly (CutoffAccount | null)[];
  };
}
const key = Symbol.for('paperfund.current-cutoff.capture.v1');
const registry = globalThis as unknown as Record<symbol, unknown>;
type CaptureBatches = CutoffBatch[] & { commitment?: 'confirmed' | 'finalized' };
const storage =
  (registry[key] as AsyncLocalStorage<CaptureBatches> | undefined) ??
  new AsyncLocalStorage<CaptureBatches>();
registry[key] = storage;
export const cutoffCaptureContext = () => storage.getStore();
export const cutoffHash = (v: unknown) =>
  createHash('sha256')
    .update(
      canonicalJson(
        JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))),
      ),
    )
    .digest('hex');
export async function captureCutoffState(
  load: () => Promise<MarketState>,
  commitment: 'confirmed' | 'finalized' = 'finalized',
) {
  const batches: CaptureBatches = [];
  batches.commitment = commitment;
  const state = await storage.run(batches, load);
  // The existing current-quote source already retains an atomic native account
  // batch via its FinalizedRpc connector, which does not use SolanaRpcClient.
  const native = state.normalizedState['stage1Snapshot'] as
    { slot: number; accounts: Record<string, { owner: string; base64: string }> } | undefined;
  if (!batches.length && native && BigInt(native.slot) === state.chainSlot) {
    const addresses = Object.keys(native.accounts).sort();
    batches.push({
      addresses,
      result: {
        context: { slot: native.slot },
        value: addresses.map((a) => ({
          owner: native.accounts[a]!.owner,
          data: [native.accounts[a]!.base64, 'base64'],
        })),
      },
    });
  }
  const matching = batches.filter(
    (b) => BigInt(b.result.context.slot) === state.chainSlot && b.addresses.includes(CUTOFF_CLOCK),
  );
  const batch = matching.at(-1);
  if (!batch) throw Error('CUTOFF_ATOMIC_BANK_MISSING');
  const bankTime = cutoffBankTime(batch);
  const evidence = createMarketStateEvidence({
    ...state,
    observedAt: bankTime as MarketState['observedAt'],
  });
  return { evidence, batches, bankTime, hash: cutoffHash({ evidence, batches, bankTime }) };
}
export function cutoffBankTime(batch: CutoffBatch) {
  const slot = batch.result.context.slot,
    clock = batch.result.value[batch.addresses.indexOf(CUTOFF_CLOCK)];
  const raw = Buffer.from(clock?.data[0] ?? '', 'base64');
  if (
    !Number.isSafeInteger(slot) ||
    slot < 0 ||
    batch.addresses.length !== batch.result.value.length ||
    clock?.owner !== 'Sysvar1111111111111111111111111111111111111' ||
    raw.length !== 40 ||
    raw.readBigUInt64LE(0) !== BigInt(slot)
  )
    throw Error('CUTOFF_ATOMIC_CLOCK_MISMATCH');
  const seconds = Number(raw.readBigInt64LE(32));
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw Error('CUTOFF_CLOCK_TIME');
  return new Date(seconds * 1000).toISOString();
}
export interface CutoffHeader {
  slot: number;
  blockhash: string;
  previousBlockhash: string;
  parentSlot: number;
  blockTime: number;
}
export interface CurrentCutoffCapture {
  evidence: MarketStateEvidence;
  batches: CutoffBatch[];
  bankTime: string;
  hash: string;
}
export function verifyCutoffCapture(
  c: CurrentCutoffCapture,
  last: CutoffHeader,
  next: CutoffHeader,
  cutoff: Date,
) {
  const { hash, ...document } = c;
  if (
    cutoffHash(document) !== hash ||
    createMarketStateEvidence(c.evidence).fingerprint !== c.evidence.fingerprint
  )
    throw Error('CUTOFF_CAPTURE_CHANGED');
  if (
    !Number.isFinite(+cutoff) ||
    +cutoff % 3600000 !== 0 ||
    !Number.isSafeInteger(last.slot) ||
    !Number.isSafeInteger(next.slot) ||
    !Number.isSafeInteger(last.blockTime) ||
    !Number.isSafeInteger(next.blockTime) ||
    !last.blockhash ||
    !next.blockhash ||
    next.slot <= last.slot ||
    next.parentSlot !== last.slot ||
    next.previousBlockhash !== last.blockhash ||
    last.blockTime * 1000 >= +cutoff ||
    next.blockTime * 1000 < +cutoff ||
    +cutoff - last.blockTime * 1000 > 10000 ||
    c.evidence.chainSlot !== BigInt(last.slot) ||
    Date.parse(c.bankTime) !== last.blockTime * 1000
  )
    throw Error('CUTOFF_BOUNDARY_UNPROVEN');
  return verifyCapturedBank(c, last);
}
function verifyCapturedBank(c: CurrentCutoffCapture, last: CutoffHeader) {
  const { hash, ...document } = c;
  if (
    cutoffHash(document) !== hash ||
    createMarketStateEvidence(c.evidence).fingerprint !== c.evidence.fingerprint ||
    c.evidence.chainSlot !== BigInt(last.slot) ||
    Date.parse(c.bankTime) !== last.blockTime * 1000
  )
    throw Error('CUTOFF_CAPTURE_CHANGED');
  const final = c.batches
    .filter((b) => b.result.context.slot === last.slot && b.addresses.includes(CUTOFF_CLOCK))
    .at(-1);
  if (!final || cutoffBankTime(final) !== c.bankTime) throw Error('CUTOFF_BANK_UNPROVEN');
  const model = c.evidence.normalizedState['model'];
  const captured = new Map(final.addresses.map((a, i) => [a, final.result.value[i]]));
  const snapshot = c.evidence.normalizedState['stage1Snapshot'] as
    { accounts?: Record<string, { owner: string; base64: string }> } | undefined;
  const accounts = (snapshot?.accounts ?? c.evidence.normalizedState['accounts']) as
    Record<string, { owner: string; base64: string }> | undefined;
  if (accounts) {
    if (
      Object.keys(accounts).some(
        (a) =>
          captured.get(a)?.owner !== accounts[a]!.owner ||
          captured.get(a)?.data[0] !== accounts[a]!.base64,
      )
    )
      throw Error('CUTOFF_ACCOUNT_BYTES_UNBOUND');
  } else if (model === 'PUMP_FUN_BONDING_CURVE') {
    const raw = c.evidence.rawSource as
      { addresses?: string[]; accountDataBase64?: string[] } | undefined;
    if (
      !raw?.addresses ||
      raw.addresses.length < 4 ||
      raw.addresses.some(
        (a, i) => a !== CUTOFF_CLOCK && captured.get(a)?.data[0] !== raw.accountDataBase64?.[i],
      )
    )
      throw Error('CUTOFF_PUMP_BANK_UNBOUND');
  } else if (model === 'PUMP_SWAP_CANONICAL_POOL') {
    const n = c.evidence.normalizedState;
    if (
      ['poolAddress', 'baseMint', 'baseVault', 'quoteVault'].some(
        (k) => typeof n[k] !== 'string' || !captured.has(n[k] as string),
      ) ||
      final.addresses.length < 7
    )
      throw Error('CUTOFF_POOL_BANK_UNBOUND');
  } else throw Error('CUTOFF_UNSUPPORTED_BANK_BINDING');
  return true as const;
}

/** Approved quote contract: original bytes durable before C; original slot finalized by C+60s.
 * This is a freshness-limited mark, not a claim to know the exact last bank before C. */
export function verifyDurableQuoteCutoff(
  c: CurrentCutoffCapture,
  header: CutoffHeader,
  cutoff: Date,
  proof: {
    receivedAt: Date;
    certifiedAt: Date;
    finalizedAt: Date;
    maxAgeMs: number;
    uncertaintyMs: number;
  },
) {
  const { maxAgeMs, uncertaintyMs } = proof,
    bank = Date.parse(c.bankTime);
  if (
    !Number.isFinite(+cutoff) ||
    +cutoff % 3600000 !== 0 ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs <= 0 ||
    maxAgeMs > 10000 ||
    !Number.isSafeInteger(uncertaintyMs) ||
    uncertaintyMs < 1 ||
    uncertaintyMs > 100 ||
    ![+proof.receivedAt, +proof.certifiedAt, +proof.finalizedAt, bank].every(Number.isFinite) ||
    bank > +proof.receivedAt ||
    +proof.receivedAt > +proof.certifiedAt ||
    +proof.certifiedAt + uncertaintyMs >= +cutoff ||
    bank >= +cutoff ||
    +cutoff - bank > maxAgeMs ||
    +proof.finalizedAt + uncertaintyMs > +cutoff + 60000 ||
    +proof.finalizedAt < +proof.certifiedAt ||
    !header.blockhash ||
    !Number.isSafeInteger(header.slot) ||
    !Number.isSafeInteger(header.blockTime)
  )
    throw Error('DURABLE_QUOTE_CUTOFF_UNQUALIFIED');
  return verifyCapturedBank(c, header);
}
