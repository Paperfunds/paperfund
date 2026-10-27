/** Finalized read-only connector. Historical cutoff banks must be retained, never approximated. */
import { mkdir, readFile, writeFile, link, unlink, readdir } from 'node:fs/promises';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { EPOCH_SCHEDULE_ACCOUNT, CLOCK_ACCOUNT, epochProgression, type EpochWitness } from '../../../../packages/protocols/isolated/linked-pair/epoch-flow.js';
const compress = promisify(gzip), inflate = promisify(gunzip);
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {cutoffCaptureContext} from '../../../../packages/protocols/src/cutoff-capture.js';
import {
  requiredTokenFeeMints,
  feePolicies,
  type Token2022Evidence,
} from '../../../../packages/protocols/isolated/linked-pair/token-2022-flow.js';
import {
  digest,
  retainProviderInterval,
  serializeProviderInterval,
  freezeProviderDocument,
  type ProviderInterval,
} from '../../../../packages/protocols/isolated/linked-pair/external-flow.js';
import { linkedBindings } from '../../../../packages/protocols/isolated/linked-pair/shared-bridge.js';
import type { Stage1Snapshot } from '../../../../packages/protocols/src/experimental/non-sol-pump-swap.js';
import type { CutoffFrontier } from '../../../../packages/db/isolated/linked-pair/cutoff.js';
import {
  advisoryReadContext,
  rpcProviderIdentity,
  type AdvisoryReadContext,
} from '../../../../packages/protocols/src/rpc-read-context.js';
const CLOCK = 'SysvarC1ock11111111111111111111111111111111';
const timing = (name: string, start: number, detail: Record<string, string | number | undefined>) => {
  performance.measure(name, { start, detail });
  performance.clearMeasures(name);
};
const fail = (m: string): never => {
  throw Error('LINKED_CONNECTOR_' + m);
};
type Block = ProviderInterval['blocks'][number]['result'];
export interface ReadOnlyRpc {
  readonly providerIdentity?:string;
  call<T>(method: string, params: unknown[]): Promise<T>;
}
export class FinalizedRpc implements ReadOnlyRpc {
  get providerIdentity(){return rpcProviderIdentity(this.url);}
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 15000,
  ) {}
  async call<T>(method: string, params: unknown[]): Promise<T> {
    const cutoffCapture=cutoffCaptureContext();
    if(method==='getMultipleAccounts'&&cutoffCapture?.commitment==='confirmed')params=[params[0],{...(params[1] as Record<string,unknown>),commitment:'confirmed'}];
    if (!['getMultipleAccounts', 'getSlot', 'getBlocks', 'getBlock', 'getTransaction', 'getTransactionsForAddress'].includes(method))
      fail('READ_ONLY_METHOD');
    const started = performance.now();
    const r = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    timing('linked.rpc.headers', started, { method });
    const decoding = performance.now();
    if (!r.ok) fail('HTTP_' + r.status);
    const text = await r.text();
    timing('linked.rpc.bodyRead', decoding, { method, bytes: Buffer.byteLength(text) });
    const parsing = performance.now();
    const v = JSON.parse(text) as { error?: { code: number }; result?: T };
    timing('linked.rpc.jsonParse', parsing, { method });
    timing('linked.rpc.bodyDecode', decoding, { method });
    if (v.error || v.result === undefined) fail('RPC_' + (v.error?.code ?? 'MISSING_RESULT'));
    return v.result!;
  }
}
function clock(s: Stage1Snapshot) {
  const a = s.accounts[CLOCK],
    b = Buffer.from(a?.base64 ?? '', 'base64');
  if (
    a?.owner !== 'Sysvar1111111111111111111111111111111111111' ||
    b.length !== 40 ||
    !Number.isSafeInteger(s.slot) ||
    b.readBigUInt64LE(0) !== BigInt(s.slot)
  )
    fail('CLOCK_CONTEXT');
  const seconds = Number(b.readBigInt64LE(32));
  if (!Number.isSafeInteger(seconds) || seconds < 0) fail('CLOCK_TIME');
  return seconds;
}
const bankKey = (s: Stage1Snapshot) =>
  digest({
    routes: linkedBindings(s),
    accounts: Object.keys(s.accounts).sort(),
    absent: s.absentAccounts,
  });
