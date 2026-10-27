import {
  transitionExternalCurve,
  type CurveExternalSpec,
  type CurveNativeAccount,
} from './pump-curve.js';
import { PUMP_PROGRAM_ID } from '../../src/pump-fun.js';
import { WrappedSolFlow } from './wrapped-sol-flow.js';
import { isMultiHop, transitionMultiHop } from './pump-multihop.js';
import { pumpSweepBucket, transitionPumpSweep } from './pump-sweep.js';
import { feePolicies, WITHHELD_PREFIX, type Token2022Evidence } from './token-2022-flow.js';
import { transitionExternalPump, type PumpExternalSpec } from './pump-external.js';
import { linkedBindings, linkedRoute, carryLinkedRoot } from './shared-bridge.js';
import { epochProgression, type EpochWitness } from './epoch-flow.js';
import { prepareFootprintReplay, type FootprintCoverage } from './footprint.js';
/** Retained finalized RPC evidence -> pool-local exact-input flow replay. No RPC or activation. */
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { orcaLink, ORCA_WHIRLPOOL_PROGRAM } from '../../src/composed-pump-orca.js';
import { PUMP_AMM_PROGRAM_ID, decodePumpSwapPool } from '../../src/pump-swap.js';
import {
  WRAPPED_SOL_MINT,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '../../src/pump-fun.js';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import { transitionLinkedLeg, LinkedTransitionError } from './native-transition.js';
const CLOCK = 'SysvarC1ock11111111111111111111111111111111';
const registry = globalThis as unknown as Record<symbol, unknown>,
  immutableKey = Symbol.for('paperfund.immutable.provider.intervals.v1');
const immutableHashes =
  (registry[immutableKey] as WeakMap<object, string> | undefined) ?? new WeakMap<object, string>();
registry[immutableKey] = immutableHashes;
const jsonKey = Symbol.for('paperfund.immutable.provider.intervals.json.v1');
const immutableJSON = (registry[jsonKey] as WeakMap<object, string> | undefined) ?? new WeakMap<object, string>();
registry[jsonKey] = immutableJSON;
const frozenKey = Symbol.for('paperfund.immutable.provider.deep-frozen.v1');
const deepFrozen = (registry[frozenKey] as WeakSet<object> | undefined) ?? new WeakSet<object>();
registry[frozenKey] = deepFrozen;
/** Only this recursive freezer certifies descendants; shallow Object.freeze is insufficient. */
export function freezeProviderDocument(v: unknown) {
  if (!v || typeof v !== 'object' || deepFrozen.has(v)) return;
  for (const child of Object.values(v)) freezeProviderDocument(child);
  Object.freeze(v);
  deepFrozen.add(v);
}
/** Hash once, then freeze every descendant; a mutable object never receives a cached hash. */
export function retainProviderInterval(e: ProviderInterval): ProviderInterval {
  if (immutableHashes.has(e)) return e;
  let json: string | undefined, hash: string;
  if(e.blocks.length>128){
    // Historical gaps may exceed V8's single-string limit. Hash the identical
    // canonical document one complete block at a time; no evidence is filtered.
    const h=createHash('sha256');h.update('{');let first=true;
    const keys=Object.keys(Object.fromEntries(Object.entries(e).sort(([a],[b])=>a.localeCompare(b))));
    for(const key of keys){const value=(e as unknown as Record<string,unknown>)[key];if(value===undefined)continue;
      if(!first)h.update(',');first=false;h.update(JSON.stringify(key)+':');
      if(key==='blocks'){h.update('[');e.blocks.forEach((b,i)=>{if(i)h.update(',');h.update(canonicalJSON(b))});h.update(']');}
      else h.update(canonicalJSON(value));
    }h.update('}');hash=h.digest('hex');
  }else{json=canonicalJSON(e);hash=createHash('sha256').update(json).digest('hex');}
  freezeProviderDocument(e);
  immutableHashes.set(e, hash);
  if(json!==undefined)immutableJSON.set(e, json);
  return e;
}
/** Reuse the exact canonical representation already hashed, never re-encode mutable evidence. */
export function serializeProviderInterval(e: ProviderInterval): string {
  retainProviderInterval(e);
  let json = immutableJSON.get(e);
  if (json === undefined) {
    json = canonicalJSON(e);
    if (createHash('sha256').update(json).digest('hex') !== digest(e)) fail('IMMUTABLE_ENCODING_CONFLICT');
    immutableJSON.set(e, json);
  }
  return json;
}
export function copyProviderInterval(e: ProviderInterval): ProviderInterval {
  return immutableHashes.has(e) ? e : structuredClone(e);
}
export function digest(v: unknown): string {
  if (v && typeof v === 'object') {
    const retained = immutableHashes.get(v);
    if (retained) return retained;
  }
  return createHash('sha256').update(canonicalJSON(v)).digest('hex');
}
// RPC receipts repeat the same few object shapes thousands of times. Preserve
// the exact historical localeCompare ordering without sorting/allocating entry
// pairs for every receipt. Cache key orders only, never values or market state.
const canonicalOrders = new Map<string, string[]>();
function canonicalJSON(v: unknown): string {
  const object = (x: Record<string, unknown>) => {
    const keys = Object.keys(x), shape = JSON.stringify(keys);
    let ordered = canonicalOrders.get(shape);
    if (!ordered) {
      ordered = keys.sort((a,b)=>a.localeCompare(b));
      canonicalOrders.set(shape, ordered);
      if (canonicalOrders.size > 256) canonicalOrders.delete(canonicalOrders.keys().next().value!);
    }
    const result: Record<string, unknown> = Object.create(null);
    for (const key of ordered) result[key] = sort(x[key]);
    return result;
  };
  const sort = (x: unknown): unknown =>
    typeof x === 'bigint'
      ? x.toString()
      : Array.isArray(x)
        ? x.map(sort)
        : x && typeof x === 'object'
          ? object(x as Record<string, unknown>)
          : x;
  return JSON.stringify(sort(v));
}
const fail = (reason: string): never => {
  throw new LinkedTransitionError(reason);
};
export interface Instruction {
  programIdIndex: number;
  accounts: number[];
  data: string;
  stackHeight?: number | null;
}
interface Balance {
  accountIndex: number;
  mint: string;
  uiTokenAmount: { amount: string };
  owner?: string;
  programId?: string;
}
export interface Receipt {
  version: number | 'legacy';
  transaction: {
    signatures: string[];
    message: { accountKeys: string[]; instructions: Instruction[] };
  };
  meta: {
    err: unknown;
    preBalances?: number[];
    postBalances?: number[];
    fee?: number;
    loadedAddresses?: { writable: string[]; readonly: string[] };
    innerInstructions: { index: number; instructions: Instruction[] }[];
    preTokenBalances: Balance[];
    postTokenBalances: Balance[];
  };
}
export interface ProviderInterval {
  schema: 'LINKED_RETAINED_RPC_INTERVAL_V1' | 'LINKED_RETAINED_RPC_INTERVAL_V2';
  coverage?: FootprintCoverage;
  commitment: 'finalized';
  acquiredAt: string;
  token2022?: Token2022Evidence;
  epochWitness?: EpochWitness;
  before: Stage1Snapshot;
  after: Stage1Snapshot;
  slots: number[];
  anchor: { blockhash: string };
  blocks: {
    slot: number;
    result: {
      parentSlot: number;
      previousBlockhash: string;
      blockhash: string;
      blockTime: number;
      transactions: Receipt[];
    };
  }[];
}
export interface LinkedBranch {
  version: 'LINKED_BRANCH_V1';
  accountId: string;
  roundId: string;
  real: Stage1Snapshot;
  simulated: Stage1Snapshot;
  /** Difference from provider balances, carried by token account; never an invented input allowance. */
  inventoryDeltas: Record<string, string>;
  nativeReserves?: Record<string, string>;
  intervals: string[];
}
export function newLinkedBranch(
  accountId: string,
  roundId: string,
  anchor: Stage1Snapshot,
): LinkedBranch {
  if (!accountId || !roundId) fail('MISSING_SCOPE');
  return {
    version: 'LINKED_BRANCH_V1',
    accountId,
    roundId,
    real: structuredClone(anchor),
    simulated: structuredClone(anchor),
    inventoryDeltas: {},
    intervals: [],
  };
}
function setTime(s: Stage1Snapshot, slot: number, seconds: number, epoch: {start:number;epoch:number;leader:number}) {
  if (!Number.isSafeInteger(slot) || !Number.isSafeInteger(seconds) || seconds < 0)
    fail('INVALID_CHAIN_TIME');
  const raw = Buffer.from(s.accounts[CLOCK]!.base64, 'base64');
  raw.writeBigUInt64LE(BigInt(slot), 0);
  raw.writeBigInt64LE(BigInt(epoch.start), 8);
  raw.writeBigUInt64LE(BigInt(epoch.epoch), 16);
  raw.writeBigUInt64LE(BigInt(epoch.leader), 24);
  raw.writeBigInt64LE(BigInt(seconds), 32);
  return {
    ...structuredClone(s),
    slot,
    observedAt: new Date(seconds * 1000).toISOString(),
    accounts: {
      ...structuredClone(s.accounts),
      [CLOCK]: { ...s.accounts[CLOCK]!, base64: raw.toString('base64') },
    },
  };
}
function assertSameRoute(a: Stage1Snapshot, b: Stage1Snapshot) {
  for (const snapshot of [a, b]) {
    const clock = Buffer.from(snapshot.accounts[CLOCK]?.base64 ?? '', 'base64');
    if (clock.length !== 40 || clock.readBigUInt64LE(0) !== BigInt(snapshot.slot))
      fail('STAGE1_CLOCK_INCONSISTENT');
  }
  if (digest(linkedBindings(a)) !== digest(linkedBindings(b))) fail('LINKED_GROUP_ROUTES_CHANGED');
  for (const k of ['mint', 'quoteMint', 'targetPool', 'bridgePool'] as const)
    if (a[k] !== b[k]) fail('ROUTE_CHANGED');
  if (
    digest(a.absentAccounts) !== digest(b.absentAccounts) ||
    digest(Object.keys(a.accounts).sort()) !== digest(Object.keys(b.accounts).sort())
  )
    fail('TICK_DEPENDENCIES_CHANGED');
}
const bytes = (text: string) => Buffer.from(bs58.decode(text));
function sameDisc(raw: Buffer, name: string) {
  return raw.subarray(0, 8).equals(
    createHash('sha256')
      .update('global:' + name)
      .digest()
      .subarray(0, 8),
  );
}
export function decodeSwap(s: Stage1Snapshot, ix: Instruction, keys: string[]) {
  const p = keys[ix.programIdIndex],
    a = ix.accounts.map((i) => keys[i]!),
    raw = bytes(ix.data);
  if (p === ORCA_WHIRLPOOL_PROGRAM && a[4] !== s.bridgePool) {
    const binding = linkedBindings(s).find(
      (r) => r.bridgePool === a[4] && r.targetPool !== r.bridgePool,
    );
    if (binding) s = { ...s, ...binding };
  }
  if (p === ORCA_WHIRLPOOL_PROGRAM && a[4] === s.bridgePool) {
    if (
      !sameDisc(raw, 'swap_v2') ||
      raw.length < 43 ||
      raw[40] !== 1 ||
      raw[41]! > 1 ||
      raw[42] !== 0
    )
      fail('UNSUPPORTED_ORCA_INSTRUCTION');
    const bridge = orcaLink(s.bridgePool, s.accounts[s.bridgePool]!);
    if (
      a[5] !== bridge.mintA ||
      a[6] !== bridge.mintB ||
      a[8] !== bridge.vaultA ||
      a[10] !== bridge.vaultB
    )
      fail('ORCA_INSTRUCTION_BINDING');
    const aToB = raw[41] === 1;
    return {
      pump: null as PumpExternalSpec | null,
      routeMint: s.mint,
      routeBridgePool: s.bridgePool,
      leg: 'BRIDGE' as const,
      buy: (aToB ? bridge.mintA : bridge.mintB) === WRAPPED_SOL_MINT,
      input: raw.readBigUInt64LE(8),
      minimum: raw.readBigUInt64LE(16),
      source: aToB ? a[7]! : a[9]!,
      destination: aToB ? a[9]! : a[7]!,
      inputVault: aToB ? bridge.vaultA : bridge.vaultB,
      outputVault: aToB ? bridge.vaultB : bridge.vaultA,
      sqrtLimit: raw.readBigUInt64LE(24) + (raw.readBigUInt64LE(32) << 64n),
      aToB,
    };
  }
  const curveV3 =
      p === PUMP_PROGRAM_ID &&
      ['buy_v3', 'buy_exact_quote_in_v3', 'sell_v3'].some((n) => sameDisc(raw, n)),
    curveV2 =
      p === PUMP_PROGRAM_ID &&
      ['buy_v2', 'buy_exact_quote_in_v2', 'sell_v2'].some((n) => sameDisc(raw, n));
  const curveIndex = curveV2 ? 10 : 5;
  if (
    (curveV3 || curveV2) &&
    a[curveIndex] &&
    s.accounts[a[curveIndex]!]?.owner === PUMP_PROGRAM_ID
  ) {
    const buy = !sameDisc(raw, curveV2 ? 'sell_v2' : 'sell_v3'),
      shift = curveV2 && !buy ? -1 : 0,
      config = curveV2 ? 22 + shift : 12,
      system = curveV2 ? 24 + shift : 14,
      end = curveV2 ? 26 + shift : 16;
    if (
      raw.length < 24 ||
      raw.length > 25 ||
      (raw.length === 25 && raw[24] !== 0) ||
      a.length !== end + 1 ||
      a[0] !== '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf' ||
      a[config] !== '8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt' ||
      a[end] !== PUMP_PROGRAM_ID ||
      a[system] !== '11111111111111111111111111111111' ||
      a[3] !== s.accounts[a[1]!]?.owner ||
      a[4] !== s.accounts[a[2]!]?.owner ||
      (curveV2 && a[23 + shift] !== 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ')
    )
      fail('CURVE_INSTRUCTION_BINDING');
    const native = a[2] === WRAPPED_SOL_MINT;
    return {
      curve: {
        pool: a[curveIndex]!,
        baseMint: a[1]!,
        quoteMint: a[2]!,
        legacy: curveV2,
        exactOutput: sameDisc(raw, curveV2 ? 'buy_v2' : 'buy_v3'),
        buy,
        amount: raw.readBigUInt64LE(8),
        bound: raw.readBigUInt64LE(16),
        userBase: a[curveV2 ? 14 : 9]!,
        userQuote: a[curveV2 ? 15 : 10]!,
        baseVault: a[curveV2 ? 11 : 6]!,
        quoteVault: a[curveV2 ? 12 : 7]!,
        nativeUser: a[curveV2 ? 13 : 8]!,
        protocolRecipient: curveV2 ? a[native ? 6 : 7]! : '',
        creatorRecipient: curveV2 ? a[native ? 16 : 17]! : '',
        buybackRecipient: a[curveV2 ? (native ? 8 : 9) : 13]!,
        ...(curveV2
          ? {
              payouts: {
                protocolWallet: a[6]!,
                creatorVault: a[16]!,
                buybackWallet: a[8]!,
                sharingConfig: a[18]!,
              },
            }
          : {}),
      } as CurveExternalSpec,
      pump: null as PumpExternalSpec | null,
      routeMint: s.mint,
    };
  }
  if (
    p === PUMP_PROGRAM_ID &&
    a.some(
      (address) =>
        s.accounts[address]?.owner === PUMP_PROGRAM_ID &&
        Buffer.from(s.accounts[address]!.base64, 'base64').length === 166,
    )
  )
    fail('UNSUPPORTED_CURVE_MUTATION');
  const route = linkedBindings(s).find((r) => r.targetPool === a[0]);
  const pumpBridge =
    p === PUMP_AMM_PROGRAM_ID &&
    a[0] === s.bridgePool &&
    s.accounts[s.bridgePool]?.owner === PUMP_AMM_PROGRAM_ID;
  const auxiliary =
    p === PUMP_AMM_PROGRAM_ID &&
    !!s.accounts[a[0]!] &&
    s.accounts[a[0]!]!.owner === PUMP_AMM_PROGRAM_ID;
  if (p === PUMP_AMM_PROGRAM_ID && (route || pumpBridge || auxiliary)) {
    if (route) s = linkedRoute(s, route.mint);
    const buy = ['buy_exact_quote_in', 'buy_exact_quote_in_v2', 'buy', 'buy_v2'].some((n) =>
        sameDisc(raw, n),
      ),
      legacy = !['buy_exact_quote_in_v2', 'buy_v2', 'sell_v2'].some((n) => sameDisc(raw, n)),
      exactOutput = ['buy', 'buy_v2'].some((n) => sameDisc(raw, n));
    if ((!buy && !['sell', 'sell_v2'].some((n) => sameDisc(raw, n))) || raw.length < 24)
      fail('UNSUPPORTED_PUMPSWAP_INSTRUCTION');
    const pool = decodePumpSwapPool(Buffer.from(s.accounts[a[0]!]!.base64, 'base64'));
    if (
      a[3] !== pool.baseMint ||
      a[4] !== pool.quoteMint ||
      a[7] !== pool.baseVault ||
      a[8] !== pool.quoteVault
    )
      fail('TARGET_INSTRUCTION_BINDING');
    return {
      pump:
        pumpBridge || auxiliary || !legacy
          ? ({
              pool: a[0]!,
              legacy,
              exactOutput,
              buy,
              amount: raw.readBigUInt64LE(8),
              bound: raw.readBigUInt64LE(16),
              userBase: a[5]!,
              userQuote: a[6]!,
              protocolRecipient: legacy ? a[10]! : '',
              creatorRecipient: legacy ? a[17]! : '',
              buybackRecipient: legacy ? a.at(-1)! : a[14]!,
            } as PumpExternalSpec)
          : null,
      routeMint: s.mint,
      leg: pumpBridge ? ('BRIDGE' as const) : ('TARGET' as const),
      buy,
      input: raw.readBigUInt64LE(8),
      minimum: raw.readBigUInt64LE(16),
      source: buy ? a[6]! : a[5]!,
      destination: buy ? a[5]! : a[6]!,
      inputVault: buy ? pool.quoteVault : pool.baseVault,
      outputVault: buy ? pool.baseVault : pool.quoteVault,
      sqrtLimit: 0n,
      aToB: false,
    };
  }
  if (
    (p === ORCA_WHIRLPOOL_PROGRAM || p === PUMP_AMM_PROGRAM_ID) &&
    a.some((x) => linkedBindings(s).some((r) => x === r.targetPool) || x === s.bridgePool)
  )
    fail('UNSUPPORTED_POOL_MUTATION');
  return null;
}
export async function reconcileLinkedInterval(
  branch: LinkedBranch,
  evidence: ProviderInterval,
  nowMs: number,
  maxAgeMs: number,
) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0)
    fail('INVALID_FRESHNESS_POLICY');
  if (!['LINKED_RETAINED_RPC_INTERVAL_V1','LINKED_RETAINED_RPC_INTERVAL_V2'].includes(evidence.schema) || evidence.commitment !== 'finalized')
    fail('FINALIZED_EVIDENCE_REQUIRED');
  const hash = digest(evidence);
  if (branch.intervals.includes(hash)) {
    if (digest(branch.real) !== digest(evidence.after)) fail('OLD_INTERVAL_REPLAY');
    return {
      branch: structuredClone(branch),
      events: 0,
      failedTransactions: 0,
      hash,
      replay: true,
    };
  }
  if (digest(branch.real) !== digest(evidence.before)) fail('EXTERNAL_ANCHOR_MISMATCH');
  assertSameRoute(evidence.before, evidence.after);
  const epochAt = epochProgression(evidence.before, evidence.after, evidence.blocks, evidence.epochWitness);
  const age = nowMs - Date.parse(evidence.after.observedAt);
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age > maxAgeMs ||
    evidence.after.slot <= evidence.before.slot
  )
    fail('STALE_EXTERNAL_CHECKPOINT');
  if (evidence.blocks.length !== evidence.slots.length) fail('INCOMPLETE_BLOCKS');
  let parent = evidence.before.slot,
    previousHash = evidence.anchor.blockhash;
  if (!previousHash) fail('ANCHOR_BLOCK_MISSING');
  let real = structuredClone(branch.real),
    sim = structuredClone(branch.simulated),
    events = 0,
    failedTransactions = 0;
  const tokenFees = feePolicies(evidence.token2022, evidence.before, evidence.after, evidence.blocks, evidence.epochWitness);
  const footprintPlan=prepareFootprintReplay(branch,evidence,[...tokenFees.keys()]);
  const token2022Transfers: {
    signature: string;
    from: string;
    to: string;
    mint: string;
    gross: string;
    net: string;
    withheld: string;
    shadowGross: string;
    shadowNet: string;
  }[] = [];
  const nativeReserves = { ...branch.nativeReserves };
  const deltas = { ...branch.inventoryDeltas },
    seen = new Set<string>();
  const protectedAccounts = new Set(Object.keys(real.accounts).filter((a) => a !== CLOCK));
  const poolAccounts = new Set(
    Object.entries(real.accounts)
      .filter(
        ([, a]) =>
          (a.owner === PUMP_AMM_PROGRAM_ID &&
            [287, 300, 301].includes(Buffer.from(a.base64, 'base64').length)) ||
          (a.owner === PUMP_PROGRAM_ID && Buffer.from(a.base64, 'base64').length === 166),
      )
      .map(([k]) => k),
  );
  poolAccounts.add(real.bridgePool);
  linkedBindings(real).forEach((r) => {
    poolAccounts.add(r.targetPool);
    poolAccounts.add(r.bridgePool);
  });
  for (const [bi, { slot, result: b }] of evidence.blocks.entries()) {
    if (
      slot !== evidence.slots[bi] ||
      slot <= parent ||
      b.parentSlot !== parent ||
      b.previousBlockhash !== previousHash ||
      !b.blockhash
    )
      fail('BLOCK_FRONTIER_GAP');
    parent = slot;
    previousHash = b.blockhash;
    const epoch = epochAt(slot);
    real = setTime(real, slot, b.blockTime, epoch);
    sim = setTime(sim, slot, b.blockTime, epoch);
    const rows=footprintPlan?.[bi]??b.transactions.map(receipt=>({receipt}));
    for (const row of rows) {
      if(!row.receipt){
        const omitted=row as NonNullable<typeof footprintPlan>[number][number];
        omitted.assertOmission(deltas,nativeReserves);
        if(seen.has(omitted.signature))fail('DUPLICATE_TRANSACTION');seen.add(omitted.signature);
        if(omitted.failed)failedTransactions++;
        continue;
      }
      const t=row.receipt;
      const signature = t.transaction.signatures[0];
      if (!signature || seen.has(signature)) return fail('DUPLICATE_TRANSACTION');
      seen.add(signature);
      if (!t.meta) fail('RECEIPT_METADATA_MISSING');
      if (t.meta.err !== null) {
        failedTransactions++;
        continue;
      }
      const keys = [
        ...t.transaction.message.accountKeys,
        ...(t.meta.loadedAddresses?.writable ?? []),
        ...(t.meta.loadedAddresses?.readonly ?? []),
      ];
      const allInstructions = [
        ...t.transaction.message.instructions,
        ...t.meta.innerInstructions.flatMap((g) => g.instructions),
      ];
      const touchesPool = allInstructions.some(
        (ix) =>
          [ORCA_WHIRLPOOL_PROGRAM, PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID].includes(
            keys[ix.programIdIndex] ?? '',
          ) && ix.accounts.some((i) => poolAccounts.has(keys[i]!)),
      );
      const touchesMintBurn = allInstructions.some((ix) =>
        [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(keys[ix.programIdIndex] ?? '') &&
        [8, 15].includes(bytes(ix.data)[0]!) && protectedAccounts.has(keys[ix.accounts[1]!] ?? ''));
      const tracked =
        WrappedSolFlow.tracked(keys, deltas) ||
        keys.some((a) => BigInt(deltas[WITHHELD_PREFIX + a] ?? '0') !== 0n) ||
        t.meta.preTokenBalances.some((x) => BigInt(deltas[keys[x.accountIndex]!] ?? '0') !== 0n);
      if (!touchesPool && !tracked && !touchesMintBurn) {
        for (const x of t.meta.preTokenBalances) {
          const a = keys[x.accountIndex]!;
          if (protectedAccounts.has(a ?? '')) {
            const post = t.meta.postTokenBalances.find((v) => v.accountIndex === x.accountIndex);
            if (!post || post.uiTokenAmount.amount !== x.uiTokenAmount.amount)
              fail('UNSUPPORTED_DEPENDENCY_CHANGE');
          }
        }
        continue;
      }
      const actual = new Map<string, bigint>(
        t.meta.preTokenBalances.map((x) => [keys[x.accountIndex]!, BigInt(x.uiTokenAmount.amount)]),
      );
      const native = new WrappedSolFlow(t, keys, deltas, protectedAccounts, real, nativeReserves);
      const adjustments = new Map<string, bigint>();
      const burnedAccounts = new Set<string>();
      let pending: {
        depth: number;
        swap: Exclude<ReturnType<typeof decodeSwap>, { curve: CurveExternalSpec }>;
        realOut: bigint;
        simOut: bigint;
        inputSeen: boolean;
        outputSeen: boolean;
        transfers?: {
          from: string;
          to: string;
          real: bigint;
          shadow: bigint;
          seen: boolean;
          kind?: 'NATIVE_SYSTEM' | 'NATIVE_DIRECT';
        }[];
        curveCalls?: { accounts: string[]; input: bigint; fees: number[]; seen: boolean }[];
      } | null = null;
      const directNative = () => {
        if (pending?.transfers?.some((t) => t.kind === 'NATIVE_SYSTEM' && !t.seen)) return;
        for (const t of pending?.transfers ?? [])
          if (t.kind === 'NATIVE_DIRECT' && !t.seen) {
            native.curveTransfer(t.from, t.to, t.real, t.shadow);
            t.seen = true;
          }
      };
      const assertCurveNative = (before: Stage1Snapshot, next: Stage1Snapshot) => {
        for (const [address, a] of Object.entries(before.accounts)) {
          if (
            a.owner === PUMP_PROGRAM_ID &&
            (a as CurveNativeAccount).lamports !== undefined &&
            (a as CurveNativeAccount).lamports !==
              (next.accounts[address] as CurveNativeAccount)?.lamports
          )
            native.assertCurveBalance(address, (a as CurveNativeAccount).lamports!);
        }
      };
      const finalize = () => {
        directNative();
        if (pending?.curveCalls?.some((c) => !c.seen)) fail('CURVE_CPI_EVIDENCE_MISSING');
        if (pending && (!pending.inputSeen || !pending.outputSeen))
          fail('SWAP_TRANSFER_EVIDENCE_MISSING');
        if (pending?.transfers?.some((t) => !t.seen && t.real > 0n))
          fail('PUMP_TRANSFER_EVIDENCE_MISSING');
        pending = null;
      };
      const applyTransfer = (
        from: string,
        to: string,
        amount: bigint,
        shadowAmount: bigint,
        net = amount,
        shadowNet = shadowAmount,
      ) => {
        const realBalance = actual.get(from);
        if (realBalance === undefined || realBalance < amount)
          return fail('TRANSFER_INPUT_EVIDENCE_MISSING');
        if (
          !protectedAccounts.has(from) &&
          realBalance + BigInt(deltas[from] ?? '0') < shadowAmount
        )
          fail('MODELED_EXTERNAL_INVENTORY_EXHAUSTED');
        actual.set(from, realBalance - amount);
        actual.set(to, (actual.get(to) ?? 0n) + net);
        if (!protectedAccounts.has(from))
          deltas[from] = (BigInt(deltas[from] ?? '0') + amount - shadowAmount).toString();
        if (!protectedAccounts.has(to))
          deltas[to] = (BigInt(deltas[to] ?? '0') + shadowNet - net).toString();
        const feeDelta = shadowAmount - shadowNet - (amount - net);
        if (feeDelta !== 0n)
          deltas[WITHHELD_PREFIX + to] = (
            BigInt(deltas[WITHHELD_PREFIX + to] ?? '0') + feeDelta
          ).toString();
        native.tokenTransfer(from, to, amount, shadowAmount);
        adjustments.set(from, (adjustments.get(from) ?? 0n) - amount);
        adjustments.set(to, (adjustments.get(to) ?? 0n) + net);
      };
      const flattened: { ix: Instruction; depth: number }[] = [];
      for (const [oi, ix] of t.transaction.message.instructions.entries()) {
        flattened.push({ ix, depth: 1 });
        for (const inner of t.meta.innerInstructions.find((g) => g.index === oi)?.instructions ??
          []) {
          if (!Number.isSafeInteger(inner.stackHeight) || inner.stackHeight! < 2)
            fail('CPI_ANCESTRY_MISSING');
          flattened.push({ ix: inner, depth: inner.stackHeight! });
        }
      }
      const ancestry: string[] = [];
      for (const [instructionIndex, { ix, depth }] of flattened.entries()) {
        ancestry.length = depth - 1;
        const ancestors = ancestry.slice();
        ancestry[depth - 1] = keys[ix.programIdIndex]!;
        if (pending && depth <= pending.depth) finalize();
        if (pumpSweepBucket(ix, keys) && poolAccounts.has(keys[ix.accounts[2]!]!)) {
          if (pending) fail('NESTED_NATIVE_SWEEP_UNSUPPORTED');
          const r = await transitionPumpSweep(real, ix, keys),
            v = await transitionPumpSweep(sim, ix, keys);
          if (r.amount === 0n && v.amount !== 0n) fail('PUMP_SWEEP_ZERO_REAL_WITH_PAPER_FEES');
          pending = {
            depth,
            swap: null,
            realOut: 0n,
            simOut: 0n,
            inputSeen: true,
            outputSeen: true,
            transfers: [{ from: r.from, to: r.to, real: r.amount, shadow: v.amount, seen: false }],
          };
          real = r.next;
          sim = v.next;
          events++;
          continue;
        }
        if (isMultiHop(ix, keys) && ix.accounts.some((i) => poolAccounts.has(keys[i]!))) {
          if (pending) fail('NESTED_NATIVE_SWAP_UNSUPPORTED');
          const r = await transitionMultiHop(real, ix, keys, native.mints),
            v = await transitionMultiHop(sim, ix, keys, native.mints);
          pending = {
            depth,
            swap: null,
            realOut: r.output,
            simOut: v.output,
            inputSeen: true,
            outputSeen: true,
            curveCalls: r.curveCalls.map((c) => ({ ...c, seen: false })),
            transfers: r.transfers.map((t, i) => {
              const shadow = v.transfers[i];
              if (!shadow || shadow.from !== t.from || shadow.to !== t.to)
                fail('PUMP_TRANSFER_TOPOLOGY_CHANGED');
              return {
                ...t,
                real: t.amount,
                shadow: shadow!.amount,
                seen: false,
              };
            }),
          };
          if (r.transfers.length !== v.transfers.length) fail('PUMP_TRANSFER_TOPOLOGY_CHANGED');
          assertCurveNative(real, r.next);
          real = r.next;
          sim = v.next;
          directNative();
          events += r.steps.length;
          continue;
        }
        if (
          keys[ix.programIdIndex] === PUMP_PROGRAM_ID &&
          sameDisc(bytes(ix.data), 'multi_hop_curve_swap')
        ) {
          const raw = bytes(ix.data),
            accounts = ix.accounts.map((i) => keys[i]!),
            call = pending?.curveCalls?.find(
              (c) => !c.seen && digest(c.accounts) === digest(accounts),
            );
          if (
            !pending ||
            depth !== pending.depth + 1 ||
            ancestors[pending.depth - 1] !== PUMP_AMM_PROGRAM_ID ||
            !call ||
            raw.length !== 20 + call.fees.length ||
            raw.readUInt32LE(16) !== call.fees.length ||
            raw.readBigUInt64LE(8) !== call.input ||
            !raw.subarray(20).equals(Buffer.from(call.fees))
          )
            fail('CURVE_CPI_BINDING');
          call!.seen = true;
          continue;
        }
        const swap = decodeSwap(real, ix, keys);
        if (swap) {
          if (pending) fail('NESTED_NATIVE_SWAP_UNSUPPORTED');
          if (swap.curve) {
            if (depth !== 1) fail('CURVE_AGGREGATOR_ENVELOPE_UNSUPPORTED');
            const r = await transitionExternalCurve(real, swap.curve, {
                nowMs: Date.parse(real.observedAt),
                maxAgeMs: 10000,
              }),
              v = await transitionExternalCurve(sim, swap.curve, {
                nowMs: Date.parse(sim.observedAt),
                maxAgeMs: 10000,
              });
            pending = {
              depth,
              swap: null,
              realOut: r.output,
              simOut: v.output,
              inputSeen: true,
              outputSeen: true,
              transfers: r.transfers.map((t, i) => {
                const shadow = v.transfers[i];
                if (!shadow || shadow.from !== t.from || shadow.to !== t.to)
                  fail('CURVE_TRANSFER_TOPOLOGY_CHANGED');
                return { ...t, real: t.amount, shadow: shadow!.amount, seen: false };
              }),
            };
            if (r.transfers.length !== v.transfers.length) fail('CURVE_TRANSFER_TOPOLOGY_CHANGED');
            assertCurveNative(real, r.next);
            real = r.next;
            sim = v.next;
            directNative();
            events++;
            continue;
          }
          if (swap.pump) {
            const policy = { nowMs: Date.parse(real.observedAt), maxAgeMs: 10000 };
            const r = await transitionExternalPump(
                linkedRoute(
                  real,
                  swap.routeMint,
                  'routeBridgePool' in swap ? swap.routeBridgePool : undefined,
                ),
                swap.pump,
                policy,
              ),
              v = await transitionExternalPump(
                linkedRoute(
                  sim,
                  swap.routeMint,
                  'routeBridgePool' in swap ? swap.routeBridgePool : undefined,
                ),
                swap.pump,
                policy,
              );
            pending = {
              depth,
              swap,
              realOut: r.output,
              simOut: v.output,
              inputSeen: true,
              outputSeen: true,
              transfers: r.transfers.map((t, i) => {
                const shadow = v.transfers[i];
                if (!shadow || shadow.from !== t.from || shadow.to !== t.to)
                  fail('PUMP_TRANSFER_TOPOLOGY_CHANGED');
                return {
                  from: t.from,
                  to: t.to,
                  real: t.amount,
                  shadow: shadow!.amount,
                  seen: false,
                };
              }),
            };
            if (v.transfers.length !== r.transfers.length) fail('PUMP_TRANSFER_TOPOLOGY_CHANGED');
            real = carryLinkedRoot(real, r.next);
            sim = carryLinkedRoot(sim, v.next);
            events++;
            continue;
          }
          const r = await transitionLinkedLeg(
            linkedRoute(
              real,
              swap.routeMint,
              'routeBridgePool' in swap ? swap.routeBridgePool : undefined,
            ),
            swap.input,
            swap.buy,
            { nowMs: Date.parse(real.observedAt), maxAgeMs: 10000 },
            swap.leg,
          );
          const v = await transitionLinkedLeg(
            linkedRoute(
              sim,
              swap.routeMint,
              'routeBridgePool' in swap ? swap.routeBridgePool : undefined,
            ),
            swap.input,
            swap.buy,
            { nowMs: Date.parse(sim.observedAt), maxAgeMs: 10000 },
            swap.leg,
          );
          if (r.output < swap.minimum || v.output < swap.minimum)
            fail('EXTERNAL_SIGNED_MINIMUM_VIOLATED');
          if (swap.leg === 'BRIDGE' && swap.sqrtLimit !== 0n) {
            const raw = Buffer.from(
                v.next.accounts['routeBridgePool' in swap ? swap.routeBridgePool! : sim.bridgePool]!
                  .base64,
                'base64',
              ),
              sqrt = raw.readBigUInt64LE(65) + (raw.readBigUInt64LE(73) << 64n);
            if (swap.aToB ? sqrt < swap.sqrtLimit : sqrt > swap.sqrtLimit)
              fail('EXTERNAL_PRICE_LIMIT_VIOLATED');
          }
          pending = {
            depth,
            swap,
            realOut: r.output,
            simOut: v.output,
            inputSeen: false,
            outputSeen: false,
          };
          real = carryLinkedRoot(real, r.next);
          sim = carryLinkedRoot(sim, v.next);
          events++;
          continue;
        }
        const program = keys[ix.programIdIndex],
          accounts = ix.accounts.map((i) => keys[i]!),
          raw = bytes(ix.data);
        // Native transparent Burn/BurnChecked changes supply even outside a pool transaction.
        // Apply the same proven amount to real/shadow state; never burn withheld inventory.
        if ([SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(program ?? '') &&
            [8,15].includes(raw[0]!) && protectedAccounts.has(accounts[1]!)) {
          const [source,mint] = accounts, amount = raw.length >= 9 ? raw.readBigUInt64LE(1) : -1n;
          const a = real.accounts[mint!]!, data = Buffer.from(a.base64,'base64');
          const pre = t.meta.preTokenBalances.find((v) => keys[v.accountIndex] === source),
            post = t.meta.postTokenBalances.find((v) => keys[v.accountIndex] === source);
          const closesLater=flattened.slice(instructionIndex+1).some(({ix:later})=>
            keys[later.programIdIndex]===program && keys[later.accounts[0]!]===source &&
            bytes(later.data).length===1 && bytes(later.data)[0]===9);
          if (pending || raw.length !== (raw[0] === 15 ? 10 : 9) ||
              a.owner !== program || data.length < 82 || data[45] !== 1 ||
              mint === WRAPPED_SOL_MINT || protectedAccounts.has(source!) ||
              !pre || !post && !closesLater || pre.mint !== mint || post && post.mint !== mint ||
              pre.programId !== program || post && post.programId !== program ||
              raw[0] === 15 && raw[9] !== data[44] ||
              actual.get(source!) === undefined || actual.get(source!)! < amount ||
              actual.get(source!)! + BigInt(deltas[source!] ?? '0') < amount)
            fail('TOKEN_BURN_EVIDENCE_UNSUPPORTED');
          for (const state of [real,sim]) {
            const rawMint=Buffer.from(state.accounts[mint!]!.base64,'base64'),
              supply=rawMint.readBigUInt64LE(36);
            if (amount < 0n || supply < amount) fail('TOKEN_BURN_SUPPLY_UNDERFLOW');
            rawMint.writeBigUInt64LE(supply-amount,36);
            state.accounts[mint!]={...state.accounts[mint!]!,base64:rawMint.toString('base64')};
          }
          actual.set(source!,actual.get(source!)!-amount);
          adjustments.set(source!,(adjustments.get(source!)??0n)-amount);
          burnedAccounts.add(source!);
          events++;
          continue;
        }
        if ([SPL_TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].includes(program??'') &&
            raw[0]===9 && burnedAccounts.has(accounts[0]!) &&
            (actual.get(accounts[0]!)!==0n || BigInt(deltas[accounts[0]!]??'0')!==0n ||
             BigInt(deltas[WITHHELD_PREFIX+accounts[0]!]??'0')!==0n))
          fail('TOKEN_BURN_CLOSE_NOT_EMPTY');
        if (
          program === '11111111111111111111111111111111' &&
          raw.length === 12 &&
          raw.readUInt32LE(0) === 2 &&
          pending?.transfers
        ) {
          const expected = pending.transfers.find(
            (t) =>
              !t.seen &&
              t.kind === 'NATIVE_SYSTEM' &&
              t.from === accounts[0] &&
              t.to === accounts[1],
          );
          if (expected) {
            if (expected.real !== raw.readBigUInt64LE(4)) fail('CURVE_NATIVE_TRANSFER_MISMATCH');
            native.curveTransfer(expected.from, expected.to, expected.real, expected.shadow);
            expected.seen = true;
            directNative();
            continue;
          }
        }
        if (
          program === TOKEN_2022_PROGRAM_ID &&
          raw[0] !== 3 &&
          raw[0] !== 12 &&
          accounts.some((a) => BigInt(deltas[WITHHELD_PREFIX + a] ?? '0') !== 0n)
        )
          fail('TRACKED_WITHHELD_MUTATION_UNSUPPORTED');
        const synchronizes = [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(program ?? '') && raw[0] === 17;
        const tokensBeforeSync = synchronizes ? actual.get(accounts[0]!) : undefined;
        const nativeHandled = native.instruction(ix, raw, depth, ancestors, actual);
        if (nativeHandled && synchronizes) {
          const tokensAfterSync = actual.get(accounts[0]!);
          if (tokensBeforeSync === undefined || tokensAfterSync === undefined)
            fail('NATIVE_SYNC_TOKEN_EVIDENCE_MISSING');
          // System funding changes lamports only. Recognize spendable WSOL once,
          // at the verified SyncNative instruction; a repeated sync credits zero.
          adjustments.set(accounts[0]!, (adjustments.get(accounts[0]!) ?? 0n) + tokensAfterSync! - tokensBeforeSync!);
        }
        if (
          [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(program ?? '') &&
          (raw[0] === 3 || raw[0] === 12)
        ) {
          if (raw.length !== (raw[0] === 12 ? 10 : 9)) fail('TOKEN_TRANSFER_LAYOUT');
          const from = accounts[0]!,
            to = accounts[raw[0] === 12 ? 2 : 1]!,
            amount = raw.readBigUInt64LE(1);
          let shadow = amount;
          if (pending?.transfers) {
            const expected = pending.transfers.find(
              (t) => !t.seen && t.from === from && t.to === to,
            );
            if (!expected || expected.real !== amount)
              fail(
                'PUMP_TRANSFER_MISMATCH:' +
                  signature +
                  ':' +
                  from +
                  ':' +
                  to +
                  ':' +
                  amount +
                  ':' +
                  expected?.real,
              );
            expected!.seen = true;
            shadow = expected!.shadow;
          } else if (pending && from === pending.swap!.source && to === pending.swap!.inputVault) {
            if (amount !== pending.swap!.input || pending.inputSeen) fail('SWAP_INPUT_MISMATCH');
            pending.inputSeen = true;
          } else if (
            pending &&
            from === pending.swap!.outputVault &&
            to === pending.swap!.destination
          ) {
            if (amount !== pending.realOut || pending.outputSeen) fail('SWAP_OUTPUT_MISMATCH');
            shadow = pending.simOut;
            pending.outputSeen = true;
          } else if (protectedAccounts.has(from) || protectedAccounts.has(to))
            fail('UNEXPLAINED_VAULT_TRANSFER');
          let net = amount,
            shadowNet = shadow;
          if (
            program === TOKEN_2022_PROGRAM_ID &&
            raw[0] === 3 &&
            tokenFees.has(native.mints.get(from) ?? '')
          )
            fail('TOKEN_2022_UNCHECKED_TRANSFER_UNSUPPORTED');
          if (program === TOKEN_2022_PROGRAM_ID && raw[0] === 12) {
            const mint = accounts[1]!,
              policy = tokenFees.get(mint);
            if (evidence.token2022 && !real.accounts[mint] && !policy)
              fail('TOKEN_2022_FEE_POLICY_MISSING:' + mint);
            if (policy) {
              if (
                raw.length !== 10 ||
                raw[9] !== policy.decimals ||
                [from, to].some((a) => native.mints.has(a) && native.mints.get(a) !== mint)
              )
                fail('TOKEN_2022_TRANSFER_BINDING');
              net = amount - policy.fee(amount, BigInt(epoch.epoch));
              shadowNet = shadow - policy.fee(shadow, BigInt(epoch.epoch));
              if (
                (net !== amount || shadowNet !== shadow) &&
                (protectedAccounts.has(from) || protectedAccounts.has(to))
              )
                fail('POOL_TRANSFER_FEES_UNSUPPORTED');
              token2022Transfers.push({
                signature,
                from,
                to,
                mint,
                gross: amount.toString(),
                net: net.toString(),
                withheld: (amount - net).toString(),
                shadowGross: shadow.toString(),
                shadowNet: shadowNet.toString(),
              });
            }
          }
          if (pending || BigInt(deltas[from] ?? '0') !== 0n || BigInt(deltas[to] ?? '0') !== 0n) {
            applyTransfer(from, to, amount, shadow, net, shadowNet);
          } else if (actual.has(from)) {
            if (actual.get(from)! < amount) fail('TRANSFER_INPUT_EVIDENCE_MISSING');
            native.tokenTransfer(from, to, amount, amount);
            actual.set(from, actual.get(from)! - amount);
            actual.set(to, (actual.get(to) ?? 0n) + net);
            adjustments.set(from, (adjustments.get(from) ?? 0n) - amount);
            adjustments.set(to, (adjustments.get(to) ?? 0n) + net);
          }
        } else if (
          !nativeHandled &&
          [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(program ?? '') &&
          accounts.some(
            (a) =>
              BigInt(deltas[a] ?? '0') !== 0n || BigInt(deltas[WITHHELD_PREFIX + a] ?? '0') !== 0n,
          )
        )
          fail('TRACKED_INVENTORY_MUTATION_UNSUPPORTED');
      }
      finalize();
      native.verify(actual);
      // Provider balance effects must agree for every transfer we used, including upstream funding.
      for (const [address, delta] of adjustments) {
        const pre = t.meta.preTokenBalances.find((x) => keys[x.accountIndex] === address),
          post = t.meta.postTokenBalances.find((x) => keys[x.accountIndex] === address);
        if (
          pre &&
          post &&
          BigInt(post.uiTokenAmount.amount) - BigInt(pre.uiTokenAmount.amount) !== delta
        )
          fail('TRANSACTION_TOKEN_EFFECTS_UNRECONCILED:' + signature + ':' + address);
      }
    }
  }
  if (parent !== evidence.after.slot) fail('END_FRONTIER_MISSING');
  // All non-Clock accounts must reconcile exactly, not just token outputs or price.
  for (const a of protectedAccounts)
    if (digest(real.accounts[a]) !== digest(evidence.after.accounts[a]))
      fail('REAL_CHECKPOINT_MISMATCH:' + a);
  real = structuredClone(evidence.after);
  // Only replace the verified Clock/time metadata. Reserves and impact remain simulated.
  sim = {
    ...sim,
    slot: real.slot,
    observedAt: real.observedAt,
    accounts: { ...sim.accounts, [CLOCK]: structuredClone(real.accounts[CLOCK]!) },
  };
  return {
    branch: {
      ...structuredClone(branch),
      real,
      simulated: sim,
      inventoryDeltas: Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== '0')),
      ...(Object.keys(nativeReserves).length ? { nativeReserves } : {}),
      intervals: [...branch.intervals, hash],
    },
    events,
    failedTransactions,
    token2022Transfers,
    hash,
    replay: false,
  };
}
