import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import BN from 'bn.js';
import {
  parsePumpCreatorFeeEvents,
  SolanaPumpCreatorFeeSource,
  type ReadOnlySolanaRpc,
  type CreatorFeeTransaction,
  type SignatureRecord,
  type SignatureStatusRecord,
} from '../packages/db/src/creator-fee-ingestion.js';
import type { VerifiedCreatorFeeEvent } from '../packages/db/src/reward-service.js';
const require = createRequire(import.meta.url);
const codePins = JSON.parse(
  readFileSync(new URL('./funding-snapshot-pins.json', import.meta.url), 'utf8'),
) as {
  captureManifestSha256: string;
  officialPinsSha256: string;
  acceptedParserSha256: string;
  sdk: { name: string; sha256: string }[];
};
// Decoder-only SDK use. No connection, wallet, transaction builder, signer or send API is exposed.
const pump = require('@pump-fun/pump-sdk') as {
  PUMP_PROGRAM_ID: PublicKey;
  PUMP_FEE_PROGRAM_ID: PublicKey;
  GLOBAL_PDA: PublicKey;
  PUMP_FEE_CONFIG_PDA: PublicKey;
  bondingCurvePda: (mint: PublicKey) => PublicKey;
  creatorVaultPda: (creator: PublicKey) => PublicKey;
  feeSharingConfigPda: (mint: PublicKey) => PublicKey;
  canonicalPumpPoolPda: (mint: PublicKey) => PublicKey;
  computeFeesBps: (input: Record<string, unknown>) => {
    protocolFeeBps: BN;
    creatorFeeBps: BN;
  };
  PUMP_SDK: {
    decodeBondingCurve: (account: unknown) => {
      creator: PublicKey;
      complete: boolean;
      isCashbackCoin: boolean;
      isHolderReward: boolean;
      quoteMint: PublicKey;
      creatorFeeBps: unknown;
      isMayhemMode: boolean;
      virtualQuoteReserves: unknown;
      virtualTokenReserves: unknown;
    };
    decodeGlobal: (account: unknown) => unknown;
    decodeFeeConfig: (account: unknown) => unknown;
    decodeSharingConfig: (account: unknown) => unknown;
  };
};
export const FUNDING_MINT = '3JVd8Z3kEEXBaBoZo9rcWk4MHJPSUAf6zAjvAF5spump';
export const SUPPLIED_WALLET = 'GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW';
export const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
interface Capture {
  file: string;
  request: { method: string; params: unknown[]; id: number };
  receivedAt: string;
  sha256: string;
  http: number;
}
interface Account {
  owner: string;
  executable: boolean;
  lamports: number;
  data: [string, string];
}
interface Batch {
  context: { slot: number };
  value: (Account | null)[];
}
const plain = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));

