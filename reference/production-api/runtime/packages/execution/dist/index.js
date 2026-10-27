import { createHash } from 'node:crypto';
import { tokenBaseUnits } from '@paperfund/core';
export class ExecutionEngineError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'ExecutionEngineError';
    }
}
function canonicalize(value) {
    if (typeof value === 'bigint')
        return { $bigint: value.toString() };
    if (Array.isArray(value))
        return value.map((item) => canonicalize(item));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, canonicalize(item)]));
    }
    return value;
}
/** Stable UTF-8 JSON: recursively sorted object keys, preserved array order, tagged bigint values. */
export function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}
export function marketStateFingerprint(state) {
    const envelope = {
        adapterVersion: state.adapterVersion,
        chainBlockId: state.chainBlockId,
        chainSlot: state.chainSlot === null ? null : state.chainSlot.toString(),
        identity: {
            marketId: state.identity.marketId,
            protocolId: state.identity.protocolId,
            tokenMint: state.identity.tokenMint,
        },
        normalizationVersion: state.normalizationVersion,
        normalizedState: state.normalizedState,
        observedAt: state.observedAt,
    };
    return createHash('sha256').update(canonicalJson(envelope)).digest('hex');
}
export function createMarketStateEvidence(state) {
    return { ...state, fingerprint: marketStateFingerprint(state) };
}
/** Explicit route identity plus snapshot identity; amounts remain exact base-unit strings. */
export function executionRouteRecord(state, buy, quotedHops) {
    const rawHops = quotedHops ??
        state.normalizedState['hops'] ?? [
        {
            pool: state.identity.marketId,
            program: state.normalizedState['programId'] ?? state.identity.protocolId,
            mintA: state.identity.tokenMint,
            mintB: state.normalizedState['quoteMint'] ?? 'So11111111111111111111111111111111111111112',
        },
    ];
    let currentMint = buy
        ? 'So11111111111111111111111111111111111111112'
        : state.identity.tokenMint;
    const ordered = Array.isArray(rawHops)
        ? !quotedHops && buy
            ? [...rawHops].reverse()
            : rawHops
        : [];
    const hops = ordered.map((h) => {
        const hop = h;
        const inputMint = hop['inputMint'] ?? currentMint;
        const outputMint = hop['outputMint'] ?? (inputMint === hop['mintA'] ? hop['mintB'] : hop['mintA']) ?? null;
        currentMint = outputMint;
        return {
            ...hop,
            inputMint,
            outputMint,
            direction: buy ? 'BUY' : 'SELL',
            chainSlot: state.chainSlot?.toString() ?? null,
        };
    });
    const path = {
        mint: state.identity.tokenMint,
        protocol: state.identity.protocolId,
        direction: buy ? 'BUY' : 'SELL',
        hops: Array.isArray(hops)
            ? hops.map((h) => {
                const hop = h;
                return {
                    pool: hop['pool'] ?? null,
                    program: hop['programId'] ?? hop['program'] ?? hop['protocol'] ?? null,
                    inputMint: hop['inputMint'] ?? null,
                    outputMint: hop['outputMint'] ?? null,
                };
            })
            : hops,
    };
    return {
        ...path,
        hops,
        topologyHash: createHash('sha256')
            .update(canonicalJson({
            mint: state.identity.tokenMint,
            protocol: state.identity.protocolId,
            hops: (buy ? [...hops].reverse() : hops).map((hop) => ({
                pool: hop.pool ?? null,
                program: hop.programId ?? hop.program ?? hop.protocol ?? null,
                inputMint: (buy ? hop.outputMint : hop.inputMint) ?? null,
                outputMint: (buy ? hop.inputMint : hop.outputMint) ?? null,
            })),
        }))
            .digest('hex'),
        routeHash: createHash('sha256').update(canonicalJson(path)).digest('hex'),
        direction: buy ? 'BUY' : 'SELL',
        inputAsset: buy ? 'PAPER_SOL' : state.identity.tokenMint,
        outputAsset: buy ? state.identity.tokenMint : 'PAPER_SOL',
        observedAt: state.observedAt,
        chainSlot: state.chainSlot?.toString() ?? null,
        stateFingerprint: marketStateFingerprint(state),
    };
}
function validatedAdapter(adapter, log) {
    const invalid = () => {
        throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Canonical quote is missing, malformed or not bound to its snapshot.');
    };
    const validateFees = (fees) => {
        if (!Array.isArray(fees) ||
            fees.some((f) => !f?.amount ||
                typeof f.category !== 'string' ||
                !f.category ||
                typeof f.amount.amount !== 'bigint' ||
                f.amount.amount < 0n ||
                !['PAPER_SOL', 'TOKEN'].includes(f.amount.asset) ||
                (f.amount.asset === 'TOKEN' && !f.amount.tokenMint)))
            invalid();
    };
    const validateState = (identity, state) => {
        if (identity.marketId !== state.identity.marketId ||
            identity.protocolId !== state.identity.protocolId ||
            identity.tokenMint !== state.identity.tokenMint ||
            state.adapterVersion !== adapter.adapterVersion)
            invalid();
    };
    const valuePositionForExit = async (request, state) => {
        validateState(request.identity, state);
        if (typeof request.tokenQuantity !== 'bigint' || request.tokenQuantity <= 0n)
            invalid();
        const value = await adapter.valuePositionForExit(request, state);
        if (!value ||
            typeof value.paperSolValue !== 'bigint' ||
            value.paperSolValue < 0n ||
            value.tokenQuantity !== request.tokenQuantity ||
            value.identity?.marketId !== request.identity.marketId ||
            value.identity?.protocolId !== request.identity.protocolId ||
            value.identity?.tokenMint !== request.identity.tokenMint ||
            value.adapterVersion !== adapter.adapterVersion ||
            value.marketStateFingerprint !== marketStateFingerprint(state) ||
            typeof value.feeBreakdown?.totalPaperSolFees !== 'bigint' ||
            value.feeBreakdown.totalPaperSolFees < 0n)
            invalid();
        validateFees(value.feeBreakdown.fees);
        if (value.feeBreakdown.totalPaperSolFees !==
            value.feeBreakdown.fees.reduce((sum, f) => sum + (f.amount.asset === 'PAPER_SOL' ? f.amount.amount : 0n), 0n))
            invalid();
        log('EXECUTABLE_VALUATION', {
            ...(value.route ?? executionRouteRecord(state, false)),
            input: request.tokenQuantity.toString(),
            output: value.paperSolValue.toString(),
            fees: canonicalize(value.feeBreakdown.fees),
        });
        return value;
    };
    const execute = async (request, state, buy) => {
        validateState(request.identity, state);
        const requested = buy
            ? request.requestedPaperSol
            : request.requestedTokenQuantity;
        if (typeof requested !== 'bigint' || requested <= 0n)
            invalid();
        const result = buy
            ? await adapter.simulateBuy(request, state)
            : await adapter.simulateSell(request, state);
        if (!result ||
            typeof result.actualInput?.amount !== 'bigint' ||
            result.actualInput.amount <= 0n ||
            typeof result.actualOutput?.amount !== 'bigint' ||
            result.actualOutput.amount <= 0n ||
            result.actualInput.amount > requested ||
            result.quote?.requestedInput?.amount !== requested ||
            result.quote.requestedInput.asset !== (buy ? 'PAPER_SOL' : 'TOKEN') ||
            result.orderId !== request.orderId ||
            result.id !== request.executionId ||
            result.quote?.marketStateFingerprint !== marketStateFingerprint(state) ||
            result.quote.adapterVersion !== adapter.adapterVersion ||
            result.quote.marketId !== request.identity.marketId ||
            result.quote.protocolId !== request.identity.protocolId)
            invalid();
        validateFees(result.quote.fees);
        if (result.actualInput.asset !== (buy ? 'PAPER_SOL' : 'TOKEN') ||
            result.actualOutput.asset !== (buy ? 'TOKEN' : 'PAPER_SOL') ||
            (result.actualInput.asset === 'TOKEN' &&
                result.actualInput.tokenMint !== request.identity.tokenMint) ||
            (result.actualOutput.asset === 'TOKEN' &&
                result.actualOutput.tokenMint !== request.identity.tokenMint) ||
            result.quote.simulatedOutput?.asset !== result.actualOutput.asset ||
            result.quote.simulatedOutput?.amount !== result.actualOutput.amount)
            invalid();
        const record = {
            ...executionRouteRecord(state, buy, result.executionDetails?.['hops']),
            orderId: request.orderId,
            executionId: request.executionId,
            requestedInput: result.quote.requestedInput.amount.toString(),
            input: result.actualInput.amount.toString(),
            output: result.actualOutput.amount.toString(),
            fees: canonicalize(result.quote.fees),
        };
        log(buy ? 'BUY_ROUTE' : 'SELL_ROUTE', record);
        let immediateReverse;
        if (buy) {
            try {
                const valuationRequest = {
                    identity: request.identity,
                    tokenQuantity: result.actualOutput.amount,
                };
                let value;
                try {
                    value = await valuePositionForExit(valuationRequest, state);
                }
                catch (error) {
                    if (!(error instanceof ExecutionEngineError) ||
                        !['ZERO_EXECUTABLE_OUTPUT', 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'].includes(error.code) ||
                        !adapter.maxExecutableSellQuantity)
                        throw error;
                    const max = await adapter.maxExecutableSellQuantity(valuationRequest, state);
                    if (typeof max !== 'bigint' || max < 0n || max > valuationRequest.tokenQuantity)
                        invalid();
                    if (max === 0n) {
                        immediateReverse = {
                            status: 'AVAILABLE',
                            executableValue: '0',
                            executableQuantity: '0',
                            route: executionRouteRecord(state, false),
                        };
                        log('EXECUTION_VALUATION_ANOMALY', {
                            mint: request.identity.tokenMint,
                            basis: result.actualInput.amount.toString(),
                            executableValue: '0',
                            percentDifferenceBps: '-10000',
                            cause: 'AUTHORITATIVE_NO_EXECUTABLE_LIQUIDITY',
                            buyRoute: record,
                            sellRoute: executionRouteRecord(state, false),
                            executableQuantity: '0',
                        });
                        return {
                            ...result,
                            executionDetails: {
                                ...result.executionDetails,
                                canonicalRoute: record,
                                immediateReverse,
                            },
                        };
                    }
                    value = await valuePositionForExit({ ...valuationRequest, tokenQuantity: max }, state);
                }
                const basis = result.actualInput.amount;
                immediateReverse = {
                    status: 'AVAILABLE',
                    executableValue: value.paperSolValue.toString(),
                    executableQuantity: value.tokenQuantity.toString(),
                    fees: canonicalize(value.feeBreakdown.fees),
                    route: value.route ?? executionRouteRecord(state, false),
                };
                log('BUY_REVERSE_VALUATION', { buyRoute: record, ...immediateReverse });
                if (value.paperSolValue * 100n < basis * 75n)
                    log('EXECUTION_VALUATION_ANOMALY', {
                        mint: request.identity.tokenMint,
                        basis: basis.toString(),
                        executableValue: value.paperSolValue.toString(),
                        percentDifferenceBps: (((value.paperSolValue - basis) * 10000n) / basis).toString(),
                        buyRoute: record,
                        sellRoute: value.route ?? executionRouteRecord(state, false),
                    });
            }
            catch (error) {
                log('IMMEDIATE_VALUATION_UNAVAILABLE', {
                    mint: request.identity.tokenMint,
                    buyRoute: record,
                    reason: error instanceof ExecutionEngineError ? error.code : 'MARKET_STATE_UNAVAILABLE',
                    message: error instanceof Error ? error.message : 'Unknown reverse-route failure',
                });
                // Missing/malformed reverse state is unavailable, never a valid near-zero exit.
                throw error;
            }
        }
        return {
            ...result,
            executionDetails: {
                ...result.executionDetails,
                canonicalRoute: record,
                ...(immediateReverse ? { immediateReverse } : {}),
            },
        };
    };
    return {
        protocolId: adapter.protocolId,
        adapterVersion: adapter.adapterVersion,
        loadMarketState: (identity) => adapter.loadMarketState(identity),
        simulateBuy: (request, state) => execute(request, state, true),
        simulateSell: (request, state) => execute(request, state, false),
        valuePositionForExit,
        ...(adapter.maxExecutableSellQuantity
            ? {
                maxExecutableSellQuantity: async (request, state) => {
                    validateState(request.identity, state);
                    const quantity = await adapter.maxExecutableSellQuantity(request, state);
                    if (typeof quantity !== 'bigint' || quantity < 0n || quantity > request.tokenQuantity)
                        invalid();
                    return quantity;
                },
            }
            : {}),
    };
}
export class ExecutionRouter {
    diagnostic;
    /** Production discovery is independent of the terminal that supplied the mint. */
    mintResolver;
    /** Display identity only. Does not resolve execution or register a market. */
    chartMetadataResolver;
    contextResolver;
    /** Production venue discovery, shared by every caller and independent of trade direction. */
    canonicalResolver;
    #adapters = new Map();
    #enabled = new Map();
    #routeResolvers = new Map();
    /** One uncached state-loading boundary for execution, preflight, equity and settlement. */
    async loadPositionRoute(identity, forSettlement = false) {
        try {
            const resolved = await this.resolvePositionRoute(identity, forSettlement);
            const state = await resolved.adapter.loadMarketState(resolved.route.executionIdentity);
            const expected = resolved.route.executionIdentity;
            if (state.identity.protocolId !== expected.protocolId ||
                state.identity.marketId !== expected.marketId ||
                state.identity.tokenMint !== expected.tokenMint ||
                state.adapterVersion !== resolved.adapter.adapterVersion ||
                (state.chainSlot !== null && (typeof state.chainSlot !== 'bigint' || state.chainSlot < 0n)))
                throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Canonical route snapshot identity is invalid.');
            return { ...resolved, state };
        }
        catch (error) {
            this.emit('ROUTE_UNAVAILABLE', {
                mint: identity.tokenMint,
                market: identity.marketId,
                reason: error instanceof ExecutionEngineError ? error.code : 'MARKET_STATE_UNAVAILABLE',
                message: error instanceof Error ? error.message : 'Unknown route failure',
            });
            if (error instanceof ExecutionEngineError)
                throw error;
            throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'Canonical route snapshot is unavailable.');
        }
    }
    emit(event, metadata) {
        try {
            this.diagnostic?.(event, metadata);
        }
        catch {
            /* Diagnostics cannot change financial behavior. */
        }
    }
    constructor(adapters = []) {
        for (const adapter of adapters)
            this.register(adapter);
    }
    register(adapter) {
        if (this.#adapters.has(adapter.protocolId)) {
            throw new ExecutionEngineError('DUPLICATE_PROTOCOL', `Protocol ${adapter.protocolId} already has a registered adapter.`);
        }
        this.#adapters.set(adapter.protocolId, validatedAdapter(adapter, (event, data) => this.emit(event, data)));
        this.#enabled.set(adapter.protocolId, true);
    }
    registerRouteResolver(resolver) {
        if (this.#routeResolvers.has(resolver.originProtocolId)) {
            throw new ExecutionEngineError('DUPLICATE_PROTOCOL', `Protocol ${resolver.originProtocolId} already has an execution-route resolver.`);
        }
        this.#routeResolvers.set(resolver.originProtocolId, resolver);
    }
    /** Resolve the current venue without changing the position's economic identity. */
    async resolvePositionRoute(identity, forSettlement = false) {
        const resolver = this.#routeResolvers.get(identity.protocolId);
        let route;
        try {
            route = this.canonicalResolver
                ? await this.canonicalResolver(identity)
                : resolver
                    ? await resolver.resolveExecutionRoute(identity)
                    : { originIdentity: identity, executionIdentity: identity, migrated: false };
        }
        catch (error) {
            if (error instanceof ExecutionEngineError)
                throw error;
            throw new ExecutionEngineError('POSITION_EXECUTION_ROUTE_UNAVAILABLE', 'The current execution venue for this position could not be resolved.');
        }
        if (route.originIdentity.protocolId !== identity.protocolId ||
            route.originIdentity.marketId !== identity.marketId ||
            route.originIdentity.tokenMint !== identity.tokenMint ||
            route.executionIdentity.tokenMint !== identity.tokenMint) {
            throw new ExecutionEngineError('POSITION_EXECUTION_ROUTE_UNAVAILABLE', 'The resolved execution route does not preserve the position token identity.');
        }
        const adapter = forSettlement
            ? this.resolveForSettlement(route.executionIdentity.protocolId)
            : this.resolve(route.executionIdentity.protocolId);
        return { route, adapter };
    }
    resolve(protocolId) {
        const adapter = this.#adapters.get(protocolId);
        if (!adapter) {
            throw new ExecutionEngineError('UNSUPPORTED_PROTOCOL', `No execution adapter is registered for protocol ${protocolId}.`);
        }
        if (this.#enabled.get(protocolId) === false) {
            throw new ExecutionEngineError('PROTOCOL_DISABLED', `Protocol ${protocolId} is disabled for new user trading.`);
        }
        return adapter;
    }
    /** Operational switch for new user exposure. Forced liquidation remains available. */
    setEnabled(protocolId, enabled) {
        if (!this.#adapters.has(protocolId)) {
            throw new ExecutionEngineError('UNSUPPORTED_PROTOCOL', `No execution adapter is registered for protocol ${protocolId}.`);
        }
        this.#enabled.set(protocolId, enabled);
    }
    isEnabled(protocolId) {
        return this.#enabled.get(protocolId) === true;
    }
    /** Risk-reducing settlement may use installed code even when new trading is disabled. */
    resolveForSettlement(protocolId) {
        const adapter = this.#adapters.get(protocolId);
        if (!adapter) {
            throw new ExecutionEngineError('UNSUPPORTED_PROTOCOL', `No execution adapter is registered for protocol ${protocolId}.`);
        }
        return adapter;
    }
    resolveVersion(protocolId, adapterVersion) {
        const adapter = this.#adapters.get(protocolId);
        if (!adapter || adapter.adapterVersion !== adapterVersion) {
            throw new ExecutionEngineError('ADAPTER_VERSION_UNAVAILABLE', `Adapter ${protocolId}@${adapterVersion} is unavailable.`);
        }
        return adapter;
    }
}
/** Values every position independently; any missing/failed valuation rejects the whole operation. */
export async function valuePortfolioPositions(router, positions) {
    const valued = [];
    let total = 0n;
    for (const position of positions) {
        const { route, adapter, state } = await router.loadPositionRoute(position.identity);
        const evidence = createMarketStateEvidence(state);
        if (evidence.identity.protocolId !== route.executionIdentity.protocolId ||
            evidence.identity.marketId !== route.executionIdentity.marketId ||
            evidence.identity.tokenMint !== position.identity.tokenMint ||
            evidence.adapterVersion !== adapter.adapterVersion) {
            throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Loaded market state does not match the requested position identity or adapter.');
        }
        const value = await adapter.valuePositionForExit({ identity: route.executionIdentity, tokenQuantity: position.tokenQuantity }, state);
        if (value.marketStateFingerprint !== evidence.fingerprint ||
            value.adapterVersion !== adapter.adapterVersion ||
            value.paperSolValue < 0n) {
            throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Position valuation is not bound to the supplied market state.');
        }
        total += value.paperSolValue;
        valued.push({ position, value, evidence });
    }
    return { totalPaperSolValue: total, positions: valued };
}
const liquidityCodes = new Set(['INSUFFICIENT_EXECUTABLE_LIQUIDITY', 'ZERO_EXECUTABLE_OUTPUT']);
/** Advisory only: every SELL reloads state and is validated by the transactional execution path. */
export async function canonicalExitPreflight(router, identity, quantity, basis, forSettlement = false) {
    if (quantity <= 0n || basis < 0n) {
        throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Invalid position quantity or cost basis.');
    }
    const { route, adapter, state } = await router.loadPositionRoute(identity, forSettlement);
    const evidence = createMarketStateEvidence(state);
    if (state.identity.marketId !== route.executionIdentity.marketId ||
        state.identity.protocolId !== route.executionIdentity.protocolId ||
        state.identity.tokenMint !== identity.tokenMint ||
        state.adapterVersion !== adapter.adapterVersion) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Exit state identity mismatch.');
    }
    const quote = async (amount) => {
        if (amount <= 0n)
            return {
                executable: false,
                quantityBaseUnits: amount,
                outputLamports: null,
                reason: 'ZERO_EXECUTABLE_OUTPUT',
            };
        try {
            const value = await adapter.valuePositionForExit({ identity: route.executionIdentity, tokenQuantity: tokenBaseUnits(amount) }, state);
            if (value.marketStateFingerprint !== evidence.fingerprint ||
                value.adapterVersion !== adapter.adapterVersion ||
                value.identity.marketId !== route.executionIdentity.marketId ||
                value.identity.protocolId !== route.executionIdentity.protocolId ||
                value.identity.tokenMint !== identity.tokenMint ||
                typeof value.paperSolValue !== 'bigint' ||
                value.tokenQuantity !== amount ||
                value.paperSolValue < 0n) {
                throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Exit quote does not match its evidence.');
            }
            if (value.paperSolValue === 0n)
                throw new ExecutionEngineError('ZERO_EXECUTABLE_OUTPUT', 'Exit produces no positive Paper SOL.');
            return {
                executable: true,
                quantityBaseUnits: amount,
                outputLamports: value.paperSolValue,
                reason: null,
            };
        }
        catch (error) {
            if (!(error instanceof ExecutionEngineError) || !liquidityCodes.has(error.code))
                throw error;
            return {
                executable: false,
                quantityBaseUnits: amount,
                outputLamports: null,
                reason: error.code,
            };
        }
    };
    const full = await quote(quantity);
    if (!full.executable && !adapter.maxExecutableSellQuantity)
        throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'Protocol does not expose exact exit capacity.');
    const maxQuantity = full.executable
        ? quantity
        : await adapter.maxExecutableSellQuantity({ identity: route.executionIdentity, tokenQuantity: tokenBaseUnits(quantity) }, state);
    if (typeof maxQuantity !== 'bigint' || maxQuantity < 0n || maxQuantity > quantity)
        throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Invalid exit capacity.');
    const max = maxQuantity === quantity ? full : await quote(maxQuantity);
    if (maxQuantity > 0n && !max.executable)
        throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Exit capacity is not executable.');
    const costRemoved = maxQuantity === quantity ? basis : (basis * maxQuantity) / quantity;
    return {
        status: full.executable
            ? 'FULL'
            : maxQuantity > 0n
                ? 'LIQUIDITY_LIMITED'
                : 'NO_EXECUTABLE_LIQUIDITY',
        full,
        maxExecutableQuantityBaseUnits: maxQuantity,
        maxExecutableOutputLamports: maxQuantity === 0n ? 0n : max.outputLamports,
        executablePortionCostBasisLamports: costRemoved,
        executablePortionPnlLamports: maxQuantity > 0n ? max.outputLamports - costRemoved : null,
        percentages: {
            '25': await quote((quantity * 25n) / 100n),
            '50': await quote((quantity * 50n) / 100n),
            '75': await quote((quantity * 75n) / 100n),
            '100': full,
        },
        currentProtocol: route.executionIdentity.protocolId,
        evidence,
        evidenceFingerprint: evidence.fingerprint,
        observedAt: evidence.observedAt,
        chainSlot: evidence.chainSlot,
    };
}
//# sourceMappingURL=index.js.map