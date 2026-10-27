import { APPROVED_NON_SOL_PUMPSWAP_ROUTES, validateNonSolPumpSwapRoutes, } from '@paperfund/config';
/** Canonical wrapper for the independently validated Stage 1 calculator. Routing is separately gated. */
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant, } from '@paperfund/core';
import { ExecutionEngineError, createMarketStateEvidence, executionRouteRecord, } from '@paperfund/execution';
import { Stage1NonSolPumpSwap, STAGE1_BRIDGES, } from './experimental/non-sol-pump-swap.js';
import { decodePumpSwapPool, canonicalPumpSwapPoolAddress, pumpPoolAuthorityAddress, PUMP_AMM_PROGRAM_ID, } from './pump-swap.js';
import { WRAPPED_SOL_MINT, SPL_TOKEN_PROGRAM_ID } from './pump-fun.js';
import { orcaLink, ORCA_WHIRLPOOL_PROGRAM } from './composed-pump-orca.js';
import { advisoryClockTime } from './rpc-read-context.js';
export const NON_SOL_PUMP_SWAP_PROTOCOL_ID = identifier('NON_SOL_PUMP_SWAP', 'ProtocolId');
export const NON_SOL_PUMP_SWAP_VERSION = 'non-sol-pump-swap-canonical-v1';
export function nonSolPumpSwapIdentity(mint, quote) {
    return {
        protocolId: NON_SOL_PUMP_SWAP_PROTOCOL_ID,
        marketId: identifier('non-sol-pump-swap:' + mint + ':' + quote, 'MarketId'),
        tokenMint: identifier(mint, 'TokenMint'),
    };
}
function reject(reason) {
    throw new ExecutionEngineError('POSITION_EXECUTION_ROUTE_UNAVAILABLE', reason);
}
const json = (value) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
export function assertNonSolRouteBinding(s) {
    const row = APPROVED_NON_SOL_PUMPSWAP_ROUTES.find((r) => r.mint === s.mint);
    if (!row ||
        s.targetPool !== row.targetPool ||
        s.quoteMint !== row.quoteMint ||
        s.bridgePool !== row.bridgePool)
        reject('NON_SOL_ALLOWLIST_ROUTE_MISMATCH');
    const target = s.accounts[s.targetPool], bridge = s.accounts[s.bridgePool];
    if (target?.owner !== row.targetProgram ||
        bridge?.owner !== row.bridgeProgram ||
        s.accounts[s.mint]?.owner !== row.baseTokenProgram ||
        s.accounts[s.quoteMint]?.owner !== row.quoteTokenProgram ||
        s.accounts[WRAPPED_SOL_MINT]?.owner !== SPL_TOKEN_PROGRAM_ID)
        reject('NON_SOL_ALLOWLIST_PROGRAM_MISMATCH');
    const p = decodePumpSwapPool(Buffer.from(target.base64, 'base64')), link = orcaLink(s.bridgePool, bridge);
    if (p.baseVault !== row.targetBaseVault ||
        p.quoteVault !== row.targetQuoteVault ||
        (link.mintA === WRAPPED_SOL_MINT ? link.vaultA : link.vaultB) !== row.bridgeSolVault ||
        (link.mintA === s.quoteMint ? link.vaultA : link.vaultB) !== row.bridgeQuoteVault)
        reject('NON_SOL_ALLOWLIST_VAULT_MISMATCH');
}
export class NonSolPumpSwapSource {
    rpc;
    engine = new Stage1NonSolPumpSwap({ purpose: 'READ_ONLY_STAGE1_VALIDATION' });
    routes;
    constructor(rpc, routes = []) {
        this.rpc = rpc;
        this.routes = routes.length ? validateNonSolPumpSwapRoutes(routes) : Object.freeze([]);
    }
    async resolve(mint, quote) {
        const allowed = this.routes.find((r) => r.mint === mint && r.quoteMint === quote);
        if (!allowed)
            reject('NON_SOL_NOT_ALLOWLISTED');
        const bridge = STAGE1_BRIDGES[quote];
        if (!bridge)
            reject('NON_SOL_QUOTE_NOT_VALIDATED');
        const target = await canonicalPumpSwapPoolAddress(mint, quote), r = await this.rpc.getMultipleAccounts([target, bridge]);
        if (r.value.length !== 2)
            reject('NON_SOL_DISCOVERY_CARDINALITY');
        const p = r.value[0], b = r.value[1];
        if (!p || p.owner !== PUMP_AMM_PROGRAM_ID || !b || b.owner !== ORCA_WHIRLPOOL_PROGRAM)
            reject('NON_SOL_BOUND_POOLS_UNAVAILABLE');
        const pool = decodePumpSwapPool(Buffer.from(p.data[0], 'base64'));
        if (pool.index !== 0 ||
            pool.creator !== (await pumpPoolAuthorityAddress(mint)) ||
            pool.baseMint !== mint ||
            pool.quoteMint !== quote)
            reject('NON_SOL_CANONICAL_LINKAGE');
        const link = orcaLink(bridge, { owner: b.owner, base64: b.data[0] });
        if (![link.mintA, link.mintB].includes(quote) ||
            ![link.mintA, link.mintB].includes(WRAPPED_SOL_MINT))
            reject('NON_SOL_BRIDGE_LINKAGE');
        return nonSolPumpSwapIdentity(mint, quote);
    }
    async loadMarketState(identity) {
        if (!this.routes.some((r) => nonSolPumpSwapIdentity(r.mint, r.quoteMint).marketId === identity.marketId &&
            r.mint === identity.tokenMint))
            reject('NON_SOL_NOT_ALLOWLISTED');
        return this.state(identity, await this.engine.capture(this.rpc, identity.tokenMint));
    }
    async state(identity, snapshot) {
        const s = structuredClone(snapshot), expected = nonSolPumpSwapIdentity(s.mint, s.quoteMint);
        if (identity.protocolId !== expected.protocolId ||
            identity.marketId !== expected.marketId ||
            identity.tokenMint !== expected.tokenMint)
            reject('NON_SOL_EXECUTION_IDENTITY');
        assertNonSolRouteBinding(s);
        return pumpSwapStateFromSnapshot(identity, s, this.engine);
    }
}
export async function pumpSwapStateFromSnapshot(identity, s, engine, adapterVersion = NON_SOL_PUMP_SWAP_VERSION, normalizationVersion = 'non-sol-pump-swap-accounts-v1') {
    const v = await engine.validate(s, { nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 });
    const p = decodePumpSwapPool(Buffer.from(s.accounts[s.targetPool].base64, 'base64')), clock = s.accounts['SysvarC1ock11111111111111111111111111111111'];
    const hops = [
        {
            pool: s.targetPool,
            programId: PUMP_AMM_PROGRAM_ID,
            mintA: s.mint,
            mintB: s.quoteMint,
            baseVault: p.baseVault,
            quoteVault: p.quoteVault,
        },
        {
            pool: s.bridgePool,
            programId: ORCA_WHIRLPOOL_PROGRAM,
            mintA: v.bridge.mintA,
            mintB: v.bridge.mintB,
            baseVault: v.bridge.vaultA,
            quoteVault: v.bridge.vaultB,
        },
    ];
    return {
        identity,
        adapterVersion: adapterVersion,
        normalizationVersion: normalizationVersion,
        observedAt: utcInstant(s.observedAt),
        chainSlot: BigInt(s.slot),
        chainBlockId: null,
        normalizedState: {
            model: 'NON_SOL_PUMP_SWAP_ROUTE',
            tokenDecimals: v.baseDecimals.toString(),
            accounts: s.accounts,
            stage1Snapshot: json(s),
            hops,
            chainTime: advisoryClockTime({ owner: clock.owner, data: [clock.base64, 'base64'] }, s.slot),
        },
    };
}
export class NonSolPumpSwapAdapter {
    source;
    policy;
    protocolId;
    adapterVersion;
    constructor(source, policy = {
        protocolId: NON_SOL_PUMP_SWAP_PROTOCOL_ID,
        adapterVersion: NON_SOL_PUMP_SWAP_VERSION,
        normalizationVersion: 'non-sol-pump-swap-accounts-v1',
        identity: nonSolPumpSwapIdentity,
        assertBinding: assertNonSolRouteBinding,
        buysEnabled: true,
    }) {
        this.source = source;
        this.policy = policy;
        this.protocolId = policy.protocolId;
        this.adapterVersion = policy.adapterVersion;
    }
    loadMarketState(identity) {
        return this.source.loadMarketState(identity);
    }
    async quote(identity, state, input, buy) {
        const s = state.normalizedState['stage1Snapshot'];
        if (!s ||
            !Number.isSafeInteger(s.slot) ||
            s.slot < 0 ||
            !s.accounts ||
            state.adapterVersion !== this.adapterVersion ||
            state.normalizationVersion !== this.policy.normalizationVersion ||
            state.normalizedState['model'] !== 'NON_SOL_PUMP_SWAP_ROUTE' ||
            state.chainSlot !== BigInt(s.slot) ||
            state.observedAt !== s.observedAt ||
            identity.protocolId !== this.protocolId ||
            identity.marketId !== this.policy.identity(s.mint, s.quoteMint, s.bridgePool).marketId ||
            identity.tokenMint !== s.mint ||
            state.identity.protocolId !== identity.protocolId ||
            state.identity.marketId !== identity.marketId ||
            state.identity.tokenMint !== identity.tokenMint)
            reject('NON_SOL_STATE_IDENTITY');
        this.policy.assertBinding(s);
        if (buy &&
            !this.policy.buysEnabled &&
            state.normalizedState['genericBuyAdmissionAllowed'] !== true)
            reject('GENERIC_BUY_DISABLED_EXIT_ONLY');
        const q = await this.source.engine.quote(s, input, buy, {
            nowMs: Date.parse(s.observedAt),
            maxAgeMs: 10000,
        });
        if (state.normalizedState['tokenDecimals'] !== q.baseDecimals.toString())
            reject('NON_SOL_STATE_DECIMALS');
        return q;
    }
    fees(q) {
        const asset = (mint, n) => mint === WRAPPED_SOL_MINT
            ? { asset: 'PAPER_SOL', amount: paperSolBaseUnits(n) }
            : { asset: 'TOKEN', tokenMint: identifier(mint, 'TokenMint'), amount: tokenBaseUnits(n) };
        return [
            { category: 'AMM_TRADE_FEE', amount: asset(q.bridge.feeMint, q.bridge.lp) },
            ...['lp', 'protocol', 'creator'].map((k) => ({
                category: k === 'creator' && q.creatorFeeDestination === 'HOLDER_REWARD'
                    ? 'PUMP_SWAP_HOLDER_REWARD_FEE'
                    : 'PUMP_SWAP_' + k.toUpperCase() + '_FEE',
                amount: asset(q.quoteMint, q.target.fees[k]),
            })),
        ].filter((f) => f.amount.amount > 0n);
    }
    hops(q, state) {
        const s = state.normalizedState['stage1Snapshot'];
        const target = {
            pool: s.targetPool,
            programId: PUMP_AMM_PROGRAM_ID,
            inputMint: q.buy ? s.quoteMint : s.mint,
            outputMint: q.buy ? s.mint : s.quoteMint,
            input: q.target.input.toString(),
            output: q.target.output.toString(),
            fees: json(q.target.fees),
            postTrade: json(q.target.post),
        };
        const bridge = {
            pool: s.bridgePool,
            programId: ORCA_WHIRLPOOL_PROGRAM,
            inputMint: q.buy ? WRAPPED_SOL_MINT : s.quoteMint,
            outputMint: q.buy ? s.quoteMint : WRAPPED_SOL_MINT,
            input: (q.buy ? q.input : q.target.output).toString(),
            output: q.bridge.output.toString(),
            ...q.bridge.detail,
        };
        return q.buy ? [bridge, target] : [target, bridge];
    }
    async execute(request, state, buy) {
        const input = buy
            ? request.requestedPaperSol
            : request.requestedTokenQuantity;
        const q = await this.quote(request.identity, state, input, buy), fees = this.fees(q);
        const from = buy
            ? { asset: 'PAPER_SOL', amount: paperSolBaseUnits(q.input) }
            : { asset: 'TOKEN', tokenMint: request.identity.tokenMint, amount: tokenBaseUnits(q.input) };
        const to = buy
            ? { asset: 'TOKEN', tokenMint: request.identity.tokenMint, amount: tokenBaseUnits(q.output) }
            : { asset: 'PAPER_SOL', amount: paperSolBaseUnits(q.output) };
        return {
            id: request.executionId,
            orderId: request.orderId,
            quote: {
                orderId: request.orderId,
                marketId: request.identity.marketId,
                protocolId: this.protocolId,
                adapterVersion: this.adapterVersion,
                marketStateRecordedAt: state.observedAt,
                marketStateFingerprint: createMarketStateEvidence(state).fingerprint,
                normalizationVersion: state.normalizationVersion,
                requestedInput: from,
                simulatedOutput: to,
                fees,
            },
            actualInput: from,
            actualOutput: to,
            executedAt: request.executedAt,
            executionDetails: { hops: this.hops(q, state) },
        };
    }
    simulateBuy(r, s) {
        return this.execute(r, s, true);
    }
    simulateSell(r, s) {
        return this.execute(r, s, false);
    }
    async valuePositionForExit(r, s) {
        const q = await this.quote(r.identity, s, r.tokenQuantity, false), fees = this.fees(q);
        return {
            identity: r.identity,
            tokenQuantity: r.tokenQuantity,
            paperSolValue: paperSolBaseUnits(q.output),
            adapterVersion: this.adapterVersion,
            marketStateFingerprint: createMarketStateEvidence(s).fingerprint,
            route: executionRouteRecord(s, false, this.hops(q, s)),
            feeBreakdown: {
                fees,
                totalPaperSolFees: paperSolBaseUnits(fees.reduce((n, f) => n + (f.amount.asset === 'PAPER_SOL' ? f.amount.amount : 0n), 0n)),
            },
        };
    }
    async maxExecutableSellQuantity(r, s) {
        // Verify canonical identity first even when the full quote is liquidity limited.
        try {
            await this.quote(r.identity, s, r.tokenQuantity, false);
        }
        catch (e) {
            if (!(e instanceof ExecutionEngineError) ||
                !['ZERO_EXECUTABLE_OUTPUT', 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'].includes(e.code))
                throw e;
        }
        const snapshot = s.normalizedState['stage1Snapshot'];
        const exit = await this.source.engine.exits(snapshot, r.tokenQuantity, {
            nowMs: Date.parse(snapshot.observedAt),
            maxAgeMs: 10000,
        });
        return tokenBaseUnits(exit.maxQuantity);
    }
}
//# sourceMappingURL=non-sol-pump-swap.js.map