/** Protected offline archive. RPC-reported finality is retained, not promoted to provider qualification. */
export class FundingArchive implements ReadOnlySolanaRpc {
  private readonly captures: { capture: Capture; result: unknown }[] = [];
  private readonly transactions = new Map<string, CreatorFeeTransaction>();
  private readonly transactionHashes = new Map<string, string>();
  private readonly statuses = new Map<string, SignatureStatusRecord | null>();
  readonly genesis: string;
  readonly snapshotSlot: number;
  readonly observedAt: Date;
  readonly sourceHash: string;
  readonly officialHash: string;
  readonly identity: { tokenMint: string; creatorWallet: string };
  readonly creatorVault: string;
  readonly claimableLamports: bigint;
  readonly walletBalance: bigint;
  readonly config: Record<string, unknown>;
  readonly history: readonly {
    signature: string;
    slot: number;
    failed: boolean;
    instructions: readonly { program: string; name: string }[];
  }[];
  readonly verifiedEvents: readonly VerifiedCreatorFeeEvent[];
  readonly successfulClaims: readonly { signature: string; program: string; name: string }[];
  readonly rpcReportedHistoryExhausted: boolean;
  constructor(root: string, manifestHash: string, officialRoot: string, officialHash: string) {
    if (manifestHash !== codePins.captureManifestSha256)
      throw Error('CAPTURE_MANIFEST_PIN_MISMATCH');
    if (officialHash !== codePins.officialPinsSha256) throw Error('OFFICIAL_PINS_CHANGED');
    if (
      digest(
        readFileSync(new URL('../packages/db/src/creator-fee-ingestion.ts', import.meta.url)),
      ) !== codePins.acceptedParserSha256
    )
      throw Error('ACCEPTED_PARSER_CHANGED');
    for (const sdk of codePins.sdk)
      if (digest(readFileSync(require.resolve(sdk.name))) !== sdk.sha256)
        throw Error('SDK_DECODER_CHANGED');
    const manifestBytes = readFileSync(resolve(root, 'provenance.json'));
    if (digest(manifestBytes) !== manifestHash) throw Error('CAPTURE_MANIFEST_PIN_MISMATCH');
    this.sourceHash = manifestHash;
    this.officialHash = officialHash;
    const m = JSON.parse(manifestBytes.toString()) as {
      providerOrigin: string;
      captures: Capture[];
    };
    if (new URL(m.providerOrigin).protocol !== 'https:') throw Error('HTTPS_PROVIDER_REQUIRED');
    const allowed = new Set([
      'getGenesisHash',
      'getVersion',
      'getMultipleAccounts',
      'getMinimumBalanceForRentExemption',
      'getSignaturesForAddress',
      'getTransaction',
      'getSignatureStatuses',
      'getSlot',
      'getFirstAvailableBlock',
    ]);
    for (const c of m.captures) {
      if (
        !/^[0-9]+-[A-Za-z]+\.json$/.test(c.file) ||
        !allowed.has(c.request.method) ||
        c.http !== 200
      )
        throw Error('INVALID_CAPTURE');
      const bytes = readFileSync(resolve(root, c.file));
      if (digest(bytes) !== c.sha256) throw Error('RPC_BYTES_CHANGED');
      const body = JSON.parse(bytes.toString()) as { id: number; error?: unknown; result: unknown };
      if (body.error || body.id !== c.request.id) throw Error('RPC_RESPONSE_MISMATCH');
      this.captures.push({ capture: c, result: body.result });
    }
    this.genesis = this.one<string>('getGenesisHash');
    if (this.genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
      throw Error('MAINNET_GENESIS_REQUIRED');
    const batch = this.captures.find((x) => x.capture.request.method === 'getMultipleAccounts')!;
    const b = batch.result as Batch;
    this.snapshotSlot = b.context.slot;
    this.observedAt = new Date(batch.capture.receivedAt);
    const account = (address: string): Account | null => {
      const c = this.captures.find(
        (x) =>
          x.capture.request.method === 'getMultipleAccounts' &&
          (x.capture.request.params[0] as string[]).includes(address),
      );
      if (!c) throw Error('ACCOUNT_CAPTURE_MISSING');
      const result = c.result as Batch;
      if (result.context.slot < this.snapshotSlot) throw Error('REGRESSING_CONTEXT');
      const a = result.value[(c.capture.request.params[0] as string[]).indexOf(address)]!;
      if (a && (!Number.isSafeInteger(a.lamports) || a.lamports < 0 || a.data[1] !== 'base64'))
        throw Error('INVALID_ACCOUNT');
      return a;
    };
    const decoded = (address: PublicKey, owner: PublicKey, fn: (a: unknown) => unknown) => {
      const a = account(address.toBase58());
      if (!a || a.owner !== owner.toBase58() || a.executable) throw Error('ACCOUNT_OWNER_MISMATCH');
      return fn({ ...a, owner: new PublicKey(a.owner), data: Buffer.from(a.data[0], 'base64') });
    };
    const mint = new PublicKey(FUNDING_MINT),
      curve = decoded(pump.bondingCurvePda(mint), pump.PUMP_PROGRAM_ID, (a) =>
        pump.PUMP_SDK.decodeBondingCurve(a),
      ) as ReturnType<typeof pump.PUMP_SDK.decodeBondingCurve>;
    this.identity = Object.freeze({
      tokenMint: FUNDING_MINT,
      creatorWallet: curve.creator.toBase58(),
    });
    const sharing = account(pump.feeSharingConfigPda(mint).toBase58()),
      pool = account(pump.canonicalPumpPoolPda(mint).toBase58());
    if (
      sharing ||
      pool ||
      curve.complete ||
      curve.isCashbackCoin ||
      curve.isHolderReward ||
      !curve.quoteMint.equals(PublicKey.default)
    )
      throw Error('FUNDING_TOPOLOGY_REQUIRES_REVIEW');
    this.creatorVault = pump.creatorVaultPda(curve.creator).toBase58();
    const vault = account(this.creatorVault);
    if (
      !vault ||
      vault.owner !== PublicKey.default.toBase58() ||
      vault.executable ||
      Buffer.from(vault.data[0], 'base64').length !== 0
    )
      throw Error('CREATOR_VAULT_INVALID');
    const rent = this.one<number>('getMinimumBalanceForRentExemption');
    if (!Number.isSafeInteger(rent) || rent < 0) throw Error('INVALID_RENT');
    this.claimableLamports = BigInt(Math.max(0, vault.lamports - rent));
    this.walletBalance = BigInt(account(SUPPLIED_WALLET)?.lamports ?? 0);
    if (curve.isMayhemMode) throw Error('FUNDING_TOPOLOGY_REQUIRES_REVIEW');
    const global = decoded(pump.GLOBAL_PDA, pump.PUMP_PROGRAM_ID, (a) =>
      pump.PUMP_SDK.decodeGlobal(a),
    );
    const feeConfig = decoded(pump.PUMP_FEE_CONFIG_PDA, pump.PUMP_FEE_PROGRAM_ID, (a) =>
      pump.PUMP_SDK.decodeFeeConfig(a),
    );
    const fees = pump.computeFeesBps({
      global,
      feeConfig,
      mintSupply: new BN('1000000000000000'),
      virtualQuoteReserves: curve.virtualQuoteReserves,
      virtualTokenReserves: curve.virtualTokenReserves,
      quoteMint: curve.quoteMint,
      creatorFeeBps: curve.creatorFeeBps,
    });
    this.config = {
      curve: plain(curve),
      global: plain(global),
      feeConfig: plain(feeConfig),
      currentCurveFeeBps: {
        protocolFeeBps: fees.protocolFeeBps.toString(),
        creatorFeeBps: fees.creatorFeeBps.toString(),
      },
      sharingExists: false,
      pumpSwapPoolExists: false,
      creatorMatchesSupplied: curve.creator.toBase58() === SUPPLIED_WALLET,
    };
    const pinsBytes = readFileSync(resolve(officialRoot, 'pins.json'));
    if (digest(pinsBytes) !== officialHash) throw Error('OFFICIAL_PINS_CHANGED');
    const pins = JSON.parse(pinsBytes.toString()) as { pins: { file?: string; sha256?: string }[] };
    for (const p of pins.pins)
      if (p.file) {
        if (
          !/^[A-Za-z0-9_.]+$/.test(p.file) ||
          digest(readFileSync(resolve(officialRoot, p.file))) !== p.sha256
        )
          throw Error('OFFICIAL_SOURCE_CHANGED');
      }
    const coders = new Map<string, Map<string, string>>();
    for (const name of ['pump', 'pump_amm', 'pump_fees']) {
      const idl = JSON.parse(readFileSync(resolve(officialRoot, `idl__${name}.json`), 'utf8')) as {
        address: string;
        instructions: { name: string; discriminator: number[] }[];
      };
      coders.set(
        idl.address,
        new Map(
          idl.instructions.map((i) => [Buffer.from(i.discriminator).toString('hex'), i.name]),
        ),
      );
    }
    for (const { capture: c, result } of this.captures) {
      if (c.request.method === 'getTransaction' && result) {
        const signature = c.request.params[0] as string;
        this.transactions.set(signature, result as CreatorFeeTransaction);
        this.transactionHashes.set(signature, c.sha256);
      }
      if (c.request.method === 'getSignatureStatuses') {
        const r = result as { value: (SignatureStatusRecord | null)[] };
        (c.request.params[0] as string[]).forEach((s, i) =>
          this.statuses.set(s, r.value[i] ?? null),
        );
      }
    }
    const history: (typeof this.history)[number][] = [],
      claims: (typeof this.successfulClaims)[number][] = [],
      events: VerifiedCreatorFeeEvent[] = [];
    for (const [signature, t] of this.transactions) {
      const status = this.statuses.get(signature);
      if (
        !status ||
        status.confirmationStatus !== 'finalized' ||
        status.slot !== t.slot ||
        JSON.stringify(status.err) !== JSON.stringify(t.meta?.err)
      )
        throw Error('FINALITY_STATUS_MISMATCH');
      const keys = [
        ...t.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey)),
        ...(t.meta?.loadedAddresses?.writable ?? []),
        ...(t.meta?.loadedAddresses?.readonly ?? []),
      ];
      const instructions = [];
      for (const ix of [
        ...t.transaction.message.instructions,
        ...(t.meta?.innerInstructions ?? []).flatMap((x) => x.instructions),
      ]) {
        const program = keys[ix.programIdIndex]!,
          coder = coders.get(program);
        if (!coder) continue;
        // Anchor self-CPI event instructions are not regular financial instructions.
        const name = coder.get(Buffer.from(bs58.decode(ix.data)).subarray(0, 8).toString('hex'));
        if (!name) continue;
        const decoded = { name };
        instructions.push({ program, name });
        if (
          t.meta?.err === null &&
          /collect_.*creator_fee|distribute_creator_fees|sweep_creator_fee|transfer_creator_fees_to_pump|update_fee_shares/.test(
            decoded.name,
          ) &&
          ix.accounts.some(
            (i) => keys[i] === this.creatorVault || keys[i] === this.identity.creatorWallet,
          )
        )
          claims.push({ signature, program, name: decoded.name });
      }
      history.push({ signature, slot: t.slot, failed: t.meta?.err !== null, instructions });
      events.push(
        ...parsePumpCreatorFeeEvents(signature, t, this.identity, this.observedAt).map((e) => ({
          ...e,
          normalizedMetadata: {
            ...e.normalizedMetadata,
            captureManifestSha256: this.sourceHash,
            transactionResponseSha256: this.transactionHashes.get(signature),
            officialIdlPinsSha256: this.officialHash,
            network: 'mainnet-beta',
            financialProviderQualified: false,
          },
        })),
      );
    }
    this.history = Object.freeze(history);
    this.successfulClaims = Object.freeze(claims);
    this.verifiedEvents = Object.freeze(events);
    const sigCaptures = this.captures.filter(
      (x) => x.capture.request.method === 'getSignaturesForAddress',
    );
    this.rpcReportedHistoryExhausted = sigCaptures.every(
      (x) =>
        (x.result as SignatureRecord[]).length <
        Number((x.capture.request.params[1] as { limit: number }).limit),
    );
    const vaultHistory = (sigCaptures.find((x) => x.capture.request.params[0] === this.creatorVault)
      ?.result ?? []) as SignatureRecord[];
    for (const r of vaultHistory)
      if (!this.transactions.has(r.signature)) throw Error('VAULT_HISTORY_TRANSACTION_MISSING');
  }
  private one<T>(method: string): T {
    const x = this.captures.find((x) => x.capture.request.method === method);
    if (!x) throw Error('CAPTURE_MISSING:' + method);
    return x.result as T;
  }
  async getTransaction(signature: string) {
    return structuredClone(this.transactions.get(signature) ?? null);
  }
  async getSignatureStatuses(signatures: readonly string[]) {
    return signatures.map((s) => structuredClone(this.statuses.get(s) ?? null));
  }
  async getSlot() {
    return this.one<number>('getSlot');
  }
  async getSignaturesForAddress(
    address: string,
    options: { before?: string; until?: string; limit: number },
  ) {
    const x = this.captures.find(
      (x) =>
        x.capture.request.method === 'getSignaturesForAddress' &&
        x.capture.request.params[0] === address,
    );
    if (!x) throw Error('SIGNATURE_HISTORY_NOT_CAPTURED');
    let rows = structuredClone(x.result as SignatureRecord[]);
    if (options.before) {
      const i = rows.findIndex((x) => x.signature === options.before);
      if (i < 0) throw Error('CHECKPOINT_NOT_IN_CAPTURE');
      rows = rows.slice(i + 1);
    }
    if (options.until) {
      const i = rows.findIndex((x) => x.signature === options.until);
      if (i >= 0) rows = rows.slice(0, i);
    }
    return rows.slice(0, options.limit);
  }
  source() {
    const source = new SolanaPumpCreatorFeeSource(this, this.identity, 'mainnet-beta', 50);
    const original = source.discover.bind(source);
    source.discover = async (options) => {
      const d = await original(options);
      return {
        ...d,
        events: d.events.map((e) => ({
          ...e,
          event:
            this.verifiedEvents.find(
              (v) =>
                v.transactionSignature === e.event.transactionSignature &&
                v.eventIndex === e.event.eventIndex,
            ) ?? e.event,
        })),
      };
    };
    return source;
  }
}
