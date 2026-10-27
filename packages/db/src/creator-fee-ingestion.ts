import { safeErrorMessage } from '@paperfund/core';
import { createHash } from 'node:crypto';

import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID, WRAPPED_SOL_MINT } from '@paperfund/protocols';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

import type { DatabaseService } from './database.js';
import {
  FixtureCreatorFeeSource,
  ingestCreatorFeeEvents,
  type CreatorFeeSource,
  type VerifiedCreatorFeeEvent,
} from './reward-service.js';

const PUMP_TRADE_EVENT = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
const PUMP_BUY = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const PUMP_BUY_EXACT_SOL_IN = Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]);
const PUMP_SELL = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
const PUMP_BUY_V2 = Buffer.from([184, 23, 238, 97, 103, 197, 211, 61]);
const PUMP_BUY_EXACT_QUOTE_IN_V2 = Buffer.from([194, 171, 28, 70, 104, 77, 91, 47]);
const PUMP_SELL_V2 = Buffer.from([93, 246, 130, 60, 231, 233, 64, 178]);
// Official pump-public-docs IDL pin: 7616681ea557975f9f623ac211080f22a93060781eaf4765b0a488d980997207.
const PUMP_BUY_V3 = Buffer.from([7, 5, 29, 196, 245, 23, 101, 80]);
const PUMP_BUY_EXACT_QUOTE_IN_V3 = Buffer.from([225, 247, 80, 30, 213, 179, 132, 136]);
const PUMP_SELL_V3 = Buffer.from([28, 146, 222, 119, 38, 196, 105, 213]);
const PUMP_AMM_BUY_EVENT = Buffer.from([103, 244, 82, 31, 44, 245, 119, 119]);
const PUMP_AMM_SELL_EVENT = Buffer.from([62, 47, 55, 10, 165, 3, 220, 42]);
const PUMP_AMM_BUY_EXACT_QUOTE_IN = Buffer.from([198, 46, 21, 82, 180, 217, 232, 112]);
const NATIVE_SOL_QUOTE = '11111111111111111111111111111111';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

function programAddress(seeds: readonly (string | Buffer)[], programId: string) {
  return PublicKey.findProgramAddressSync(
    seeds.map((seed) => (typeof seed === 'string' ? new PublicKey(seed).toBuffer() : seed)),
    new PublicKey(programId),
  )[0].toBase58();
}

export type ChainConfirmationStatus = 'processed' | 'confirmed' | 'finalized';

export interface CreatorFeeFundingIdentity {
  readonly tokenMint: string;
  readonly creatorWallet: string;
}

export interface SignatureRecord {
  readonly signature: string;
  readonly slot: number;
  readonly err: unknown | null;
  readonly blockTime: number | null;
  readonly confirmationStatus?: ChainConfirmationStatus | null;
}

export interface SignatureStatusRecord {
  readonly slot: number;
  readonly err: unknown | null;
  readonly confirmationStatus?: ChainConfirmationStatus | null;
}

interface CompiledInstruction {
  readonly programIdIndex: number;
  readonly accounts: readonly number[];
  readonly data: string;
}

export interface CreatorFeeTransaction {
  readonly slot: number;
  readonly blockTime: number | null;
  readonly meta: {
    readonly err: unknown | null;
    readonly logMessages: readonly string[] | null;
    readonly loadedAddresses?: {
      readonly writable: readonly string[];
      readonly readonly: readonly string[];
    };
    readonly innerInstructions?: readonly {
      readonly index: number;
      readonly instructions: readonly CompiledInstruction[];
    }[];
  } | null;
  readonly transaction: {
    readonly message: {
      readonly accountKeys: readonly (string | { readonly pubkey: string })[];
      readonly instructions: readonly CompiledInstruction[];
    };
  };
}

export interface ReadOnlySolanaRpc {
  getSignaturesForAddress(
    address: string,
    options: { readonly before?: string; readonly until?: string; readonly limit: number },
  ): Promise<readonly SignatureRecord[]>;
  getTransaction(signature: string): Promise<CreatorFeeTransaction | null>;
  getSignatureStatuses(
    signatures: readonly string[],
  ): Promise<readonly (SignatureStatusRecord | null)[]>;
  getSlot(commitment: 'finalized'): Promise<number>;
}