const bankValue = (s: Stage1Snapshot) => digest({ ...s, observedAt: '' });
/** Content-checked atomic files; safe for concurrent API/worker readers and process interruption. */
export class FinalizedBankArchive {
  constructor(
    readonly directory: string,
    readonly compressIntervals = false,
  ) {}
  async get<T>(key: string): Promise<T | null> {
    if (!/^[a-z0-9-]+$/.test(key)) fail('ARCHIVE_KEY');
    try {
      const reading = performance.now();
      let raw: string;
      try {
        raw = await readFile(join(this.directory, key + '.json'), 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || !this.compressIntervals) throw e;
        raw = (await inflate(await readFile(join(this.directory, key + '.json.gz')))).toString();
      }
      timing('linked.archive.readInflate', reading, { kind: key.split('-')[0] });
      const decoding = performance.now();
      const v = JSON.parse(raw) as {
        hash: string;
        document: T;
        serialization?: string;
        json?: string;
      };
      if (v.serialization !== undefined) {
        if (
          v.serialization !== 'JSON_BYTES_SHA256_V1' ||
          !key.startsWith('block-') ||
          typeof v.json !== 'string' ||
          createHash('sha256').update(v.json).digest('hex') !== v.hash
        )
          fail('ARCHIVE_HASH');
        const block = JSON.parse(v.json!) as T;
        timing('linked.archive.decode', decoding, { key });
        return block;
      }
      if (key.startsWith('interval-')) retainProviderInterval(v.document as ProviderInterval);
      if (digest(v.document) !== v.hash) fail('ARCHIVE_HASH');
      return v.document;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async put<T>(key: string, document: T) {
    const encoding = performance.now();
    await mkdir(this.directory, { recursive: true });
    if (!/^[a-z0-9-]+$/.test(key)) fail('ARCHIVE_KEY');
    const canonicalizing = performance.now();
    if (key.startsWith('interval-')) retainProviderInterval(document as ProviderInterval);
    timing('linked.archive.canonicalize', canonicalizing, { kind: key.split('-')[0] });
    const blockBytes = this.compressIntervals && key.startsWith('block-');
    const compressed = this.compressIntervals && (key.startsWith('interval-') || blockBytes),
      suffix = compressed ? '.json.gz' : '.json';
    const temp = join(this.directory, 'pending-' + randomUUID() + suffix),
      target = join(this.directory, key + suffix);
    // A block is an opaque complete RPC document. Hash its retained JSON bytes once;
    // interval/reconciliation hashes remain canonical and unchanged. No transactions are filtered.
    const serializing = performance.now();
    const json = blockBytes ? JSON.stringify(document) : undefined;
    const raw = blockBytes
      ? JSON.stringify({
          serialization: 'JSON_BYTES_SHA256_V1',
          hash: createHash('sha256').update(json!).digest('hex'),
          json,
        })
      : key.startsWith('interval-')
        ? '{"hash":"' + digest(document) + '","document":' + serializeProviderInterval(document as ProviderInterval) + '}'
        : JSON.stringify({ hash: digest(document), document });
    timing('linked.archive.serialize', serializing, {kind:key.split('-')[0],bytes:Buffer.byteLength(raw)});
    const compressing = performance.now();
    const encoded = compressed ? await compress(Buffer.from(raw), { level: 1 }) : raw;
    timing('linked.archive.compress', compressing, {kind:key.split('-')[0]});
    timing('linked.archive.encode', encoding, { kind: key.split('-')[0], bytes: Buffer.byteLength(encoded) });
    const writing = performance.now();
    await writeFile(temp, encoded, {
      flag: 'wx',
    });
    try {
      await link(temp, target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (digest(await this.get<T>(key)) !== digest(document)) fail('ARCHIVE_CONFLICT');
    } finally {
      await unlink(temp);
      timing('linked.archive.write', writing, { kind: key.split('-')[0] });
    }
  }
  async bank(s: Stage1Snapshot) {
    clock(s);
    const key = 'bank-' + bankKey(s) + '-' + s.slot,
      old = await this.get<Stage1Snapshot>(key);
    if (old) {
      if (bankValue(old) !== bankValue(s)) fail('BANK_CONFLICT');
      return old;
    }
    await this.put(key, s);
    return s;
  }
  async bankAt(anchor: Stage1Snapshot, slot: number) {
    return this.get<Stage1Snapshot>('bank-' + bankKey(anchor) + '-' + slot);
  }
  /** Retained atomic banks only. Never synthesize an intermediate provider state. */
  async nextBank(anchor: Stage1Snapshot, maxSpan = 8) {
    const prefix = 'bank-' + bankKey(anchor) + '-';
    const slots = (await readdir(this.directory))
      .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
      .map((f) => Number(f.slice(prefix.length, -5)))
      .filter((s) => Number.isSafeInteger(s) && s > anchor.slot)
      .sort((a, b) => a - b);
    const slot = slots.filter((s) => s <= anchor.slot + maxSpan).at(-1) ?? slots[0];
    return slot === undefined ? null : this.bankAt(anchor, slot);
  }
}
export class FinalizedFlowConnector {
  readonly maxSlots: number;
  readonly maxTransactions: number;
  // Advisory reads and execution can request the same immutable finalized evidence.
  // Share acquisition only; each consumer receives its own copy for replay.
  private readonly pendingBlocks = new Map<string, Promise<Block>>();
  private fullReads = 0;
  private readonly waitingReads: (() => void)[] = [];
  private readonly verifiedBlocks = new Map<string, Block>();
  // A finalized receipt cannot gain a missing historical token-balance entry on
  // retry. Keep this current-verifier rejection fail-closed until process restart;
  // do not repeatedly inflate hundreds of already verified block bodies.
  private readonly rejectedIntervals = new Map<string, Error>();
  readonly blockConcurrency: number;
  private readonly pendingIntervals = new Map<string, Promise<ProviderInterval>>();
  private readonly advisoryIntervals = new WeakMap<
    AdvisoryReadContext,
    Map<string, Promise<ProviderInterval | null>>
  >();
  constructor(
    readonly rpc: ReadOnlyRpc,
    readonly archive: FinalizedBankArchive,
    readonly now: () => number = Date.now,
    limits: { maxSlots?: number; maxTransactions?: number; blockConcurrency?: number } = {},
  ) {
    this.maxSlots = limits.maxSlots ?? 256;
    this.maxTransactions = limits.maxTransactions ?? 20000;
    this.blockConcurrency = limits.blockConcurrency ?? 4;
    if (
      !Number.isSafeInteger(this.maxSlots) ||
      this.maxSlots < 1 ||
      this.maxSlots > 2048 ||
      !Number.isSafeInteger(this.maxTransactions) ||
      this.maxTransactions < 1 || !Number.isSafeInteger(this.blockConcurrency) ||
      this.blockConcurrency < 1 || this.blockConcurrency > 8
    )
      fail('BOUNDS');
  }
  private async block(slot: number, full = true): Promise<Block> {
    const key = (full ? 'block-' : 'header-') + slot;
    const cached = this.verifiedBlocks.get(key);
    if (cached) return cached;
    let pending = this.pendingBlocks.get(key);
    if (!pending) {
      pending = this.acquireBlock(slot, full);
      this.pendingBlocks.set(key, pending);
    }
    try {
      const block = await pending;
      if (!this.archive.compressIntervals) return structuredClone(block);
      // Retained finalized documents are immutable. Reuse their verified bytes in
      // compressed archives; never clone/redecode megabytes for each consumer.
      freezeProviderDocument(block);
      this.verifiedBlocks.set(key, block);
      if (this.verifiedBlocks.size > 64) this.verifiedBlocks.delete(this.verifiedBlocks.keys().next().value!);
      return block;
    } finally {
      if (this.pendingBlocks.get(key) === pending) this.pendingBlocks.delete(key);
    }
  }
  private async acquireBlock(slot: number, full: boolean): Promise<Block> {
    const key = (full ? 'block-' : 'header-') + slot,
      old = await this.archive.get<Block>(key);
    if (old) return old;
    // Prefetch and interval consumers share one network budget, not two worker pools.
    if (this.fullReads >= this.blockConcurrency)
      await new Promise<void>(resolve => this.waitingReads.push(resolve));
    else this.fullReads++;
    let b: Block | null;
    try { b = await this.rpc.call<Block | null>('getBlock', [
      slot,
      {
        commitment: 'finalized',
        encoding: 'json',
        transactionDetails: full ? 'full' : 'none',
        rewards: false,
        maxSupportedTransactionVersion: 1,
      },
    ]); } finally {
      const next = this.waitingReads.shift(); if (next) next(); else this.fullReads--;
    }
    if (
      !b ||
      !b.blockhash ||
      !b.previousBlockhash ||
      !Number.isSafeInteger(b.parentSlot) ||
      !Number.isSafeInteger(b.blockTime) ||
      (full && !Array.isArray(b.transactions))
    )
      fail('BLOCK_UNAVAILABLE');
    if (!b) return fail('BLOCK_UNAVAILABLE');
    const header = await this.archive.get<Block>('header-' + slot);
    if (
      header &&
      (header.blockhash !== b.blockhash ||
        header.parentSlot !== b.parentSlot ||
        header.blockTime !== b.blockTime ||
        header.previousBlockhash !== b.previousBlockhash)
    )
      fail('BLOCK_FORK');
    await this.archive.put(key, b);
    return b;
  }
  /** Acquire complete bodies ahead of ordered commits. This never publishes an interval or advances state. */
  async prefetch(anchor: Stage1Snapshot, after: Stage1Snapshot) {
    if (bankKey(anchor) !== bankKey(after) || after.slot < anchor.slot) fail('PREFETCH_TOPOLOGY');
    const end = Math.min(after.slot, anchor.slot + Math.min(this.maxSlots, 128));
    if (end === anchor.slot) return;
    const slots = await this.rpc.call<number[]>('getBlocks', [anchor.slot + 1, end, {commitment:'finalized'}]);
    if (!Array.isArray(slots) || slots.some((s,i)=>!Number.isSafeInteger(s)||s<=anchor.slot||s>end||(i>0&&s<=slots[i-1]!)))
      fail('PREFETCH_SLOTS');
    let index = 0, failed: unknown;
    await Promise.all(Array.from({length:Math.min(this.blockConcurrency,slots.length)},async()=>{
      while(index<slots.length && !failed){const slot=slots[index++]!;try{await this.block(slot)}catch(e){failed=e}}
    }));
    if(failed)throw failed;
  }
  /** One atomic <=100-account bank, up to three whole-read attempts; never merge mismatched contexts. */
  async observe(anchor: Stage1Snapshot) {
    return this.capture(anchor);
  }
  /** Archive a finalized pre-cutoff bank even when finality arrives after the wall-clock boundary.
   * This never makes it eligible for a normal fill; sealing still requires the exact two-block frontier. */
  async captureCutoffBank(anchor: Stage1Snapshot, cutoff: Date) {
    const ms = cutoff.getTime();
    if (!Number.isFinite(ms) || ms % 3600000 !== 0 || this.now() < ms) fail('UTC_CUTOFF');
    return this.capture(anchor, cutoff);
  }
  private async capture(anchor: Stage1Snapshot, cutoff?: Date) {
    const captureStarted = performance.now();
    clock(anchor);
    const addresses = [
      ...new Set([...Object.keys(anchor.accounts), ...anchor.absentAccounts]),
    ].sort();
    if (addresses.length > 100) fail('ATOMIC_DEPENDENCY_LIMIT');
    type Raw = { owner: string; lamports: number; data: [string, string] };
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = await this.rpc.call<{ context: { slot: number }; value: (Raw | null)[] }>(
        'getMultipleAccounts',
        [addresses, { commitment: 'finalized', encoding: 'base64', minContextSlot: anchor.slot }],
      );
      if (
        !raw ||
        !Number.isSafeInteger(raw.context?.slot) ||
        raw.context.slot < anchor.slot ||
        raw.value?.length !== addresses.length
      )
        fail('BANK_SHAPE');
      const accounts: Stage1Snapshot['accounts'] = {};
      for (const [i, address] of addresses.entries()) {
        const a = raw.value[i];
        if (anchor.absentAccounts.includes(address)) {
          if (a !== null) fail('UNRESOLVED_DEPENDENCY_APPEARED');
          continue;
        }
        if (!a || a.data?.[1] !== 'base64' || typeof a.owner !== 'string')
          fail('DEPENDENCY_MISSING');
        const was = anchor.accounts[address]! as Stage1Snapshot['accounts'][string] & {
          lamports?: string;
        };
        if (was.lamports !== undefined && (!Number.isSafeInteger(a!.lamports) || a!.lamports < 0))
          fail('UNSAFE_NATIVE_BALANCE');
        accounts[address] = {
          owner: a!.owner,
          base64: a!.data[0],
          ...(was.lamports !== undefined ? { lamports: String(a!.lamports) } : {}),
        };
      }
      const s = { ...structuredClone(anchor), slot: raw.context.slot, accounts };
      try {
        s.observedAt = new Date(clock(s) * 1000).toISOString();
      } catch (e) {
        if (attempt < 2 && String(e).includes('CLOCK_CONTEXT')) continue;
        throw e;
      }
      const reference = cutoff?.getTime() ?? this.now();
      if (
        reference < Date.parse(s.observedAt) ||
        reference - Date.parse(s.observedAt) > 10000 ||
        (cutoff && reference === Date.parse(s.observedAt))
      )
        fail('STALE_BANK');
      const bank = await this.archive.bank(s);
      // Retain canonical block identity at capture, not a caller-supplied finality assertion.
      const b = await this.block(s.slot, false);
      if (b.blockTime !== clock(s)) fail('BANK_BLOCK_TIME');
      timing('linked.capture.dependencies', captureStarted, { slot: s.slot, accounts: addresses.length });
      return bank;
    }
    return fail('COHERENT_BANK_UNAVAILABLE');
  }
  async interval(anchor: Stage1Snapshot, end?: Stage1Snapshot): Promise<ProviderInterval | null> {
    const read = advisoryReadContext();
    if (!read || end) return this.readInterval(anchor, end);
    read.signal.throwIfAborted();
    let intervals = this.advisoryIntervals.get(read);
    if (!intervals) {
      intervals = new Map();
      this.advisoryIntervals.set(read, intervals);
    }
    const key = digest(anchor);
    let acquired = intervals.get(key);
    if (!acquired) {
      acquired = this.readInterval(anchor);
      intervals.set(key, acquired);
    }
    const interval = await acquired;
    read.signal.throwIfAborted();
    // Discovery, canonical resolution and adapter loading must use one bank in
    // the same advisory operation. Callers still enforce their unchanged age
    // policy. A different request, anchor or explicit cutoff gets a fresh read.
    return this.archive.compressIntervals ? interval : structuredClone(interval);
  }
  private async readInterval(
    anchor: Stage1Snapshot,
    end?: Stage1Snapshot,
  ): Promise<ProviderInterval | null> {
    clock(anchor);
    const after = end ?? (await this.observe(anchor));
    clock(after);
    if (bankKey(anchor) !== bankKey(after)) fail('TOPOLOGY_CHANGED');
    if (after.slot === anchor.slot) {
      if (bankValue(after) !== bankValue(anchor)) fail('SAME_SLOT_CHANGED');
      return null;
    }
    if (after.slot < anchor.slot || after.slot - anchor.slot > this.maxSlots)
      fail('INTERVAL_BOUND');
    const epochChanged = !Buffer.from(anchor.accounts[CLOCK]!.base64,'base64').subarray(8,32)
      .equals(Buffer.from(after.accounts[CLOCK]!.base64,'base64').subarray(8,32));
    // Old immutable intervals are never rewritten to attach newly acquired proofs.
    const packetKey = (epochChanged ? 'interval-epoch-v1-' : 'interval-fee-v1-') + digest(anchor) + '-' + digest(after);
    let pending = this.pendingIntervals.get(packetKey);
    if (!pending) {
      pending = this.acquireInterval(anchor, after, packetKey);
      this.pendingIntervals.set(packetKey, pending);
    }
    try {
      const interval = await pending;
      return this.archive.compressIntervals ? interval : structuredClone(interval);
    } finally {
      if (this.pendingIntervals.get(packetKey) === pending) this.pendingIntervals.delete(packetKey);
    }
  }
  private async acquireInterval(
    anchor: Stage1Snapshot,
    after: Stage1Snapshot,
    packetKey: string,
  ): Promise<ProviderInterval> {
    const rejected = this.rejectedIntervals.get(packetKey);
    if (rejected) {
      timing('linked.acquire.rejectedReuse', performance.now(), { from: anchor.slot, to: after.slot });
      throw rejected;
    }
    const retained = await this.archive.get<ProviderInterval>(packetKey);
    if (retained) return retained;
    const slots = await this.rpc.call<number[]>('getBlocks', [
      anchor.slot + 1,
      after.slot,
      { commitment: 'finalized' },
    ]);
    if (
      !Array.isArray(slots) ||
      slots.length > this.maxSlots ||
      slots.at(-1) !== after.slot ||
      slots.some(
        (s, i) =>
          !Number.isSafeInteger(s) ||
          s <= anchor.slot ||
          s > after.slot ||
          (i > 0 && s <= slots[i - 1]!),
      )
    )
      fail('INCOMPLETE_SLOTS');
    const anchorBlock = await this.block(anchor.slot, false),
      blocks: ProviderInterval['blocks'] = [];
    let previous = anchorBlock,
      parent = anchor.slot,
      count = 0;
    // Bounded sliding acquisition: a slow response must not stall the next group.
    // Validate/replay in chain order,
    // irrespective of network completion order; never omit a failed block.
    const acquiring = performance.now();
    const batch: PromiseSettledResult<Block>[] = new Array(slots.length);
    let next = 0, acquisitionFailed = false;
    await Promise.all(Array.from({length: Math.min(this.blockConcurrency, slots.length)}, async () => {
      while (next < slots.length && !acquisitionFailed) {
        const index = next++;
        try { batch[index] = {status:'fulfilled',value:await this.block(slots[index]!)}; }
        catch (reason) { batch[index] = {status:'rejected',reason}; acquisitionFailed = true; }
      }
    }));
    timing('linked.acquire.blocks', acquiring, { slots: slots.length, concurrency: this.blockConcurrency });
      for (const [index, result] of batch.entries()) {
        if (result.status === 'rejected') throw result.reason;
        const slot = slots[index]!,
          b = result.value;
        if (
          b.parentSlot !== parent ||
          b.previousBlockhash !== previous.blockhash ||
          b.blockTime < previous.blockTime
        )
          fail('BLOCK_FRONTIER_GAP');
        count += b.transactions.length;
        if (count > this.maxTransactions) fail('TRANSACTION_BOUND');
        blocks.push({ slot, result: b });
        previous = b;
        parent = slot;
      }
    if (previous.blockTime !== clock(after)) fail('END_BANK_TIME');
    let epochWitness: EpochWitness | undefined;
    const priorClock = Buffer.from(anchor.accounts[CLOCK_ACCOUNT]!.base64,'base64'),
      endClock = Buffer.from(after.accounts[CLOCK_ACCOUNT]!.base64,'base64');
    if (!priorClock.subarray(8,32).equals(endClock.subarray(8,32))) {
      for(let attempt=0;attempt<3;attempt++){
        const r=await this.rpc.call<{context:{slot:number};value:({owner:string;data:[string,string]}|null)[]}>('getMultipleAccounts',[
          [CLOCK_ACCOUNT,EPOCH_SCHEDULE_ACCOUNT],{commitment:'finalized',encoding:'base64',minContextSlot:after.slot}]);
        if(!r||r.value?.length!==2||r.value.some(a=>!a||a.data?.[1]!=='base64'))fail('EPOCH_WITNESS_SHAPE');
        const witness:EpochWitness={schema:'FINALIZED_EPOCH_SCHEDULE_V1',contextSlot:r.context?.slot,
          clock:{owner:r.value[0]!.owner,base64:r.value[0]!.data[0]},schedule:{owner:r.value[1]!.owner,base64:r.value[1]!.data[0]}};
        try{epochProgression(anchor,after,blocks,witness);epochWitness=witness;break}
        catch(e){if(attempt<2&&String(e).includes('EPOCH_CLOCK_CONTEXT'))continue;throw e}
      }
      if(!epochWitness)fail('EPOCH_WITNESS_MISSING');
    }
    const policiesStarted = performance.now();
    const mints = requiredTokenFeeMints(anchor, blocks);
    let token2022: Token2022Evidence | undefined;
    if (mints.length) {
      if (mints.length > 99) fail('TOKEN_FEE_ATOMIC_LIMIT');
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await this.rpc.call<{
          context: { slot: number };
          value: ({ owner: string; data: [string, string] } | null)[];
        }>('getMultipleAccounts', [
          [...mints, CLOCK],
          { commitment: 'finalized', encoding: 'base64', minContextSlot: after.slot },
        ]);
        if (
          !response ||
          !Number.isSafeInteger(response.context?.slot) ||
          response.context.slot < after.slot ||
          response.value?.length !== mints.length + 1 ||
          response.value.some((a) => !a || a.data[1] !== 'base64')
        )
          fail('TOKEN_FEE_WITNESS_SHAPE');
        const ca = response.value.at(-1)!;
        if (!ca) fail('TOKEN_FEE_CLOCK_MISSING');
        const raw = Buffer.from(ca!.data[0], 'base64');
        if (raw.length !== 40 || raw.readBigUInt64LE(0) !== BigInt(response.context.slot)) {
          if (attempt < 2) continue;
          fail('TOKEN_FEE_CLOCK_CONTEXT');
        }
        token2022 = {
          schema: 'TOKEN_2022_FEE_SCHEDULE_WITNESS_V1',
          contextSlot: response.context.slot,
          clock: { owner: ca!.owner, base64: ca!.data[0] },
          mints: Object.fromEntries(
            mints.map((m, i) => [
              m,
              { owner: response.value[i]!.owner, base64: response.value[i]!.data[0] },
            ]),
          ),
        };
        try { feePolicies(token2022, anchor, after, blocks, epochWitness); }
        catch (error) {
          if (error instanceof Error && error.message === 'TOKEN_2022_TRANSPARENT_BALANCE_COVERAGE') {
            this.rejectedIntervals.set(packetKey, error);
            if (this.rejectedIntervals.size > 32) this.rejectedIntervals.delete(this.rejectedIntervals.keys().next().value!);
          }
          throw error;
        }
        break;
      }
      if (!token2022) fail('TOKEN_FEE_WITNESS_MISSING');
    }
    timing('linked.acquire.feePolicies', policiesStarted, { mints: mints.length });
    const interval: ProviderInterval = {
      schema: 'LINKED_RETAINED_RPC_INTERVAL_V1',
      commitment: 'finalized',
      acquiredAt: new Date(this.now()).toISOString(),
      ...(token2022 ? { token2022 } : {}),
      ...(epochWitness ? { epochWitness } : {}),
      before: structuredClone(anchor),
      after: structuredClone(after),
      slots,
      anchor: { blockhash: anchorBlock.blockhash },
      blocks,
    };
    await this.archive.put(packetKey, interval);
    return interval;
  }
  async cutoffFrontier(anchor: Stage1Snapshot, cutoff: Date): Promise<CutoffFrontier> {
    const ms = cutoff.getTime();
    if (!Number.isFinite(ms) || ms % 3600000 !== 0 || this.now() < ms) fail('UTC_CUTOFF');
    const tip = await this.rpc.call<number>('getSlot', [{ commitment: 'finalized' }]);
    if (!Number.isSafeInteger(tip) || tip < anchor.slot || tip - anchor.slot > this.maxSlots)
      fail('CUTOFF_BOUND');
    const slots = await this.rpc.call<number[]>('getBlocks', [
      anchor.slot,
      tip,
      { commitment: 'finalized' },
    ]);
    if (!Array.isArray(slots) || slots[0] !== anchor.slot || slots.length > this.maxSlots + 1)
      fail('CUTOFF_SLOTS');
    let last = await this.block(anchor.slot, false),
      lastSlot = anchor.slot;
    if (last.blockTime * 1000 >= ms) fail('ANCHOR_AFTER_CUTOFF');
    for (const slot of slots.slice(1)) {
      const next = await this.block(slot, false);
      if (
        slot <= lastSlot ||
        next.parentSlot !== lastSlot ||
        next.previousBlockhash !== last.blockhash ||
        next.blockTime < last.blockTime
      )
        fail('CUTOFF_FRONTIER_GAP');
      if (next.blockTime * 1000 >= ms) {
        const bank =
          lastSlot === anchor.slot ? anchor : await this.archive.bankAt(anchor, lastSlot);
        if (!bank) return fail('EXACT_CUTOFF_BANK_NOT_RETAINED');
        if (clock(bank) !== last.blockTime || ms - last.blockTime * 1000 > 10000)
          fail('CUTOFF_BANK_TIME');
        return {
          schema: 'LINKED_UTC_FRONTIER_V1',
          commitment: 'finalized',
          last: { slot: lastSlot, blockhash: last.blockhash, blockTime: last.blockTime },
          next: {
            slot,
            parentSlot: next.parentSlot,
            previousBlockhash: next.previousBlockhash,
            blockhash: next.blockhash,
            blockTime: next.blockTime,
          },
          interval: await this.interval(anchor, bank),
        };
      }
      last = next;
      lastSlot = slot;
    }
    return fail('CUTOFF_NOT_FINALIZED');
  }
}
