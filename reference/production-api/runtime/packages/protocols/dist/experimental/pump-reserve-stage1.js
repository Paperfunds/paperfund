/** ISOLATED Stage 1 only. Deliberately absent from production exports/router wiring. */
import { createHash } from 'node:crypto';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import { createMarketStateEvidence } from '@paperfund/execution';
import { decodePumpBondingCurve, decodePumpFeeConfig, decodePumpGlobal, pumpBondingCurveAddress, PumpFunProtocolAdapter, PUMP_FUN_PROTOCOL_ID, PUMP_PROGRAM_ID, } from '../pump-fun.js';
import { validatePumpSwapMint } from './non-sol-pump-swap.js';
export class Stage1Error extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
function fail(code) {
    throw new Stage1Error(code);
}
export const stage1Hash = (value) => {
    const ordered = (x) => {
        if (typeof x === 'bigint')
            return x.toString();
        if (Array.isArray(x))
            return x.map(ordered);
        if (x && typeof x === 'object')
            return Object.fromEntries(Object.entries(x)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([k, v]) => [k, ordered(v)]));
        return x;
    };
    return createHash('sha256')
        .update(JSON.stringify(ordered(value)))
        .digest('hex');
};
const snapshot = (s) => ({
    ...structuredClone(s),
    chainSlot: s.chainSlot?.toString() ?? fail('ANCHOR_SLOT_MISSING'),
});
const marketState = (s) => ({
    ...structuredClone(s),
    chainSlot: BigInt(s.chainSlot),
});
const unsigned = (value) => {
    const { hash, ...body } = value;
    void hash;
    return body;
};
function seal(body) {
    return { ...body, hash: stage1Hash(body) };
}
function integer(value) {
    if (typeof value !== 'string' || !/^\d+$/.test(value))
        return fail('STATE_INTEGER_INVALID');
    return BigInt(value);
}
const reserveFields = [
    'virtualSolReserves',
    'virtualTokenReserves',
    'realSolReserves',
    'realTokenReserves',
];
function validate(model) {
    if (integer(model.base.chainSlot) <= 0n || !Number.isFinite(Date.parse(model.base.observedAt)))
        fail('ANCHOR_SLOT_TIME_INVALID');
    if (model.version !== 'PUMP_FIXED_PAPER_STAGE1' ||
        !Number.isSafeInteger(model.revision) ||
        model.revision < 0 ||
        stage1Hash(unsigned(model)) !== model.hash)
        fail('STATE_VERSION_INVALID');
    if ((model.revision === 0) !== (model.lastActionAt === null) ||
        (model.lastActionAt !== null && !Number.isFinite(Date.parse(model.lastActionAt))))
        fail('ACTION_TIME_INVALID');
    if ((model.revision === 0) !== (model.previousTransition === null) ||
        (model.previousTransition !== null && !/^[a-f0-9]{64}$/.test(model.previousTransition)))
        fail('PREDECESSOR_LINK_INVALID');
    if (createMarketStateEvidence(marketState(model.base)).fingerprint !== model.baseHash)
        fail('BASE_ANCHOR_CHANGED');
    for (const s of [model.base, model.current]) {
        if (s.identity.protocolId !== PUMP_FUN_PROTOCOL_ID ||
            s.identity.tokenMint !== model.scope.mint ||
            s.identity.marketId !== model.scope.curve ||
            s.normalizedState['programId'] !== PUMP_PROGRAM_ID)
            fail('MODEL_IDENTITY_MISMATCH');
    }
    const b = model.base.normalizedState, c = model.current.normalizedState;
    const held = integer(model.heldUnits);
    for (const field of reserveFields)
        if (integer(c[field]) > 18446744073709551615n)
            fail('RESERVE_U64_OVERFLOW');
    if (integer(c['virtualSolReserves']) <= 0n ||
        integer(c['virtualTokenReserves']) <= 0n ||
        integer(c['realTokenReserves']) + held !== integer(b['realTokenReserves']) ||
        integer(c['virtualSolReserves']) - integer(c['realSolReserves']) !==
            integer(b['virtualSolReserves']) - integer(b['realSolReserves']) ||
        integer(c['virtualTokenReserves']) - integer(c['realTokenReserves']) !==
            integer(b['virtualTokenReserves']) - integer(b['realTokenReserves']))
        fail('RESERVE_BALANCE_INCONSISTENT');
    if (model.current.chainSlot !== model.base.chainSlot)
        fail('EXTERNAL_RECONCILIATION_REQUIRED');
    if ((integer(c['realTokenReserves']) === 0n) !== (model.status === 'SIMULATED_COMPLETION') ||
        c['complete'] !== (model.status === 'SIMULATED_COMPLETION'))
        fail('COMPLETION_STATE_MISMATCH');
}
function priceState(model) {
    const state = marketState(model.current), n = state.normalizedState;
    const bytes = model.base.rawSource?.['accountDataBase64'];
    if (!Array.isArray(bytes) || typeof bytes[1] !== 'string' || typeof bytes[2] !== 'string')
        return fail('FEE_EVIDENCE_MISSING');
    const global = decodePumpGlobal(Buffer.from(bytes[1], 'base64'));
    const config = decodePumpFeeConfig(Buffer.from(bytes[2], 'base64'));
    const cap = (integer(n['virtualSolReserves']) * integer(n['feeEvaluationMintSupply'])) /
        integer(n['virtualTokenReserves']);
    const tier = config.feeTiers.filter((t) => t.marketCapLamportsThreshold <= cap).at(-1);
    if (!tier)
        return fail('FEE_TIER_UNAVAILABLE');
    const creator = global.creatorFeeConfigurable && integer(n['configuredCreatorFeeBps']) > 0n
        ? integer(n['configuredCreatorFeeBps'])
        : tier.creatorFeeBps;
    if (tier.protocolFeeBps < 0n || creator < 0n || tier.protocolFeeBps + creator >= 10000n)
        return fail('UNSUPPORTED_FEE_CONFIGURATION');
    return {
        ...state,
        normalizedState: {
            ...n,
            protocolFeeBps: tier.protocolFeeBps.toString(),
            creatorFeeBps: creator.toString(),
            feeTierMarketCapLamportsThreshold: tier.marketCapLamportsThreshold.toString(),
        },
    };
}
export async function createStage1Model(scope, verifiedSnapshot) {
    if (!scope.userId ||
        !scope.accountId ||
        !scope.roundId ||
        !Number.isFinite(Date.parse(scope.startsAt)) ||
        !Number.isFinite(Date.parse(scope.endsAtExclusive)) ||
        Date.parse(scope.endsAtExclusive) <= Date.parse(scope.startsAt))
        fail('SCOPE_INVALID');
    if ((await pumpBondingCurveAddress(scope.mint)) !== scope.curve)
        fail('CANONICAL_CURVE_MISMATCH');
    const n = verifiedSnapshot.normalizedState, raw = verifiedSnapshot.rawSource?.['accountDataBase64'];
    if (!Array.isArray(raw) || typeof raw[0] !== 'string')
        fail('ANCHOR_CURVE_BYTES_MISSING');
    const curve = decodePumpBondingCurve(Buffer.from(raw[0], 'base64'));
    for (const field of reserveFields)
        if (curve[field].toString() !== n[field])
            fail('ANCHOR_RESERVE_MISMATCH');
    if (curve.complete || n['complete'] !== false)
        fail('AUTHORITATIVE_MIGRATION_BOUNDARY');
    if (curve.creator !== n['creator'] ||
        curve.tokenTotalSupply.toString() !== n['tokenTotalSupply'] ||
        curve.creatorFeeBps.toString() !== n['configuredCreatorFeeBps'])
        fail('ANCHOR_PROTOCOL_MISMATCH');
    if (!['11111111111111111111111111111111', 'So11111111111111111111111111111111111111112'].includes(curve.quoteMint))
        fail('UNSUPPORTED_QUOTE_MECHANICS');
    if (typeof raw[3] !== 'string')
        fail('ANCHOR_MINT_BYTES_MISSING');
    // Reuse only the established mint validator; no PumpSwap pricing or route selection.
    const mint = validatePumpSwapMint({
        accounts: { [scope.mint]: { owner: String(n['tokenProgram']), base64: raw[3] } },
    }, scope.mint);
    if (mint.decimals.toString() !== n['tokenDecimals'] || mint.supply.toString() !== n['mintSupply'])
        fail('ANCHOR_MINT_MISMATCH');
    if (curve.isMayhemMode ||
        curve.isCashbackCoin ||
        curve.isHolderReward ||
        n['quoteAsset'] !== 'SOL')
        fail('UNSUPPORTED_ANCHOR_MECHANICS');
    if (!Number.isSafeInteger(Number(n['tokenDecimals'])) ||
        Number(n['tokenDecimals']) < 0 ||
        Number(n['tokenDecimals']) > 18)
        fail('TOKEN_DECIMALS_INVALID');
    const base = snapshot(verifiedSnapshot);
    const model = seal({
        version: 'PUMP_FIXED_PAPER_STAGE1',
        scope: structuredClone(scope),
        base,
        baseHash: createMarketStateEvidence(verifiedSnapshot).fingerprint,
        current: base,
        revision: 0,
        heldUnits: '0',
        previousTransition: null,
        lastActionAt: null,
        status: 'ACTIVE',
    });
    validate(model);
    const canonical = priceState(model);
    await new PumpFunProtocolAdapter({ loadMarketState: async () => canonical }).loadMarketState(canonical.identity);
    return model;
}
export async function prepareStage1Transition(model, scope, request) {
    validate(model);
    if (stage1Hash(scope) !== stage1Hash(model.scope))
        fail('ACCOUNT_ROUND_SCOPE_MISMATCH');
    if (request.continuity !== 'ISOLATED_FIXED_SNAPSHOT')
        fail('EXTERNAL_RECONCILIATION_REQUIRED');
    if (model.status !== 'ACTIVE')
        fail('SIMULATED_COMPLETION_PENDING_MIGRATION');
    if (request.expectedRevision !== model.revision || request.predecessorHash !== model.hash)
        fail('STALE_PREDECESSOR');
    if (!request.key || !request.executionId || !['BUY', 'SELL'].includes(request.side))
        fail('TRANSITION_IDENTITY_INVALID');
    const amount = integer(request.amount), at = Date.parse(request.at), end = Date.parse(scope.endsAtExclusive);
    if (amount <= 0n || !Number.isFinite(at))
        fail('TRANSITION_AMOUNT_TIME_INVALID');
    if (request.phase === 'OPEN'
        ? at < Date.parse(scope.startsAt) || at >= end
        : request.phase !== 'SETTLEMENT' || at < end || request.side !== 'SELL')
        fail('UTC_ROUND_BOUNDARY');
    if (at < Date.parse(model.base.observedAt) ||
        (model.lastActionAt !== null && at < Date.parse(model.lastActionAt)))
        fail('OUT_OF_ORDER_ACTION_TIME');
    if (request.side === 'SELL' && amount > integer(model.heldUnits))
        fail('OWNED_INVENTORY_EXCEEDED');
    const state = priceState(model), adapter = new PumpFunProtocolAdapter({ loadMarketState: async () => state });
    const common = {
        identity: state.identity,
        orderId: identifier(request.key, 'OrderId'),
        executionId: identifier(request.executionId, 'ExecutionId'),
        executedAt: utcInstant(request.at),
    };
    const execution = request.side === 'BUY'
        ? await adapter.simulateBuy({ ...common, requestedPaperSol: paperSolBaseUnits(amount) }, state)
        : await adapter.simulateSell({ ...common, requestedTokenQuantity: tokenBaseUnits(amount) }, state);
    const post = execution.executionDetails?.['postTrade'];
    if (!post || typeof post !== 'object' || Array.isArray(post))
        return fail('CANONICAL_POST_STATE_MISSING');
    const tokens = request.side === 'BUY' ? execution.actualOutput.amount : execution.actualInput.amount;
    const held = integer(model.heldUnits) + (request.side === 'BUY' ? tokens : -tokens);
    const complete = integer(post['realTokenReserves']) === 0n;
    const transitionId = stage1Hash([model.hash, request.executionId, request.key]);
    const current = {
        ...model.current,
        normalizedState: {
            ...state.normalizedState,
            ...post,
            complete,
            simulationClass: 'ISOLATED_COUNTERFACTUAL_NOT_LIVE',
            simulationRevision: (model.revision + 1).toString(),
        },
    };
    const next = seal({
        ...unsigned(model),
        current,
        revision: model.revision + 1,
        heldUnits: held.toString(),
        previousTransition: transitionId,
        lastActionAt: request.at,
        status: complete ? 'SIMULATED_COMPLETION' : 'ACTIVE',
    });
    validate(next);
    if (integer(current.normalizedState['virtualTokenReserves']) *
        integer(current.normalizedState['virtualSolReserves']) <
        integer(state.normalizedState['virtualTokenReserves']) *
            integer(state.normalizedState['virtualSolReserves']))
        fail('INTEGER_INVARIANT_DECREASED');
    const body = {
        id: transitionId,
        modelVersion: model.version,
        scopeHash: stage1Hash(scope),
        baseHash: model.baseHash,
        predecessorHash: model.hash,
        precedingTransition: model.previousTransition,
        revision: next.revision,
        request: structuredClone(request),
        requestHash: stage1Hash(request),
        tokenUnits: tokens.toString(),
        inputLamports: request.side === 'BUY' ? execution.actualInput.amount.toString() : '0',
        outputLamports: request.side === 'SELL' ? execution.actualOutput.amount.toString() : '0',
        feeLamports: execution.quote.fees.reduce((sum, f) => sum + f.amount.amount, 0n).toString(),
        curveLamports: String(execution.executionDetails?.[request.side === 'BUY' ? 'curveInputLamports' : 'grossSolOutputLamports']),
        resultHash: next.hash,
    };
    return { model: next, transition: { ...body, hash: stage1Hash(body) } };
}
export async function stage1Exit(model, quantity = model.heldUnits) {
    validate(model);
    if (model.status !== 'ACTIVE')
        fail('SIMULATED_COMPLETION_PENDING_MIGRATION');
    const q = integer(quantity);
    if (q > integer(model.heldUnits) || q <= 0n)
        fail('OWNED_INVENTORY_EXCEEDED');
    const state = priceState(model), adapter = new PumpFunProtocolAdapter({ loadMarketState: async () => state });
    const max = await adapter.maxExecutableSellQuantity({ identity: state.identity, tokenQuantity: tokenBaseUnits(q) }, state);
    const value = max === 0n
        ? 0n
        : (await adapter.valuePositionForExit({ identity: state.identity, tokenQuantity: max }, state)).paperSolValue;
    return {
        classification: 'ISOLATED_COUNTERFACTUAL_NOT_LIVE',
        quantity: q.toString(),
        max: max.toString(),
        netLamports: value.toString(),
        full: max === q,
    };
}
export function stage1Continuity(model, observed) {
    validate(model);
    if (observed.identity.tokenMint !== model.scope.mint ||
        observed.identity.marketId !== model.scope.curve ||
        observed.identity.protocolId !== PUMP_FUN_PROTOCOL_ID)
        return { available: false, reason: 'CHAIN_IDENTITY_MISMATCH' };
    if (observed.normalizedState['complete'] === true)
        return { available: false, reason: 'AUTHORITATIVE_MIGRATION_HANDOFF_REQUIRED' };
    if (model.status === 'SIMULATED_COMPLETION')
        return { available: false, reason: 'SIMULATED_COMPLETION_CHAIN_STILL_ACTIVE' };
    // Even identical reserves or slot do not prove an external event tape is complete.
    return { available: false, reason: 'EXTERNAL_RECONCILIATION_REQUIRED' };
}
export async function replayStage1(base, transitions) {
    validate(base);
    if (base.revision !== 0 || base.previousTransition !== null)
        fail('REPLAY_BASE_REQUIRED');
    let model = base;
    const seen = new Set();
    for (const record of transitions) {
        if (seen.has(record.request.key) || stage1Hash(unsigned(record)) !== record.hash)
            fail('DUPLICATE_OR_CORRUPT_TRANSITION');
        seen.add(record.request.key);
        if (record.precedingTransition !== model.previousTransition ||
            record.revision !== model.revision + 1 ||
            record.scopeHash !== stage1Hash(model.scope) ||
            record.baseHash !== model.baseHash)
            fail('MISSING_OR_OUT_OF_ORDER_PREDECESSOR');
        const result = await prepareStage1Transition(model, model.scope, record.request);
        if (stage1Hash(result.transition) !== stage1Hash(record))
            fail('TRANSITION_REPLAY_MISMATCH');
        model = result.model;
    }
    return model;
}
export async function classifyStage1Legacy(base, fills) {
    if (!fills.length)
        return {
            classification: 'NOT_SAFELY_RECONSTRUCTABLE',
            reason: 'FILL_EVIDENCE_MISSING',
        };
    if (fills.every((f) => !!f.transition)) {
        try {
            if (fills.some((f) => f.side !== f.transition.request.side ||
                f.amount !== f.transition.request.amount ||
                (f.tokenUnits !== undefined && f.tokenUnits !== f.transition.tokenUnits) ||
                (f.outputLamports !== undefined && f.outputLamports !== f.transition.outputLamports)))
                fail('ASSOCIATED_FILL_MISMATCH');
            await replayStage1(base, fills.map((f) => f.transition));
            return {
                classification: 'FULLY_RECONSTRUCTABLE',
                reason: 'VERIFIED_STAGE1_TRANSITION_CHAIN',
            };
        }
        catch {
            return {
                classification: 'NOT_SAFELY_RECONSTRUCTABLE',
                reason: 'TRANSITION_CHAIN_INVALID',
            };
        }
    }
    let model = base;
    for (const [i, fill] of fills.entries()) {
        if (fill.tokenUnits === undefined)
            return {
                classification: 'PARTIALLY_RECONSTRUCTABLE',
                reason: 'FILL_OUTPUT_EVIDENCE_MISSING',
            };
        try {
            const result = await prepareStage1Transition(model, model.scope, {
                key: `legacy-check-${i}`,
                executionId: `legacy-check-${i}`,
                side: fill.side,
                amount: fill.amount,
                expectedRevision: model.revision,
                predecessorHash: model.hash,
                at: new Date(Math.max(Date.parse(base.scope.startsAt), Date.parse(base.base.observedAt))).toISOString(),
                phase: 'OPEN',
                continuity: 'ISOLATED_FIXED_SNAPSHOT',
            });
            if (result.transition.tokenUnits !== fill.tokenUnits ||
                (fill.side === 'SELL' && result.transition.outputLamports !== fill.outputLamports))
                return {
                    classification: 'NOT_SAFELY_RECONSTRUCTABLE',
                    reason: 'LEGACY_SEQUENTIAL_QUANTITY_MISMATCH',
                };
            model = result.model;
        }
        catch {
            return {
                classification: 'NOT_SAFELY_RECONSTRUCTABLE',
                reason: 'LEGACY_STATE_UNAVAILABLE',
            };
        }
    }
    return {
        classification: 'PARTIALLY_RECONSTRUCTABLE',
        reason: 'EXTERNAL_CONTINUITY_UNPROVEN',
    };
}
//# sourceMappingURL=pump-reserve-stage1.js.map