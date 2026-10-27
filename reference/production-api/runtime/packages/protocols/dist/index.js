import { identifier, paperSolBaseUnits, tokenBaseUnits, } from '@paperfund/core';
import { createMarketStateEvidence, ExecutionEngineError, } from '@paperfund/execution';
export * from './pump-fun.js';
export * from './solana-routes.js';
export * from './chart-supply.js';
export const REFERENCE_PROTOCOL_ID = identifier('REFERENCE_TEST_ONLY', 'ProtocolId');
export const REFERENCE_ADAPTER_VERSION = 'reference-constant-price-v1';
function asReferenceState(state) {
    const normalized = state.normalizedState;
    if (state.adapterVersion !== REFERENCE_ADAPTER_VERSION ||
        normalized['model'] !== 'CONSTANT_PRICE' ||
        typeof normalized['quoteLamportsPerTokenBaseUnit'] !== 'string' ||
        typeof normalized['buyFeeBps'] !== 'string' ||
        typeof normalized['sellFeeBps'] !== 'string' ||
        typeof normalized['markValueLamportsPerTokenBaseUnit'] !== 'string') {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Reference market state is invalid.');
    }
    return normalized;
}
function assertIdentity(expected, actual) {
    if (expected.protocolId !== actual.protocolId ||
        expected.marketId !== actual.marketId ||
        expected.tokenMint !== actual.tokenMint) {
        throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Market-state identity mismatch.');
    }
}
function calculateFee(amount, basisPoints) {
    return (amount * basisPoints) / 10000n;
}
function feeDetails(amount) {
    const amountValue = paperSolBaseUnits(amount);
    const fees = amount === 0n
        ? []
        : [
            {
                category: 'REFERENCE_PROTOCOL_FEE',
                amount: { asset: 'PAPER_SOL', amount: amountValue },
            },
        ];
    return { fees, totalPaperSolFees: amountValue };
}
function cloneState(state) {
    return {
        ...state,
        identity: { ...state.identity },
        normalizedState: { ...state.normalizedState },
        ...(state.rawSource ? { rawSource: { ...state.rawSource } } : {}),
    };
}
/** REFERENCE / TEST ONLY. NOT A PRODUCTION PROTOCOL OR PRICING SOURCE. */
export class ReferenceProtocolAdapter {
    protocolId = REFERENCE_PROTOCOL_ID;
    adapterVersion = REFERENCE_ADAPTER_VERSION;
    #states = new Map();
    constructor(fixtures) {
        for (const fixture of fixtures) {
            if (fixture.identity.protocolId !== this.protocolId) {
                throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Reference fixtures must use the explicit reference protocol ID.');
            }
            if (fixture.quoteLamportsPerTokenBaseUnit <= 0n ||
                fixture.buyFeeBps < 0n ||
                fixture.buyFeeBps > 10000n ||
                fixture.sellFeeBps < 0n ||
                fixture.sellFeeBps > 10000n) {
                throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Reference fixture math is invalid.');
            }
            this.#states.set(fixture.identity.marketId, {
                identity: fixture.identity,
                observedAt: fixture.observedAt,
                chainSlot: fixture.chainSlot ?? null,
                chainBlockId: fixture.chainBlockId ?? null,
                adapterVersion: this.adapterVersion,
                normalizationVersion: 'reference-state-v1',
                normalizedState: {
                    model: 'CONSTANT_PRICE',
                    quoteLamportsPerTokenBaseUnit: fixture.quoteLamportsPerTokenBaseUnit.toString(),
                    buyFeeBps: fixture.buyFeeBps.toString(),
                    sellFeeBps: fixture.sellFeeBps.toString(),
                    markValueLamportsPerTokenBaseUnit: (fixture.markValueLamportsPerTokenBaseUnit ?? fixture.quoteLamportsPerTokenBaseUnit).toString(),
                },
            });
        }
    }
    async loadMarketState(identity) {
        if (identity.protocolId !== this.protocolId) {
            throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Reference protocol identity mismatch.');
        }
        const state = this.#states.get(identity.marketId);
        if (!state) {
            throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', `No reference fixture exists for market ${identity.marketId}.`);
        }
        assertIdentity(identity, state.identity);
        return cloneState(state);
    }
    async simulateBuy(request, marketState) {
        assertIdentity(request.identity, marketState.identity);
        const state = asReferenceState(marketState);
        const input = request.requestedPaperSol;
        const feeAmount = calculateFee(input, BigInt(state.buyFeeBps));
        const output = tokenBaseUnits((input - feeAmount) / BigInt(state.quoteLamportsPerTokenBaseUnit));
        return this.execution(request, marketState, { asset: 'PAPER_SOL', amount: input }, { asset: 'TOKEN', tokenMint: request.identity.tokenMint, amount: output }, feeDetails(feeAmount).fees);
    }
    async simulateSell(request, marketState) {
        assertIdentity(request.identity, marketState.identity);
        const state = asReferenceState(marketState);
        const gross = request.requestedTokenQuantity * BigInt(state.quoteLamportsPerTokenBaseUnit);
        const feeAmount = calculateFee(gross, BigInt(state.sellFeeBps));
        return this.execution(request, marketState, {
            asset: 'TOKEN',
            tokenMint: request.identity.tokenMint,
            amount: request.requestedTokenQuantity,
        }, { asset: 'PAPER_SOL', amount: paperSolBaseUnits(gross - feeAmount) }, feeDetails(feeAmount).fees);
    }
    async valuePositionForExit(request, marketState) {
        assertIdentity(request.identity, marketState.identity);
        const state = asReferenceState(marketState);
        const gross = request.tokenQuantity * BigInt(state.quoteLamportsPerTokenBaseUnit);
        const feeAmount = calculateFee(gross, BigInt(state.sellFeeBps));
        const evidence = createMarketStateEvidence(marketState);
        return {
            identity: request.identity,
            tokenQuantity: request.tokenQuantity,
            paperSolValue: paperSolBaseUnits(gross - feeAmount),
            feeBreakdown: feeDetails(feeAmount),
            marketStateFingerprint: evidence.fingerprint,
            adapterVersion: this.adapterVersion,
        };
    }
    execution(request, marketState, input, output, fees) {
        const evidence = createMarketStateEvidence(marketState);
        return {
            id: request.executionId,
            orderId: request.orderId,
            quote: {
                orderId: request.orderId,
                marketId: request.identity.marketId,
                protocolId: this.protocolId,
                adapterVersion: this.adapterVersion,
                marketStateRecordedAt: marketState.observedAt,
                marketStateFingerprint: evidence.fingerprint,
                normalizationVersion: marketState.normalizationVersion,
                requestedInput: input,
                simulatedOutput: output,
                fees,
            },
            actualInput: input,
            actualOutput: output,
            executedAt: request.executedAt,
        };
    }
}
export function paperSolFeeTotal(fees) {
    return paperSolBaseUnits(fees.reduce((total, item) => (item.amount.asset === 'PAPER_SOL' ? total + item.amount.amount : total), 0n));
}
export function tokenAmount(value) {
    return tokenBaseUnits(value);
}
export * from './pump-swap.js';
export * from './production.js';
export { advisoryReadContext, withAdvisoryRead, rpcProviderIdentity, } from './rpc-read-context.js';
export { genericActor, withGenericActor, withGenericSystemRead, withGenericAccount, } from './generic-access-context.js';
//# sourceMappingURL=index.js.map