export class CreatorFeeIngestionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class Reader {
  #offset = 8;
  constructor(private readonly value: Buffer) {}
  u8() {
    this.ensure(1);
    return this.value[this.#offset++]!;
  }
  u16() {
    this.ensure(2);
    const result = this.value.readUInt16LE(this.#offset);
    this.#offset += 2;
    return result;
  }
  u32() {
    this.ensure(4);
    const result = this.value.readUInt32LE(this.#offset);
    this.#offset += 4;
    return result;
  }
  u64() {
    this.ensure(8);
    const result = this.value.readBigUInt64LE(this.#offset);
    this.#offset += 8;
    return result;
  }
  i64() {
    this.ensure(8);
    const result = this.value.readBigInt64LE(this.#offset);
    this.#offset += 8;
    return result;
  }
  i128() {
    this.ensure(16);
    this.#offset += 16;
  }
  publicKey() {
    this.ensure(32);
    const result = bs58.encode(this.value.subarray(this.#offset, this.#offset + 32));
    this.#offset += 32;
    return result;
  }
  string() {
    const length = this.u32();
    this.ensure(length);
    const result = this.value.subarray(this.#offset, this.#offset + length).toString('utf8');
    this.#offset += length;
    return result;
  }
  private ensure(length: number) {
    if (this.#offset + length > this.value.length) {
      throw new CreatorFeeIngestionError('MALFORMED_EVENT', 'Creator-fee event is truncated.');
    }
  }
}

interface DecodedEvent {
  readonly sourceProgram: string;
  readonly tokenMint: string;
  readonly creatorWallet: string;
  readonly creatorFeeLamports: bigint;
  readonly protocolEventTimestamp: bigint;
  readonly instructionName: string;
  readonly pool?: string;
  readonly user?: string;
  readonly quoteMint?: string;
  readonly holderRewardsBps: bigint;
  readonly holderRewardsLamports: bigint;
  readonly cashbackLamports: bigint;
}

function decodePumpEvent(data: Buffer): DecodedEvent {
  const value = new Reader(data);
  const tokenMint = value.publicKey();
  value.u64();
  value.u64();
  value.u8();
  const user = value.publicKey();
  const timestamp = value.i64();
  value.u64();
  value.u64();
  value.u64();
  value.u64();
  value.publicKey();
  value.u64();
  value.u64();
  const creatorWallet = value.publicKey();
  value.u64();
  const creatorFeeLamports = value.u64();
  value.u8();
  value.u64();
  value.u64();
  value.u64();
  value.i64();
  const instructionName = value.string();
  value.u8();
  value.u64();
  const cashbackLamports = value.u64();
  value.u64();
  value.u64();
  const shareholders = value.u32();
  for (let index = 0; index < shareholders; index += 1) {
    value.publicKey();
    value.u16();
  }
  const quoteMint = value.publicKey();
  value.u64();
  value.u64();
  value.u64();
  const holderRewardsBps = value.u64();
  const holderRewardsLamports = value.u64();
  if (quoteMint !== WRAPPED_SOL_MINT && quoteMint !== NATIVE_SOL_QUOTE) {
    throw new CreatorFeeIngestionError('UNSUPPORTED_QUOTE_MINT', 'Pump trade quote is not SOL.');
  }
  return {
    sourceProgram: PUMP_PROGRAM_ID,
    user,
    quoteMint,
    tokenMint,
    creatorWallet,
    creatorFeeLamports,
    protocolEventTimestamp: timestamp,
    instructionName,
    holderRewardsBps,
    holderRewardsLamports,
    cashbackLamports,
  };
}

function decodePumpSwapEvent(data: Buffer, kind: 'buy' | 'sell'): DecodedEvent {
  const value = new Reader(data);
  const timestamp = value.i64();
  for (let index = 0; index < 13; index += 1) value.u64();
  const pool = value.publicKey();
  value.publicKey();
  value.publicKey();
  value.publicKey();
  value.publicKey();
  value.publicKey();
  const creatorWallet = value.publicKey();
  value.u64();
  const creatorFeeLamports = value.u64();
  if (kind === 'buy') {
    value.u8();
    value.u64();
    value.u64();
    value.u64();
    value.i64();
    value.u64();
    value.string();
  }
  value.u64();
  const cashbackLamports = value.u64();
  value.u64();
  value.u64();
  value.i128();
  value.u8();
  value.u64();
  const holderRewardsBps = value.u64();
  const holderRewardsLamports = value.u64();
  return {
    sourceProgram: PUMP_AMM_PROGRAM_ID,
    tokenMint: '',
    creatorWallet,
    creatorFeeLamports,
    protocolEventTimestamp: timestamp,
    instructionName: kind,
    pool,
    holderRewardsBps,
    holderRewardsLamports,
    cashbackLamports,
  };
}

function accountKeys(transaction: CreatorFeeTransaction): readonly string[] {
  const staticKeys = transaction.transaction.message.accountKeys.map((key) =>
    typeof key === 'string' ? key : key.pubkey,
  );
  const loaded = transaction.meta?.loadedAddresses;
  return [...staticKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])];
}

function allInstructions(transaction: CreatorFeeTransaction): readonly CompiledInstruction[] {
  return [
    ...transaction.transaction.message.instructions,
    ...(transaction.meta?.innerInstructions?.flatMap((group) => group.instructions) ?? []),
  ];
}

function discriminatorIs(data: string, expected: Buffer): boolean {
  try {
    return Buffer.from(bs58.decode(data)).subarray(0, 8).equals(expected);
  } catch {
    return false;
  }
}

function bindEventToInstruction(
  event: DecodedEvent,
  transaction: CreatorFeeTransaction,
): DecodedEvent | null {
  const keys = accountKeys(transaction);
  for (const instruction of allInstructions(transaction)) {
    const program = keys[instruction.programIdIndex];
    if (program !== event.sourceProgram) continue;
    if (program === PUMP_PROGRAM_ID) {
      const isSell = discriminatorIs(instruction.data, PUMP_SELL);
      const isV2 =
        discriminatorIs(instruction.data, PUMP_BUY_V2) ||
        discriminatorIs(instruction.data, PUMP_BUY_EXACT_QUOTE_IN_V2) ||
        discriminatorIs(instruction.data, PUMP_SELL_V2);
      const isTrade =
        discriminatorIs(instruction.data, PUMP_BUY) ||
        discriminatorIs(instruction.data, PUMP_BUY_EXACT_SOL_IN) ||
        isSell ||
        isV2;
      const isV3 = discriminatorIs(instruction.data, PUMP_BUY_V3) || discriminatorIs(instruction.data, PUMP_BUY_EXACT_QUOTE_IN_V3) || discriminatorIs(instruction.data, PUMP_SELL_V3);
      if (isV3) {
        const curve = programAddress([Buffer.from('bonding-curve'), event.tokenMint], PUMP_PROGRAM_ID);
        const quote = keys[instruction.accounts[2]!];
        const quoteProgram = keys[instruction.accounts[4]!];
        const associatedQuote = quote && quoteProgram ? programAddress([curve, quoteProgram, quote], ASSOCIATED_TOKEN_PROGRAM_ID) : '';
        if (keys[instruction.accounts[1]!] === event.tokenMint && quote === WRAPPED_SOL_MINT &&
            (event.quoteMint === WRAPPED_SOL_MINT || event.quoteMint === NATIVE_SOL_QUOTE) &&
            keys[instruction.accounts[5]!] === curve && keys[instruction.accounts[7]!] === associatedQuote &&
            keys[instruction.accounts[8]!] === event.user) return event;
        continue;
      }
      const creatorVaultIndex = isSell ? 8 : 9;
      const expectedCreatorVault = programAddress(
        [Buffer.from('creator-vault'), event.creatorWallet],
        PUMP_PROGRAM_ID,
      );
      if (isV2) {
        const quoteMint = keys[instruction.accounts[2]!];
        const quoteTokenProgram = keys[instruction.accounts[4]!];
        const expectedAssociatedCreatorVault =
          quoteMint && quoteTokenProgram
            ? programAddress(
                [expectedCreatorVault, quoteTokenProgram, quoteMint],
                ASSOCIATED_TOKEN_PROGRAM_ID,
              )
            : '';
        if (
          keys[instruction.accounts[1]!] === event.tokenMint &&
          quoteMint === WRAPPED_SOL_MINT &&
          keys[instruction.accounts[16]!] === expectedCreatorVault &&
          keys[instruction.accounts[17]!] === expectedAssociatedCreatorVault
        ) {
          return event;
        }
        continue;
      }
      if (
        isTrade &&
        keys[instruction.accounts[2]!] === event.tokenMint &&
        keys[instruction.accounts[creatorVaultIndex]!] === expectedCreatorVault
      ) {
        return event;
      }
    } else {
      const isTrade =
        discriminatorIs(instruction.data, PUMP_BUY) ||
        discriminatorIs(instruction.data, PUMP_AMM_BUY_EXACT_QUOTE_IN) ||
        discriminatorIs(instruction.data, PUMP_SELL);
      if (
        isTrade &&
        keys[instruction.accounts[0]!] === event.pool &&
        keys[instruction.accounts[4]!] === WRAPPED_SOL_MINT
      ) {
        const quoteTokenProgram = keys[instruction.accounts[12]!];
        const expectedAuthority = programAddress(
          [Buffer.from('creator_vault'), event.creatorWallet],
          PUMP_AMM_PROGRAM_ID,
        );
        const expectedVault = quoteTokenProgram
          ? programAddress(
              [expectedAuthority, quoteTokenProgram, WRAPPED_SOL_MINT],
              ASSOCIATED_TOKEN_PROGRAM_ID,
            )
          : '';
        if (
          keys[instruction.accounts[17]!] === expectedVault &&
          keys[instruction.accounts[18]!] === expectedAuthority
        ) {
          return { ...event, tokenMint: keys[instruction.accounts[3]!] ?? '' };
        }
      }
    }
  }
  return null;
}

function eventProgramAtLogs(logs: readonly string[]): readonly (string | null)[] {
  const stack: string[] = [];
  return logs.map((log) => {
    const invoke = /^Program (\S+) invoke \[\d+\]$/.exec(log);
    if (invoke) stack.push(invoke[1]!);
    const current = stack.at(-1) ?? null;
    if (/^Program \S+ (success|failed:)/.test(log)) stack.pop();
    return current;
  });
}

export function parsePumpCreatorFeeEvents(
  transactionSignature: string,
  transaction: CreatorFeeTransaction,
  identity: CreatorFeeFundingIdentity,
  observedAt = new Date(),
): readonly VerifiedCreatorFeeEvent[] {
  if (transaction.meta?.err !== null || transaction.blockTime === null || !transaction.meta)
    return [];
  const logs = transaction.meta.logMessages ?? [];
  const activePrograms = eventProgramAtLogs(logs);
  const events: VerifiedCreatorFeeEvent[] = [];
  for (let eventIndex = 0; eventIndex < logs.length; eventIndex += 1) {
    const match = /^Program data: (\S+)$/.exec(logs[eventIndex]!);
    if (!match) continue;
    let data: Buffer;
    try {
      data = Buffer.from(match[1]!, 'base64');
    } catch {
      continue;
    }
    let decoded: DecodedEvent | null = null;
    if (
      activePrograms[eventIndex] === PUMP_PROGRAM_ID &&
      data.subarray(0, 8).equals(PUMP_TRADE_EVENT)
    ) {
      decoded = decodePumpEvent(data);
    } else if (
      activePrograms[eventIndex] === PUMP_AMM_PROGRAM_ID &&
      data.subarray(0, 8).equals(PUMP_AMM_BUY_EVENT)
    ) {
      decoded = decodePumpSwapEvent(data, 'buy');
    } else if (
      activePrograms[eventIndex] === PUMP_AMM_PROGRAM_ID &&
      data.subarray(0, 8).equals(PUMP_AMM_SELL_EVENT)
    ) {
      decoded = decodePumpSwapEvent(data, 'sell');
    }
    if (decoded) decoded = bindEventToInstruction(decoded, transaction);
    if (
      !decoded ||
      decoded.tokenMint !== identity.tokenMint ||
      decoded.creatorWallet !== identity.creatorWallet ||
      decoded.creatorFeeLamports <= 0n ||
      decoded.holderRewardsBps !== 0n ||
      decoded.holderRewardsLamports !== 0n ||
      decoded.cashbackLamports !== 0n
    ) {
      continue;
    }
    events.push({
      transactionSignature,
      eventIndex,
      slot: BigInt(transaction.slot),
      eventTime: new Date(transaction.blockTime * 1_000),
      creatorFeeLamports: decoded.creatorFeeLamports,
      sourceProgram: decoded.sourceProgram,
      tokenProjectIdentity: decoded.tokenMint,
      observedAt,
      normalizedMetadata: {
        creatorWallet: decoded.creatorWallet,
        protocolEventTimestamp: decoded.protocolEventTimestamp.toString(),
        instructionName: decoded.instructionName,
        ...(decoded.pool ? { pool: decoded.pool } : {}),
        evidence: 'official-anchor-event-plus-matching-trade-instruction',
      },
      verificationStatus: 'VERIFIED',
    });
  }
  return events;
}

interface RpcResponse<T> {
  readonly result?: T;
  readonly error?: { readonly code: number; readonly message: string };
}

export class SolanaJsonRpcClient implements ReadOnlySolanaRpc {
  #lastRequestAt = 0;
  #id = 0;
  constructor(
    private readonly url: string,
    private readonly options: {
      readonly timeoutMs?: number;
      readonly maxAttempts?: number;
      readonly minimumRequestIntervalMs?: number;
      readonly onRetry?: (input: {
        readonly method: string;
        readonly attempt: number;
        readonly maxAttempts: number;
        readonly message: string;
      }) => void;
    } = {},
  ) {}

  private async call<T>(method: string, params: readonly unknown[]): Promise<T> {
    const attempts = this.options.maxAttempts ?? 4;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const delay = Math.max(
        0,
        (this.options.minimumRequestIntervalMs ?? 75) - (Date.now() - this.#lastRequestAt),
      );
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
      try {
        this.#lastRequestAt = Date.now();
        const response = await fetch(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++this.#id, method, params }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`RPC HTTP ${response.status.toString()}`);
        const payload = (await response.json()) as RpcResponse<T>;
        if (payload.error)
          throw new Error(`RPC ${payload.error.code.toString()}: ${payload.error.message}`);
        if (payload.result === undefined) throw new Error('RPC response omitted result.');
        return payload.result;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          this.options.onRetry?.({
            method,
            attempt,
            maxAttempts: attempts,
            message: safeErrorMessage(error, [this.url], 'Unknown RPC failure'),
          });
          await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, 125 * 2 ** attempt)));
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new CreatorFeeIngestionError(
      'RPC_UNAVAILABLE',
      safeErrorMessage(lastError, [this.url], 'Solana RPC request failed.'),
    );
  }

  getSignaturesForAddress(
    address: string,
    options: { before?: string; until?: string; limit: number },
  ) {
    return this.call<readonly SignatureRecord[]>('getSignaturesForAddress', [
      address,
      { ...options, commitment: 'confirmed' },
    ]);
  }
  getTransaction(signature: string) {
    return this.call<CreatorFeeTransaction | null>('getTransaction', [
      signature,
      { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
    ]);
  }
  async getSignatureStatuses(signatures: readonly string[]) {
    const value = await this.call<{ readonly value: readonly (SignatureStatusRecord | null)[] }>(
      'getSignatureStatuses',
      [signatures, { searchTransactionHistory: true }],
    );
    return value.value;
  }
  getSlot(commitment: 'finalized') {
    return this.call<number>('getSlot', [{ commitment }]);
  }
}

export interface DiscoveredCreatorFeeEvent {
  readonly event: VerifiedCreatorFeeEvent;
  readonly confirmationStatus: ChainConfirmationStatus;
}

export class SolanaPumpCreatorFeeSource implements CreatorFeeSource {
  readonly id: string;
  constructor(
    readonly rpc: ReadOnlySolanaRpc,
    readonly identity: CreatorFeeFundingIdentity,
    readonly network: 'mainnet-beta' | 'devnet' | 'localnet',
    readonly pageSize = 50,
  ) {
    if (!identity.tokenMint || !identity.creatorWallet) {
      throw new CreatorFeeIngestionError(
        'FUNDING_IDENTITY_REQUIRED',
        'PAPERFUND_TOKEN_MINT and PAPERFUND_CREATOR_WALLET are required.',
      );
    }
    try {
      new PublicKey(identity.tokenMint);
      new PublicKey(identity.creatorWallet);
    } catch {
      throw new CreatorFeeIngestionError(
        'INVALID_FUNDING_IDENTITY',
        'Paperfund token mint and creator wallet must be valid Solana public keys.',
      );
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new CreatorFeeIngestionError(
        'INVALID_PAGE_SIZE',
        'Page size must be between 1 and 100.',
      );
    }
    this.id = `SOLANA_PUMP:${network}:${identity.tokenMint}`;
  }

  async discover(
    options: { readonly before?: string; readonly until?: string; readonly limit?: number } = {},
  ) {
    const signatures = await this.rpc.getSignaturesForAddress(this.identity.tokenMint, {
      ...(options.before ? { before: options.before } : {}),
      ...(options.until ? { until: options.until } : {}),
      limit: options.limit ?? this.pageSize,
    });
    const discovered: DiscoveredCreatorFeeEvent[] = [];
    for (const record of [...signatures].reverse()) {
      if (record.err !== null) continue;
      const transaction = await this.rpc.getTransaction(record.signature);
      if (!transaction) {
        throw new CreatorFeeIngestionError(
          'TRANSACTION_UNAVAILABLE',
          `Transaction ${record.signature} was discovered but is not readable.`,
        );
      }
      const events = parsePumpCreatorFeeEvents(record.signature, transaction, this.identity);
      const status = record.confirmationStatus ?? 'processed';
      for (const event of events) discovered.push({ event, confirmationStatus: status });
    }
    return { signatures, events: discovered };
  }

  async discoverSince(until?: string, maxTransactions = 10_000) {
    if (!until) return this.discover();
    const signatures: SignatureRecord[] = [];
    let before: string | undefined;
    let reachedCheckpoint = false;
    while (signatures.length < maxTransactions) {
      const limit = Math.min(this.pageSize, maxTransactions - signatures.length);
      const page = await this.rpc.getSignaturesForAddress(this.identity.tokenMint, {
        ...(before ? { before } : {}),
        until,
        limit,
      });
      signatures.push(...page);
      if (page.length < limit) {
        reachedCheckpoint = true;
        break;
      }
      before = page.at(-1)!.signature;
    }
    if (!reachedCheckpoint) {
      throw new CreatorFeeIngestionError(
        'DISCOVERY_WINDOW_EXCEEDED',
        'More than 10,000 signatures accumulated since the checkpoint; run a bounded backfill before following.',
      );
    }
    const discovered: DiscoveredCreatorFeeEvent[] = [];
    for (const record of [...signatures].reverse()) {
      if (record.err !== null) continue;
      const transaction = await this.rpc.getTransaction(record.signature);
      if (!transaction) {
        throw new CreatorFeeIngestionError(
          'TRANSACTION_UNAVAILABLE',
          `Transaction ${record.signature} was discovered but is not readable.`,
        );
      }
      const events = parsePumpCreatorFeeEvents(record.signature, transaction, this.identity);
      const status = record.confirmationStatus ?? 'processed';
      for (const event of events) discovered.push({ event, confirmationStatus: status });
    }
    return { signatures, events: discovered };
  }

  async read() {
    const result = await this.discover();
    return result.events
      .filter((item) => item.confirmationStatus === 'finalized')
      .map((item) => item.event);
  }
}

function observationId(signature: string, eventIndex: number) {
  return `fee-observation:${createHash('sha256').update(`${signature}:${eventIndex.toString()}`).digest('hex')}`;
}

export interface CreatorFeeIngestionTickResult {
  readonly shadowMode: boolean;
  readonly candidates: number;
  readonly discovered: number;
  readonly rejected: number;
  readonly finalizedObserved: number;
  readonly finalized: number;
  readonly duplicates: number;
  readonly rolledBack: number;
  readonly reconciliationRequired: number;
  readonly latestSignature: string | null;
  readonly resumedFromSignature: string | null;
  readonly checkpointMoved: boolean;
  readonly observedLagSlots: bigint;
  readonly finalizedChainSlot: bigint;
}

export interface CreatorFeeBackfillResult {
  readonly examinedTransactions: number;
  readonly discoveredEvents: number;
  readonly inserted: number;
  readonly duplicates: number;
}

async function recordFinding(
  database: DatabaseService,
  observation: { id: string },
  category:
    | 'FINALIZED_TRANSACTION_MISSING'
    | 'FINALIZED_EVIDENCE_CHANGED'
    | 'CANONICAL_EVENT_MISSING'
    | 'CANONICAL_EVENT_MISMATCH',
  detail: string,
  now: Date,
) {
  await database.pool.query(
    `insert into creator_fee_reconciliation_findings
       (id,creator_fee_observation_id,category,detail,detected_at)
     values ($1,$2,$3,$4,$5)
     on conflict (creator_fee_observation_id,category) do update
       set detail=excluded.detail, detected_at=excluded.detected_at, status='OPEN'`,
    [`finding:${observation.id}:${category}`, observation.id, category, detail, now],
  );
}

async function promoteFinalized(
  database: DatabaseService,
  event: VerifiedCreatorFeeEvent,
  now: Date,
): Promise<{ inserted: number; duplicates: number }> {
  const result = await ingestCreatorFeeEvents(database, new FixtureCreatorFeeSource([event]));
  const canonical = await database.pool.query<{ id: string }>(
    `select id from creator_fee_events where transaction_signature=$1 and event_index=$2`,
    [event.transactionSignature, event.eventIndex],
  );
  await database.pool.query(
    `update creator_fee_observations
     set confirmation_status='FINALIZED', finalized_at=coalesce(finalized_at,$3),
         shadow_mode=false,missing_status_checks=0,last_checked_at=$3, updated_at=$3,
         canonical_creator_fee_event_id=$4
     where transaction_signature=$1 and event_index=$2`,
    [event.transactionSignature, event.eventIndex, now, canonical.rows[0]!.id],
  );
  return result;
}

async function finalizeObservation(
  database: DatabaseService,
  event: VerifiedCreatorFeeEvent,
  now: Date,
  shadowMode: boolean,
) {
  if (!shadowMode) return promoteFinalized(database, event, now);
  const round = (
    await database.pool.query<{ id: string; frozen: boolean }>(
      `select r.id,exists(select 1 from hourly_reward_pools p where p.hourly_round_id=r.id) frozen
       from hourly_rounds r where r.starts_at <= $1 and r.ends_at_exclusive > $1
       order by r.starts_at desc limit 1`,
      [event.eventTime],
    )
  ).rows[0];
  const shadowAttribution = {
    hourlyRoundId: round?.id ?? null,
    accountingStatus: !round ? 'INELIGIBLE' : round.frozen ? 'LATE_AFTER_FREEZE' : 'ATTRIBUTED',
  };
  await database.pool.query(
    `update creator_fee_observations
     set confirmation_status='FINALIZED',shadow_mode=true,finalized_at=coalesce(finalized_at,$3),
         missing_status_checks=0,last_checked_at=$3,updated_at=$3,
         evidence=evidence || jsonb_build_object('shadowAttribution',$4::jsonb)
     where transaction_signature=$1 and event_index=$2`,
    [event.transactionSignature, event.eventIndex, now, JSON.stringify(shadowAttribution)],
  );
  return { inserted: 0, duplicates: 0 };
}

async function reconcilePending(
  database: DatabaseService,
  source: SolanaPumpCreatorFeeSource,
  now: Date,
  shadowMode: boolean,
) {
  const pending = await database.pool.query<{
    id: string;
    transaction_signature: string;
    event_index: number;
    slot: string;
    creator_fee_lamports: string;
    source_program: string;
  }>(
    `select id,transaction_signature,event_index,slot,creator_fee_lamports,source_program
     from creator_fee_observations
     where confirmation_status in ('OBSERVED','CONFIRMED')
       and token_mint=$1 and creator_wallet=$2
     order by slot limit 100`,
    [source.identity.tokenMint, source.identity.creatorWallet],
  );
  if (pending.rows.length === 0)
    return { finalized: 0, finalizedObserved: 0, duplicates: 0, rolledBack: 0 };
  const statuses = await source.rpc.getSignatureStatuses(
    pending.rows.map((row) => row.transaction_signature),
  );
  let finalized = 0;
  let duplicates = 0;
  let rolledBack = 0;
  let finalizedObserved = 0;
  for (let index = 0; index < pending.rows.length; index += 1) {
    const row = pending.rows[index]!;
    const status = statuses[index];
    if (!status) {
      const missing = await database.pool.query<{ missing_status_checks: number }>(
        `update creator_fee_observations
         set missing_status_checks=missing_status_checks+1,last_checked_at=$2,updated_at=$2
         where id=$1 returning missing_status_checks`,
        [row.id, now],
      );
      if (missing.rows[0]!.missing_status_checks < 3) continue;
      await database.pool.query(
        `update creator_fee_observations set confirmation_status='ROLLED_BACK',last_checked_at=$2,updated_at=$2 where id=$1`,
        [row.id, now],
      );
      rolledBack += 1;
      continue;
    }
    if (status.err !== null) {
      await database.pool.query(
        `update creator_fee_observations set confirmation_status='ROLLED_BACK',missing_status_checks=0,last_checked_at=$2,updated_at=$2 where id=$1`,
        [row.id, now],
      );
      rolledBack += 1;
      continue;
    }
    if (status.confirmationStatus !== 'finalized') {
      await database.pool.query(
        `update creator_fee_observations set confirmation_status=$2,missing_status_checks=0,last_checked_at=$3,updated_at=$3 where id=$1`,
        [row.id, status.confirmationStatus === 'confirmed' ? 'CONFIRMED' : 'OBSERVED', now],
      );
      continue;
    }
    const transaction = await source.rpc.getTransaction(row.transaction_signature);
    const event = transaction
      ? parsePumpCreatorFeeEvents(
          row.transaction_signature,
          transaction,
          source.identity,
          now,
        ).find((item) => item.eventIndex === row.event_index)
      : undefined;
    if (
      !event ||
      event.slot !== BigInt(row.slot) ||
      event.creatorFeeLamports !== BigInt(row.creator_fee_lamports) ||
      event.sourceProgram !== row.source_program
    ) {
      await database.pool.query(
        `update creator_fee_observations set confirmation_status='RECONCILIATION_REQUIRED',last_checked_at=$2,updated_at=$2 where id=$1`,
        [row.id, now],
      );
      await recordFinding(
        database,
        row,
        transaction ? 'FINALIZED_EVIDENCE_CHANGED' : 'FINALIZED_TRANSACTION_MISSING',
        'Finalized transaction evidence did not match the previously observed creator-fee event.',
        now,
      );
      continue;
    }
    const result = await finalizeObservation(database, event, now, shadowMode);
    finalizedObserved += 1;
    finalized += result.inserted;
    duplicates += result.duplicates;
  }
  return { finalized, finalizedObserved, duplicates, rolledBack };
}

async function auditFinalized(
  database: DatabaseService,
  source: SolanaPumpCreatorFeeSource,
  now: Date,
) {
  const rows = await database.pool.query<{
    id: string;
    transaction_signature: string;
    event_index: number;
    slot: string;
    creator_fee_lamports: string;
    source_program: string;
    shadow_mode: boolean;
    canonical_creator_fee_event_id: string | null;
  }>(
    `select id,transaction_signature,event_index,slot,creator_fee_lamports,source_program,
            shadow_mode,canonical_creator_fee_event_id
     from creator_fee_observations where confirmation_status='FINALIZED'
       and token_mint=$1 and creator_wallet=$2
       and last_checked_at <= $3
     order by slot desc limit 100`,
    [source.identity.tokenMint, source.identity.creatorWallet, new Date(now.getTime() - 60_000)],
  );
  if (rows.rows.length === 0) return 0;
  const statuses = await source.rpc.getSignatureStatuses(
    rows.rows.map((row) => row.transaction_signature),
  );
  let findings = 0;
  for (let index = 0; index < rows.rows.length; index += 1) {
    const row = rows.rows[index]!;
    const status = statuses[index];
    let category:
      | 'FINALIZED_TRANSACTION_MISSING'
      | 'FINALIZED_EVIDENCE_CHANGED'
      | 'CANONICAL_EVENT_MISSING'
      | 'CANONICAL_EVENT_MISMATCH'
      | null = null;
    let detail = '';
    if (!status) {
      const missing = await database.pool.query<{ missing_status_checks: number }>(
        `update creator_fee_observations
         set missing_status_checks=missing_status_checks+1,last_checked_at=$2,updated_at=$2
         where id=$1 returning missing_status_checks`,
        [row.id, now],
      );
      if (missing.rows[0]!.missing_status_checks < 3) continue;
      category = 'FINALIZED_TRANSACTION_MISSING';
      detail = 'A locally finalized creator-fee transaction is no longer finalized on the RPC.';
    } else if (status.err !== null || status.confirmationStatus !== 'finalized') {
      category = 'FINALIZED_TRANSACTION_MISSING';
      detail = 'A locally finalized creator-fee transaction is no longer finalized on the RPC.';
    } else if (!row.shadow_mode && !row.canonical_creator_fee_event_id) {
      category = 'CANONICAL_EVENT_MISSING';
      detail = 'A finalized observation has no canonical creator-fee event link.';
    } else {
      if (!row.shadow_mode) {
        const canonical = await database.pool.query<{
          slot: string;
          creator_fee_lamports: string;
          source_program: string;
        }>(`select slot,creator_fee_lamports,source_program from creator_fee_events where id=$1`, [
          row.canonical_creator_fee_event_id,
        ]);
        const value = canonical.rows[0];
        if (!value) {
          category = 'CANONICAL_EVENT_MISSING';
          detail = 'The canonical creator-fee event linked from the observation is missing.';
        } else if (
          value.slot !== row.slot ||
          value.creator_fee_lamports !== row.creator_fee_lamports ||
          value.source_program !== row.source_program
        ) {
          category = 'CANONICAL_EVENT_MISMATCH';
          detail = 'Canonical creator-fee data differs from finalized observation evidence.';
        }
      }
      if (!category) {
        const transaction = await source.rpc.getTransaction(row.transaction_signature);
        const event = transaction
          ? parsePumpCreatorFeeEvents(
              row.transaction_signature,
              transaction,
              source.identity,
              now,
            ).find((item) => item.eventIndex === row.event_index)
          : undefined;
        if (
          !event ||
          event.slot !== BigInt(row.slot) ||
          event.creatorFeeLamports !== BigInt(row.creator_fee_lamports) ||
          event.sourceProgram !== row.source_program
        ) {
          category = transaction ? 'FINALIZED_EVIDENCE_CHANGED' : 'FINALIZED_TRANSACTION_MISSING';
          detail = 'Refetched finalized transaction evidence differs from the stored observation.';
        }
      }
    }
    if (category) {
      await database.pool.query(
        `update creator_fee_observations set confirmation_status='RECONCILIATION_REQUIRED',last_checked_at=$2,updated_at=$2 where id=$1`,
        [row.id, now],
      );
      await recordFinding(database, row, category, detail, now);
      findings += 1;
    } else {
      await database.pool.query(
        'update creator_fee_observations set missing_status_checks=0,last_checked_at=$2,updated_at=$2 where id=$1',
        [row.id, now],
      );
    }
  }
  return findings;
}

export async function runCreatorFeeIngestionTick(
  database: DatabaseService,
  source: SolanaPumpCreatorFeeSource,
  now = new Date(),
  options: { readonly shadowMode?: boolean } = {},
): Promise<CreatorFeeIngestionTickResult> {
  const shadowMode = options.shadowMode ?? false;
  const checkpoint = await database.pool.query<{
    latest_signature: string | null;
    latest_slot: string | null;
  }>(
    'select latest_signature,latest_slot::text from creator_fee_ingestion_checkpoints where source_id=$1',
    [source.id],
  );
  const resumedFromSignature = checkpoint.rows[0]?.latest_signature ?? null;
  const discovery = await source.discoverSince(resumedFromSignature ?? undefined);
  const candidates = discovery.signatures.length;
  const acceptedSignatures = new Set(
    discovery.events.map((item) => item.event.transactionSignature),
  ).size;
  const rejected = Math.max(0, candidates - acceptedSignatures);
  let finalized = 0;
  let finalizedObserved = 0;
  let duplicates = 0;
  for (const item of discovery.events) {
    const event = item.event;
    const status =
      item.confirmationStatus === 'finalized'
        ? 'FINALIZED'
        : item.confirmationStatus === 'confirmed'
          ? 'CONFIRMED'
          : 'OBSERVED';
    const observation = await database.pool.query<{
      id: string;
      confirmation_status: string;
    }>(
      `insert into creator_fee_observations
        (id,transaction_signature,event_index,slot,block_time,source_program,token_mint,
         creator_wallet,creator_fee_lamports,confirmation_status,shadow_mode,evidence,
         first_observed_at,last_checked_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
       on conflict (transaction_signature,event_index) do update set
         last_checked_at=excluded.last_checked_at, updated_at=excluded.last_checked_at,
         shadow_mode=creator_fee_observations.shadow_mode or excluded.shadow_mode,
         confirmation_status=case
           when creator_fee_observations.confirmation_status in ('FINALIZED','RECONCILIATION_REQUIRED')
             then creator_fee_observations.confirmation_status
           else excluded.confirmation_status end
       where creator_fee_observations.slot=excluded.slot
         and creator_fee_observations.block_time=excluded.block_time
         and creator_fee_observations.source_program=excluded.source_program
         and creator_fee_observations.token_mint=excluded.token_mint
         and creator_fee_observations.creator_wallet=excluded.creator_wallet
         and creator_fee_observations.creator_fee_lamports=excluded.creator_fee_lamports
       returning id,confirmation_status`,
      [
        observationId(event.transactionSignature, event.eventIndex),
        event.transactionSignature,
        event.eventIndex,
        event.slot.toString(),
        event.eventTime,
        event.sourceProgram,
        event.tokenProjectIdentity,
        source.identity.creatorWallet,
        event.creatorFeeLamports.toString(),
        status,
        shadowMode,
        event.normalizedMetadata ?? {},
        now,
      ],
    );
    if (observation.rowCount === 0) {
      const conflict = await database.pool.query<{ id: string }>(
        `select id from creator_fee_observations where transaction_signature=$1 and event_index=$2`,
        [event.transactionSignature, event.eventIndex],
      );
      const conflictRow = conflict.rows[0]!;
      await database.pool.query(
        `update creator_fee_observations set confirmation_status='RECONCILIATION_REQUIRED',last_checked_at=$2,updated_at=$2 where id=$1`,
        [conflictRow.id, now],
      );
      await recordFinding(
        database,
        conflictRow,
        'FINALIZED_EVIDENCE_CHANGED',
        'A chain identity was rediscovered with different creator-fee evidence.',
        now,
      );
      continue;
    }
    if (
      status === 'FINALIZED' &&
      observation.rows[0]!.confirmation_status !== 'RECONCILIATION_REQUIRED'
    ) {
      const result = await finalizeObservation(database, event, now, shadowMode);
      finalizedObserved += 1;
      finalized += result.inserted;
      duplicates += result.duplicates;
    }
  }
  const pending = await reconcilePending(database, source, now, shadowMode);
  finalized += pending.finalized;
  finalizedObserved += pending.finalizedObserved;
  duplicates += pending.duplicates;
  await auditFinalized(database, source, now);
  const finalizedChainSlot = BigInt(await source.rpc.getSlot('finalized'));
  const newest = discovery.signatures[0];
  const latestObservedSlot = newest
    ? BigInt(newest.slot)
    : checkpoint.rows[0]?.latest_slot
      ? BigInt(checkpoint.rows[0].latest_slot)
      : finalizedChainSlot;
  const observedLagSlots =
    finalizedChainSlot > latestObservedSlot ? finalizedChainSlot - latestObservedSlot : 0n;
  const latestSignature = newest?.signature ?? resumedFromSignature;
  const checkpointMoved = latestSignature !== resumedFromSignature;
  await database.pool.query(
    `insert into creator_fee_ingestion_checkpoints
      (source_id,network,token_mint,creator_wallet,latest_signature,latest_slot,last_finalized_slot,
       last_success_at,shadow_mode,poll_count,candidate_count,verified_count,rejected_count,
       max_observed_lag_slots,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12,$13,$8)
     on conflict (source_id) do update set
       latest_signature=coalesce(excluded.latest_signature,creator_fee_ingestion_checkpoints.latest_signature),
       latest_slot=coalesce(excluded.latest_slot,creator_fee_ingestion_checkpoints.latest_slot),
       last_finalized_slot=excluded.last_finalized_slot,last_success_at=excluded.last_success_at,
       shadow_mode=excluded.shadow_mode,poll_count=creator_fee_ingestion_checkpoints.poll_count+1,
       candidate_count=creator_fee_ingestion_checkpoints.candidate_count+excluded.candidate_count,
       verified_count=creator_fee_ingestion_checkpoints.verified_count+excluded.verified_count,
       rejected_count=creator_fee_ingestion_checkpoints.rejected_count+excluded.rejected_count,
       max_observed_lag_slots=greatest(creator_fee_ingestion_checkpoints.max_observed_lag_slots,excluded.max_observed_lag_slots),
       last_error_category=null,last_error_detail=null,updated_at=excluded.updated_at`,
    [
      source.id,
      source.network,
      source.identity.tokenMint,
      source.identity.creatorWallet,
      newest?.signature ?? null,
      newest?.slot ?? null,
      finalizedChainSlot.toString(),
      now,
      shadowMode,
      candidates,
      discovery.events.length,
      rejected,
      observedLagSlots.toString(),
    ],
  );
  const reconciliation = await database.pool.query<{ count: string }>(
    `select count(*)::text count from creator_fee_observations
     where confirmation_status='RECONCILIATION_REQUIRED' and token_mint=$1 and creator_wallet=$2`,
    [source.identity.tokenMint, source.identity.creatorWallet],
  );
  return {
    shadowMode,
    candidates,
    discovered: discovery.events.length,
    rejected,
    finalizedObserved,
    finalized,
    duplicates,
    rolledBack: pending.rolledBack,
    reconciliationRequired: Number(reconciliation.rows[0]!.count),
    latestSignature,
    resumedFromSignature,
    checkpointMoved,
    observedLagSlots,
    finalizedChainSlot,
  };
}

export async function runCreatorFeeBackfill(
  database: DatabaseService,
  source: SolanaPumpCreatorFeeSource,
  input: {
    readonly fromSlot: bigint;
    readonly toSlotExclusive: bigint;
    readonly maxSlotRange?: bigint;
    readonly maxTransactions?: number;
    readonly now?: Date;
  },
): Promise<CreatorFeeBackfillResult> {
  const maxSlotRange = input.maxSlotRange ?? 500_000n;
  const maxTransactions = input.maxTransactions ?? 1_000;
  if (
    input.fromSlot < 0n ||
    input.toSlotExclusive <= input.fromSlot ||
    input.toSlotExclusive - input.fromSlot > maxSlotRange ||
    !Number.isInteger(maxTransactions) ||
    maxTransactions < 1 ||
    maxTransactions > 10_000
  ) {
    throw new CreatorFeeIngestionError(
      'INVALID_BACKFILL_RANGE',
      'Backfill requires a positive bounded [fromSlot,toSlotExclusive) range and transaction cap.',
    );
  }
  const now = input.now ?? new Date();
  let before: string | undefined;
  let examinedTransactions = 0;
  let discoveredEvents = 0;
  let inserted = 0;
  let duplicates = 0;
  let exhaustedRange = false;
  while (examinedTransactions < maxTransactions && !exhaustedRange) {
    const limit = Math.min(source.pageSize, maxTransactions - examinedTransactions);
    const signatures = await source.rpc.getSignaturesForAddress(source.identity.tokenMint, {
      ...(before ? { before } : {}),
      limit,
    });
    if (signatures.length === 0) break;
    examinedTransactions += signatures.length;
    before = signatures.at(-1)!.signature;
    exhaustedRange = BigInt(signatures.at(-1)!.slot) < input.fromSlot;
    const inRange = signatures.filter(
      (record) =>
        record.err === null &&
        BigInt(record.slot) >= input.fromSlot &&
        BigInt(record.slot) < input.toSlotExclusive,
    );
    const statuses = await source.rpc.getSignatureStatuses(
      inRange.map((record) => record.signature),
    );
    for (let index = inRange.length - 1; index >= 0; index -= 1) {
      const record = inRange[index]!;
      const status = statuses[index];
      if (!status || status.err !== null || status.confirmationStatus !== 'finalized') continue;
      const transaction = await source.rpc.getTransaction(record.signature);
      if (!transaction) {
        throw new CreatorFeeIngestionError(
          'TRANSACTION_UNAVAILABLE',
          `Backfill transaction ${record.signature} is not readable.`,
        );
      }
      const events = parsePumpCreatorFeeEvents(record.signature, transaction, source.identity, now);
      discoveredEvents += events.length;
      for (const event of events) {
        await database.pool.query(
          `insert into creator_fee_observations
            (id,transaction_signature,event_index,slot,block_time,source_program,token_mint,
             creator_wallet,creator_fee_lamports,confirmation_status,evidence,
             first_observed_at,last_checked_at,finalized_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'FINALIZED',$10,$11,$11,$11)
           on conflict (transaction_signature,event_index) do nothing`,
          [
            observationId(event.transactionSignature, event.eventIndex),
            event.transactionSignature,
            event.eventIndex,
            event.slot.toString(),
            event.eventTime,
            event.sourceProgram,
            event.tokenProjectIdentity,
            source.identity.creatorWallet,
            event.creatorFeeLamports.toString(),
            event.normalizedMetadata ?? {},
            now,
          ],
        );
        const stored = await database.pool.query<{
          id: string;
          slot: string;
          block_time: Date;
          source_program: string;
          token_mint: string;
          creator_wallet: string;
          creator_fee_lamports: string;
          confirmation_status: string;
        }>(
          `select id,slot,block_time,source_program,token_mint,creator_wallet,
                  creator_fee_lamports,confirmation_status
           from creator_fee_observations where transaction_signature=$1 and event_index=$2`,
          [event.transactionSignature, event.eventIndex],
        );
        const storedEvent = stored.rows[0]!;
        if (
          BigInt(storedEvent.slot) !== event.slot ||
          storedEvent.block_time.getTime() !== event.eventTime.getTime() ||
          storedEvent.source_program !== event.sourceProgram ||
          storedEvent.token_mint !== event.tokenProjectIdentity ||
          storedEvent.creator_wallet !== source.identity.creatorWallet ||
          BigInt(storedEvent.creator_fee_lamports) !== event.creatorFeeLamports
        ) {
          await database.pool.query(
            `update creator_fee_observations set confirmation_status='RECONCILIATION_REQUIRED',last_checked_at=$2,updated_at=$2 where id=$1`,
            [storedEvent.id, now],
          );
          await recordFinding(
            database,
            storedEvent,
            'FINALIZED_EVIDENCE_CHANGED',
            'Backfill rediscovered a chain identity with different creator-fee evidence.',
            now,
          );
          continue;
        }
        if (storedEvent.confirmation_status === 'RECONCILIATION_REQUIRED') continue;
        const result = await promoteFinalized(database, event, now);
        inserted += result.inserted;
        duplicates += result.duplicates;
      }
    }
  }
  return { examinedTransactions, discoveredEvents, inserted, duplicates };
}

export async function getCreatorFeeIngestionHealth(database: DatabaseService, sourceId: string) {
  const checkpoint = await database.pool.query<{
    source_id: string;
    network: string;
    token_mint: string;
    creator_wallet: string;
    latest_signature: string | null;
    latest_slot: string | null;
    last_finalized_slot: string | null;
    last_success_at: Date | null;
    last_error_category: string | null;
    last_error_detail: string | null;
    shadow_mode: boolean;
    poll_count: string;
    candidate_count: string;
    verified_count: string;
    rejected_count: string;
    retry_error_count: string;
    max_observed_lag_slots: string;
    updated_at: Date;
  }>(
    `select source_id,network,token_mint,creator_wallet,latest_signature,latest_slot,
            last_finalized_slot,last_success_at,last_error_category,last_error_detail,shadow_mode,
            poll_count::text,candidate_count::text,verified_count::text,rejected_count::text,
            retry_error_count::text,max_observed_lag_slots::text,updated_at
     from creator_fee_ingestion_checkpoints where source_id=$1`,
    [sourceId],
  );
  const value = checkpoint.rows[0] ?? null;
  const statuses = await database.pool.query<{ confirmation_status: string; count: string }>(
    `select confirmation_status,count(*)::text count from creator_fee_observations
     where ($1::text is null or token_mint=$1)
     group by confirmation_status order by confirmation_status`,
    [value?.token_mint ?? null],
  );
  const findings = await database.pool.query<{ category: string; count: string }>(
    `select f.category,count(*)::text count
     from creator_fee_reconciliation_findings f
     join creator_fee_observations o on o.id=f.creator_fee_observation_id
     where f.status='OPEN' and ($1::text is null or o.token_mint=$1)
     group by f.category order by f.category`,
    [value?.token_mint ?? null],
  );
  const rawSlotLag =
    value?.latest_slot && value.last_finalized_slot
      ? BigInt(value.last_finalized_slot) - BigInt(value.latest_slot)
      : null;
  const slotLag = rawSlotLag === null ? null : (rawSlotLag > 0n ? rawSlotLag : 0n).toString();
  return {
    checkpoint: value,
    slotLag,
    observations: statuses.rows,
    openReconciliationFindings: findings.rows,
  };
}

export async function recordCreatorFeeIngestionFailure(
  database: DatabaseService,
  source: SolanaPumpCreatorFeeSource,
  error: unknown,
  now = new Date(),
  options: { readonly shadowMode?: boolean; readonly retryErrors?: number } = {},
) {
  const category =
    error instanceof CreatorFeeIngestionError ? error.code : 'CREATOR_FEE_INGESTION_FAILED';
  const detail = safeErrorMessage(
    error,
    [process.env['SOLANA_RPC_URL']],
    'Unknown creator-fee ingestion failure',
  );
  await database.pool.query(
    `insert into creator_fee_ingestion_checkpoints
      (source_id,network,token_mint,creator_wallet,last_error_category,last_error_detail,
       shadow_mode,retry_error_count,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (source_id) do update set
       last_error_category=excluded.last_error_category,last_error_detail=excluded.last_error_detail,
       shadow_mode=excluded.shadow_mode,
       retry_error_count=creator_fee_ingestion_checkpoints.retry_error_count+excluded.retry_error_count,
       updated_at=excluded.updated_at`,
    [
      source.id,
      source.network,
      source.identity.tokenMint,
      source.identity.creatorWallet,
      category,
      detail,
      options.shadowMode ?? false,
      options.retryErrors ?? 0,
      now,
    ],
  );
}

export async function recordCreatorFeeIngestionRetries(
  database: DatabaseService,
  source: SolanaPumpCreatorFeeSource,
  retryErrors: number,
  now = new Date(),
) {
  if (retryErrors <= 0) return;
  await database.pool.query(
    `update creator_fee_ingestion_checkpoints
     set retry_error_count=retry_error_count+$2,updated_at=$3
     where source_id=$1`,
    [source.id, retryErrors, now],
  );
}
