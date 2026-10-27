import type { GenericPermission } from './generic-access-context.js';
import type { BuySimulationRequest, SellSimulationRequest } from '@paperfund/execution';
import { NATIVE_MINT_2022 } from '@solana/spl-token';
/** Generic eligibility reuses Stage 1. Never reachable unless separately enabled by the server. */
import { identifier, type ProtocolId } from '@paperfund/core';
import { ExecutionEngineError, type MarketIdentity, type MarketState } from '@paperfund/execution';
import { PublicKey } from '@solana/web3.js';
import {
  Stage1NonSolPumpSwap,
  validatePumpSwapMint,
  type Stage1Snapshot,
  type ReplayPolicy,
} from './experimental/non-sol-pump-swap.js';
import { NonSolPumpSwapAdapter, pumpSwapStateFromSnapshot } from './non-sol-pump-swap.js';
import type { SolanaRpcClient } from './pump-fun.js';
import {
  pumpBondingCurveAddress,
  decodePumpBondingCurve,
  PUMP_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from './pump-fun.js';
import {
  canonicalPumpSwapPoolAddress,
  decodePumpSwapPool,
  PUMP_AMM_PROGRAM_ID,
  pumpPoolAuthorityAddress,
  pumpSwapGlobalConfigAddress,
  pumpSwapFeeConfigAddress,
} from './pump-swap.js';
import { orcaLink, ORCA_WHIRLPOOL_PROGRAM, assertOrcaSnapshot } from './composed-pump-orca.js';
import { advisoryReadContext } from './rpc-read-context.js';
import type { PoolLink } from './solana-routes.js';
export const GENERIC_PUMP_SWAP_PROTOCOL_ID: ProtocolId = identifier(
  'GENERIC_PUMP_SWAP',
  'ProtocolId',
);
export const GENERIC_PUMP_SWAP_VERSION = 'generic-pump-swap-orca-v1';
const NORMALIZATION = 'generic-pump-swap-accounts-v1',
  CLOCK = 'SysvarC1ock11111111111111111111111111111111';
const references = [1000000000n, 100000000n, 10000000n, 1000000n];
function unavailable(reason: string): never {
  throw new ExecutionEngineError('POSITION_EXECUTION_ROUTE_UNAVAILABLE', reason);
}
export function genericPumpSwapIdentity(
  mint: string,
  quote: string,
  bridge: string,
): MarketIdentity {
  return {
    protocolId: GENERIC_PUMP_SWAP_PROTOCOL_ID,
    tokenMint: identifier(mint, 'TokenMint'),
    marketId: identifier('generic-pump-swap:' + mint + ':' + quote + ':' + bridge, 'MarketId'),
  };
}
export interface BridgeCandidates {
  pools(quote: string): Promise<readonly string[]>;
}
/** Indexing supplies addresses only. Pool owners/mints determine eligibility; no indexer price is used. */
export class OrcaBridgeCandidates implements BridgeCandidates {
  private cache = new Map<string, { until: number; pools: string[] }>();
  async pools(quote: string) {
    const cached = this.cache.get(quote);
    if (cached && cached.until > Date.now()) return [...cached.pools];
    const response = await fetch('https://api.dexscreener.com/token-pairs/v1/solana/' + quote, {
      signal: AbortSignal.any([
        advisoryReadContext()?.signal ?? AbortSignal.timeout(8000),
        AbortSignal.timeout(3000),
      ]),
    });
    if (!response.ok) unavailable('GENERIC_DISCOVERY_HTTP_' + response.status);
    const pairs: unknown = await response.json();
    if (!Array.isArray(pairs)) unavailable('GENERIC_DISCOVERY_INVALID');
    const pools = [
      ...new Set(
        pairs
          .filter(
            (p: { baseToken?: { address?: string }; quoteToken?: { address?: string } }) =>
              p &&
              [p.baseToken?.address, p.quoteToken?.address].includes(quote) &&
              [p.baseToken?.address, p.quoteToken?.address].includes(WRAPPED_SOL_MINT),
          )
          .map((p: { pairAddress: string }) => p.pairAddress)
          .filter((p: unknown): p is string => {
            if (typeof p !== 'string') return false;
            try {
              return new PublicKey(p).toBase58() === p;
            } catch {
              return false;
            }
          }),
      ),
    ]
      .sort()
      .slice(0, 16);
    if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!);
    if (pools.length) this.cache.set(quote, { until: Date.now() + 60000, pools });
    return pools;
  }
}
/** These protocol fee classes need separate validated schedules, not the exotic schedule. */
function assertGenericQuoteMechanics(quote: string) {
  if (quote === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    unavailable('GENERIC_STABLE_FEE_SCHEDULE_UNSUPPORTED');
  if (quote === NATIVE_MINT_2022.toBase58())
    unavailable('GENERIC_TOKEN2022_NATIVE_FEE_SCHEDULE_UNSUPPORTED');
}
export function compareGenericBridges(
  a: { reference: string; recoveryPpb: string; pool: string },
  b: { reference: string; recoveryPpb: string; pool: string },
) {
  if (BigInt(a.reference) !== BigInt(b.reference))
    return BigInt(a.reference) > BigInt(b.reference) ? -1 : 1;
  if (BigInt(a.recoveryPpb) !== BigInt(b.recoveryPpb))
    return BigInt(a.recoveryPpb) > BigInt(b.recoveryPpb) ? -1 : 1;
  return a.pool < b.pool ? -1 : a.pool > b.pool ? 1 : 0;
}
function boundEngine(s: Stage1Snapshot) {
  assertGenericQuoteMechanics(s.quoteMint);
  return new Stage1NonSolPumpSwap({
    purpose: 'READ_ONLY_STAGE1_VALIDATION',
    bridgeBinding: { quoteMint: s.quoteMint, pool: s.bridgePool },
  });
}
interface Topology {
  mint: string;
  quote: string;
  target: string;
  bridge: PoolLink;
  addresses: string[];
  until: number;
  reference: string;
  recoveryPpb: string;
  pinned?: boolean;
}
export class GenericPumpSwapSource {
  private topology = new Map<string, Topology>();
  private pinned = new Map<string, Topology>();
  private pending = new Map<string, Promise<Topology>>();
  readonly diagnostics = new Map<string, readonly { pool: string; reason: string }[]>();
  readonly engine = {
    validate: (s: Stage1Snapshot, p: ReplayPolicy) => boundEngine(s).validate(s, p),
    quote: (s: Stage1Snapshot, input: bigint, buy: boolean, p: ReplayPolicy) =>
      boundEngine(s).quote(s, input, buy, p),
    exits: (s: Stage1Snapshot, q: bigint, p: ReplayPolicy) => boundEngine(s).exits(s, q, p),
  };
  constructor(
    readonly rpc: Pick<SolanaRpcClient, 'getMultipleAccounts'>,
    readonly candidates: BridgeCandidates = new OrcaBridgeCandidates(),
  ) {}
  private key(mint: string, quote: string) {
    return mint + ':' + quote;
  }
  async resolve(mint: string, quote: string) {
    assertGenericQuoteMechanics(quote);
    if ([WRAPPED_SOL_MINT, PublicKey.default.toBase58()].includes(quote))
      unavailable('GENERIC_NATIVE_ROUTE_USE_EXISTING_ADAPTER');
    const k = this.key(mint, quote),
      cached = this.topology.get(k);
    if (cached && cached.until > Date.now())
      return genericPumpSwapIdentity(mint, quote, cached.bridge.pool);
    let promise = this.pending.get(k);
    if (!promise) {
      promise = this.discover(mint, quote).finally(() => {
        if (this.pending.get(k) === promise) this.pending.delete(k);
      });
      this.pending.set(k, promise);
    }
    const t = await promise;
    return genericPumpSwapIdentity(mint, quote, t.bridge.pool);
  }
  /** Only a trusted owner/settlement proof supplies this address. Old reserves are never reused. */
  async resolvePinned(mint: string, quote: string, bridgePool: string) {
    assertGenericQuoteMechanics(quote);
    const identity = genericPumpSwapIdentity(mint, quote, bridgePool),
      saved = this.pinned.get(identity.marketId);
    if (saved && saved.until > Date.now()) return identity;
    const curve = await pumpBondingCurveAddress(mint),
      target = await canonicalPumpSwapPoolAddress(mint, quote),
      r = await this.rpc.getMultipleAccounts([curve, target, bridgePool]);
    const c = r.value[0],
      p = r.value[1],
      b = r.value[2];
    if (
      !c ||
      c.owner !== PUMP_PROGRAM_ID ||
      !p ||
      p.owner !== PUMP_AMM_PROGRAM_ID ||
      !b ||
      b.owner !== ORCA_WHIRLPOOL_PROGRAM
    )
      unavailable('GENERIC_EXIT_PIN_UNAVAILABLE');
    const curveState = decodePumpBondingCurve(Buffer.from(c.data[0], 'base64')),
      pool = decodePumpSwapPool(Buffer.from(p.data[0], 'base64')),
      bridge = orcaLink(bridgePool, { owner: b.owner, base64: b.data[0] });
    if (
      !curveState.complete ||
      curveState.quoteMint !== quote ||
      pool.baseMint !== mint ||
      pool.quoteMint !== quote ||
      pool.creator !== (await pumpPoolAuthorityAddress(mint)) ||
      pool.index !== 0 ||
      ![bridge.mintA, bridge.mintB].includes(quote) ||
      ![bridge.mintA, bridge.mintB].includes(WRAPPED_SOL_MINT)
    )
      unavailable('GENERIC_EXIT_PIN_LINKAGE');
    const addresses = [
      ...new Set([
        curve,
        target,
        mint,
        quote,
        WRAPPED_SOL_MINT,
        pool.baseVault,
        pool.quoteVault,
        bridgePool,
        bridge.vaultA,
        bridge.vaultB,
        bridge.config!,
        ...(bridge.extraAccounts ?? []),
        await pumpSwapGlobalConfigAddress(),
        await pumpSwapFeeConfigAddress(),
        CLOCK,
      ]),
    ];
    const t: Topology = {
      mint,
      quote,
      target,
      bridge,
      addresses,
      until: Date.now() + 60000,
      reference: '0',
      recoveryPpb: '0',
      pinned: true,
    };
    if (this.pinned.size >= 256) this.pinned.delete(this.pinned.keys().next().value!);
    this.pinned.set(identity.marketId, structuredClone(t));
    return identity;
  }
  async eligibility(mint: string, quote: string) {
    try {
      const identity = await this.resolve(mint, quote);
      return {
        supported: true as const,
        identity,
        diagnostics: this.diagnostics.get(this.key(mint, quote)) ?? [],
      };
    } catch (e) {
      return {
        supported: false as const,
        reason: e instanceof ExecutionEngineError ? e.code : 'MARKET_STATE_UNAVAILABLE',
        diagnostics: e instanceof Error ? e.message : 'GENERIC_STATE_UNAVAILABLE',
        candidates: this.diagnostics.get(this.key(mint, quote)) ?? [],
      };
    }
  }
  private async discover(mint: string, quote: string): Promise<Topology> {
    const target = await canonicalPumpSwapPoolAddress(mint, quote),
      curve = await pumpBondingCurveAddress(mint);
    const targetRead = await this.rpc.getMultipleAccounts([
      curve,
      target,
      mint,
      quote,
      WRAPPED_SOL_MINT,
    ]);
    const ca = targetRead.value[0],
      pa = targetRead.value[1];
    if (!ca || ca.owner !== PUMP_PROGRAM_ID || !pa || pa.owner !== PUMP_AMM_PROGRAM_ID)
      unavailable('GENERIC_CANONICAL_POOL_UNAVAILABLE');
    const c = decodePumpBondingCurve(Buffer.from(ca.data[0], 'base64')),
      p = decodePumpSwapPool(Buffer.from(pa.data[0], 'base64'));
    if (
      !c.complete ||
      c.quoteMint !== quote ||
      p.baseMint !== mint ||
      p.quoteMint !== quote ||
      p.index !== 0 ||
      p.creator !== (await pumpPoolAuthorityAddress(mint))
    )
      unavailable('GENERIC_CANONICAL_LINKAGE');
    const tokenAccounts: Stage1Snapshot['accounts'] = {};
    [mint, quote, WRAPPED_SOL_MINT].forEach((a, i) => {
      const v = targetRead.value[i + 2];
      if (v) tokenAccounts[a] = { owner: v.owner, base64: v.data[0] };
    });
    const tokenSnapshot: Stage1Snapshot = {
      version: 'NON_SOL_PUMPSWAP_STAGE1_V1',
      mint,
      quoteMint: quote,
      targetPool: target,
      bridgePool: '',
      slot: targetRead.context.slot,
      observedAt: new Date().toISOString(),
      accounts: tokenAccounts,
      absentAccounts: [],
    };
    for (const a of [mint, quote, WRAPPED_SOL_MINT]) validatePumpSwapMint(tokenSnapshot, a);
    const hints = [...new Set(await this.candidates.pools(quote))].sort().slice(0, 16);
    if (!hints.length) unavailable('GENERIC_SOL_BRIDGE_NOT_FOUND');
    const read = await this.rpc.getMultipleAccounts(hints),
      rejected: { pool: string; reason: string }[] = [],
      links: PoolLink[] = [];
    for (const [i, pool] of hints.entries()) {
      const a = read.value[i];
      if (!a || a.owner !== ORCA_WHIRLPOOL_PROGRAM) {
        rejected.push({ pool, reason: 'GENERIC_BRIDGE_PROGRAM_UNSUPPORTED' });
        continue;
      }
      try {
        const link = orcaLink(pool, { owner: a.owner, base64: a.data[0] });
        if (
          ![link.mintA, link.mintB].includes(quote) ||
          ![link.mintA, link.mintB].includes(WRAPPED_SOL_MINT)
        )
          unavailable('GENERIC_BRIDGE_ORIENTATION');
        links.push(link);
      } catch (e) {
        rejected.push({ pool, reason: e instanceof Error ? e.message : 'GENERIC_BRIDGE_INVALID' });
      }
    }
    const attempts = links.slice(0, 4),
      choices: Topology[] = [];
    const prepared: Topology[] = [];
    for (const bridge of attempts) {
      const addresses = [
        ...new Set([
          curve,
          target,
          mint,
          quote,
          WRAPPED_SOL_MINT,
          p.baseVault,
          p.quoteVault,
          bridge.pool,
          bridge.vaultA,
          bridge.vaultB,
          bridge.config!,
          ...(bridge.extraAccounts ?? []),
          await pumpSwapGlobalConfigAddress(),
          await pumpSwapFeeConfigAddress(),
          CLOCK,
        ]),
      ];
      if (addresses.length > 100) unavailable('GENERIC_ATOMIC_BATCH_LIMIT');
      const candidate: Topology = {
        mint,
        quote,
        target,
        bridge,
        addresses,
        until: 0,
        reference: '0',
        recoveryPpb: '0',
      };
      prepared.push(candidate);
    }
    const snapshots = prepared.length ? await this.captureMany(prepared) : [];
    for (const [index, candidate] of prepared.entries()) {
      const bridge = candidate.bridge;
      try {
        const snapshot = snapshots[index]!;
        await this.engine.validate(snapshot, {
          nowMs: Date.parse(snapshot.observedAt),
          maxAgeMs: 10000,
        });
        for (const reference of references) {
          try {
            const policy = { nowMs: Date.parse(snapshot.observedAt), maxAgeMs: 10000 },
              buy = await this.engine.quote(snapshot, reference, true, policy),
              sell = await this.engine.quote(snapshot, buy.output, false, policy);
            choices.push({
              ...candidate,
              reference: reference.toString(),
              recoveryPpb: ((sell.output * 1000000000n) / reference).toString(),
            });
            break;
          } catch (e) {
            if (
              !(e instanceof ExecutionEngineError) ||
              !['ZERO_EXECUTABLE_OUTPUT', 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'].includes(e.code)
            )
              throw e;
          }
        }
        if (!choices.some((t) => t.bridge.pool === bridge.pool))
          rejected.push({ pool: bridge.pool, reason: 'GENERIC_REFERENCE_LIQUIDITY_UNAVAILABLE' });
      } catch (e) {
        if (e instanceof ExecutionEngineError && e.code === 'RPC_UNAVAILABLE') throw e;
        rejected.push({
          pool: bridge.pool,
          reason: e instanceof Error ? e.message : 'GENERIC_CAPTURE_INVALID',
        });
      }
    }
    if (this.diagnostics.size >= 256)
      this.diagnostics.delete(this.diagnostics.keys().next().value!);
    this.diagnostics.set(this.key(mint, quote), rejected);
    choices.sort((a, b) =>
      compareGenericBridges(
        { reference: a.reference, recoveryPpb: a.recoveryPpb, pool: a.bridge.pool },
        { reference: b.reference, recoveryPpb: b.recoveryPpb, pool: b.bridge.pool },
      ),
    );
    const selected = choices[0];
    if (!selected)
      unavailable(
        rejected.length
          ? 'GENERIC_NO_VALIDATED_BRIDGE: ' +
              rejected.map((r) => r.pool + '=' + r.reason).join('; ')
          : 'GENERIC_SOL_BRIDGE_NOT_FOUND',
      );
    selected.until = Date.now() + 60000;
    if (this.topology.size >= 256) this.topology.delete(this.topology.keys().next().value!);
    this.topology.set(this.key(mint, quote), structuredClone(selected));
    return selected;
  }
  private async captureMany(topologies: Topology[]): Promise<Stage1Snapshot[]> {
    const addresses = [...new Set(topologies.flatMap((t) => t.addresses))];
    if (addresses.length > 100) unavailable('GENERIC_ATOMIC_BATCH_LIMIT');
    const r = await this.rpc.getMultipleAccounts(addresses);
    if (
      r.value.length !== addresses.length ||
      !Number.isSafeInteger(r.context.slot) ||
      r.context.slot < 0
    )
      unavailable('GENERIC_CAPTURE_CARDINALITY_SLOT');
    const all = new Map(addresses.map((a, i) => [a, r.value[i]])),
      observedAt = new Date().toISOString();
    return topologies.map((t) => {
      const accounts: Stage1Snapshot['accounts'] = {},
        absentAccounts: string[] = [];
      t.addresses.forEach((a) => {
        const v = all.get(a);
        if (v) accounts[a] = { owner: v.owner, base64: v.data[0] };
        else absentAccounts.push(a);
      });
      return {
        version: 'NON_SOL_PUMPSWAP_STAGE1_V1',
        mint: t.mint,
        quoteMint: t.quote,
        targetPool: t.target,
        bridgePool: t.bridge.pool,
        slot: r.context.slot,
        observedAt,
        accounts,
        absentAccounts,
      };
    });
  }
  private async capture(t: Topology): Promise<Stage1Snapshot> {
    const s = (await this.captureMany([t]))[0]!;
    await this.engine.validate(s, { nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 });
    return s;
  }
  async loadMarketState(identity: MarketIdentity): Promise<MarketState> {
    const parts = identity.marketId.split(':');
    if (
      identity.protocolId !== GENERIC_PUMP_SWAP_PROTOCOL_ID ||
      parts.length !== 4 ||
      parts[1] !== identity.tokenMint
    )
      unavailable('GENERIC_EXECUTION_IDENTITY');
    const quote = parts[2]!,
      bridge = parts[3]!,
      key = this.key(identity.tokenMint, quote);
    let t = this.pinned.get(identity.marketId) ?? this.topology.get(key);
    if (!t || t.until <= Date.now()) {
      if (t?.pinned) await this.resolvePinned(identity.tokenMint, quote, bridge);
      else await this.resolve(identity.tokenMint, quote);
      t = this.pinned.get(identity.marketId) ?? this.topology.get(key);
    }
    if (!t || t.bridge.pool !== bridge) unavailable('GENERIC_PINNED_ROUTE_CHANGED');
    try {
      const snapshot = await this.capture(t),
        policy = { nowMs: Date.parse(snapshot.observedAt), maxAgeMs: 10000 };
      const link = orcaLink(snapshot.bridgePool, snapshot.accounts[snapshot.bridgePool]!);
      assertOrcaSnapshot(link, snapshot.accounts, snapshot.absentAccounts);
      // Recheck SDK traversal on current arrays. Proven size/liquidity failure is not missing state.
      for (const reference of t.pinned ? [] : references) {
        try {
          const buy = await this.engine.quote(snapshot, reference, true, policy);
          await this.engine.quote(snapshot, buy.output, false, policy);
          break;
        } catch (e) {
          if (
            !(e instanceof ExecutionEngineError) ||
            !['ZERO_EXECUTABLE_OUTPUT', 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'].includes(e.code)
          )
            throw e;
        }
      }
      const state = await pumpSwapStateFromSnapshot(
        identity,
        snapshot,
        this.engine,
        GENERIC_PUMP_SWAP_VERSION,
        NORMALIZATION,
      );
      return {
        ...state,
        normalizedState: {
          ...state.normalizedState,
          routePolicy: 'GENERIC_FIXED_ORCA_V1',
          referenceInput: t.reference,
          referenceRecoveryPpb: t.recoveryPpb,
        },
      };
    } catch (e) {
      this.topology.delete(key);
      this.pinned.delete(identity.marketId);
      throw e;
    }
  }
}
function assertGenericBinding(s: Stage1Snapshot) {
  assertGenericQuoteMechanics(s.quoteMint);
  const target = s.accounts[s.targetPool],
    bridge = s.accounts[s.bridgePool];
  if (
    !target ||
    target.owner !== PUMP_AMM_PROGRAM_ID ||
    !bridge ||
    bridge.owner !== ORCA_WHIRLPOOL_PROGRAM
  )
    unavailable('GENERIC_SNAPSHOT_PROGRAM');
  const p = decodePumpSwapPool(Buffer.from(target.base64, 'base64')),
    b = orcaLink(s.bridgePool, bridge);
  if (
    p.baseMint !== s.mint ||
    p.quoteMint !== s.quoteMint ||
    ![b.mintA, b.mintB].includes(s.quoteMint) ||
    ![b.mintA, b.mintB].includes(WRAPPED_SOL_MINT)
  )
    unavailable('GENERIC_SNAPSHOT_BINDING');
}
export class GenericPumpSwapAdapter extends NonSolPumpSwapAdapter {
  private live = new WeakMap<MarketState, GenericPermission>();
  constructor(
    source: GenericPumpSwapSource,
    private readonly buysEnabled: boolean | (() => boolean) = true,
    private readonly permissionProvider?: () => GenericPermission | undefined,
  ) {
    super(source, {
      protocolId: GENERIC_PUMP_SWAP_PROTOCOL_ID,
      adapterVersion: GENERIC_PUMP_SWAP_VERSION,
      normalizationVersion: NORMALIZATION,
      identity: genericPumpSwapIdentity,
      assertBinding: assertGenericBinding,
      buysEnabled: typeof buysEnabled === 'boolean' ? buysEnabled : false,
    });
  }
  override async loadMarketState(identity: MarketIdentity): Promise<MarketState> {
    const state = await this.source.loadMarketState(identity);
    // The admission observation is server-owned execution evidence. Historical BUY replay
    // uses its recorded value; current authoritative loads always refresh this permission.
    const current: MarketState = {
      ...state,
      normalizedState: {
        ...state.normalizedState,
        genericBuyAdmissionAllowed:
          typeof this.buysEnabled === 'function' ? this.buysEnabled() : this.buysEnabled,
      },
    };
    const permission = this.permissionProvider?.();
    if (permission) this.live.set(current, permission);
    return current;
  }
  override async simulateBuy(r: BuySimulationRequest, s: MarketState) {
    await this.live.get(s)?.authorizeLive?.('BUY');
    return super.simulateBuy(r, s);
  }
  override async simulateSell(r: SellSimulationRequest, s: MarketState) {
    await this.live.get(s)?.authorizeLive?.('SELL');
    return super.simulateSell(r, s);
  }
}
