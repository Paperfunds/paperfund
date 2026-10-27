import { paperSolBaseUnits, paperSolDelta, tokenBaseUnits, tokenBaseUnitDelta, } from './money.js';
import { recordSuccessfulTokenEntry } from './token-slots.js';
export const EXECUTION_APPLICATION_REJECTION_REASONS = [
    'SELL_QUANTITY_EXCEEDS_POSITION',
    'POSITION_NOT_FOUND',
    'BUY_COST_EXCEEDS_AVAILABLE_PAPER_SOL',
    'ZERO_EXECUTION_OUTPUT',
    'EXECUTION_AMOUNT_MUST_BE_POSITIVE',
    'INCOMPATIBLE_POSITION_IDENTITY',
    'EXECUTION_IDENTITY_MISMATCH',
    'EXECUTION_ASSET_MISMATCH',
    'TOKEN_SLOT_LIMIT_REACHED',
];
function hasCompatibleExecutionIdentity(account, order, execution) {
    return (order.competitionAccountId === account.id &&
        order.hourlyRoundId === account.hourlyRoundId &&
        execution.orderId === order.id &&
        execution.quote.orderId === order.id &&
        execution.quote.marketId === order.marketId &&
        execution.quote.protocolId === order.protocolId);
}
function hasCompatiblePositionScope(account, positions) {
    return positions.every((position) => position.competitionAccountId === account.id &&
        position.hourlyRoundId === account.hourlyRoundId);
}
function findCanonicalPositions(positions, order) {
    return positions.filter((position) => position.tokenMint === order.tokenMint &&
        position.marketId === order.marketId &&
        position.protocolId === order.protocolId);
}
export function applySuccessfulBuyExecution(input) {
    const { account, execution, order, positions } = input;
    if (!hasCompatibleExecutionIdentity(account, order, execution)) {
        return { ok: false, reason: 'EXECUTION_IDENTITY_MISMATCH' };
    }
    if (!hasCompatiblePositionScope(account, positions)) {
        return { ok: false, reason: 'INCOMPATIBLE_POSITION_IDENTITY' };
    }
    if (execution.actualInput.asset !== 'PAPER_SOL' ||
        execution.actualOutput.asset !== 'TOKEN' ||
        execution.actualOutput.tokenMint !== order.tokenMint) {
        return { ok: false, reason: 'EXECUTION_ASSET_MISMATCH' };
    }
    if (execution.actualInput.amount <= 0n) {
        return { ok: false, reason: 'EXECUTION_AMOUNT_MUST_BE_POSITIVE' };
    }
    if (execution.actualOutput.amount <= 0n) {
        return { ok: false, reason: 'ZERO_EXECUTION_OUTPUT' };
    }
    if (execution.actualInput.amount > account.paperSolBalance) {
        return { ok: false, reason: 'BUY_COST_EXCEEDS_AVAILABLE_PAPER_SOL' };
    }
    const matches = findCanonicalPositions(positions, order);
    if (matches.length > 1) {
        return { ok: false, reason: 'INCOMPATIBLE_POSITION_IDENTITY' };
    }
    const slotResult = recordSuccessfulTokenEntry({
        tokenMint: order.tokenMint,
        consumedSlots: account.tokenSlots,
        slotsLimit: input.tokenSlotsLimit,
        firstSuccessfulBuyOrderId: order.id,
        consumedAt: execution.executedAt,
    });
    if (!slotResult.ok) {
        return { ok: false, reason: slotResult.reason };
    }
    const existing = matches[0];
    const updatedPosition = existing
        ? {
            ...existing,
            tokenAmount: tokenBaseUnits(existing.tokenAmount + execution.actualOutput.amount),
            paperSolCostBasis: paperSolBaseUnits(existing.paperSolCostBasis + execution.actualInput.amount),
            updatedAt: execution.executedAt,
        }
        : {
            competitionAccountId: account.id,
            hourlyRoundId: account.hourlyRoundId,
            tokenMint: order.tokenMint,
            marketId: order.marketId,
            protocolId: order.protocolId,
            tokenAmount: execution.actualOutput.amount,
            paperSolCostBasis: execution.actualInput.amount,
            updatedAt: execution.executedAt,
        };
    const nextPositions = existing
        ? positions.map((position) => (position === existing ? updatedPosition : position))
        : [...positions, updatedPosition];
    const nextAccount = {
        ...account,
        paperSolBalance: paperSolBaseUnits(account.paperSolBalance - execution.actualInput.amount),
        tokenSlots: slotResult.slots,
    };
    const ledgerEntries = [
        {
            id: input.ledgerEntryIds.input,
            competitionAccountId: account.id,
            eventType: 'BUY_PAPER_SOL_DEBIT',
            asset: 'PAPER_SOL',
            amount: paperSolDelta(-execution.actualInput.amount),
            orderId: order.id,
            executionId: execution.id,
            occurredAt: execution.executedAt,
            executionFees: [...execution.quote.fees],
        },
        {
            id: input.ledgerEntryIds.output,
            competitionAccountId: account.id,
            eventType: 'BUY_TOKEN_CREDIT',
            asset: 'TOKEN',
            tokenMint: order.tokenMint,
            amount: tokenBaseUnitDelta(execution.actualOutput.amount),
            orderId: order.id,
            executionId: execution.id,
            occurredAt: execution.executedAt,
        },
    ];
    return {
        ok: true,
        account: nextAccount,
        positions: nextPositions,
        tokenSlots: nextAccount.tokenSlots,
        ledgerEntries,
    };
}
export function applySuccessfulSellExecution(input) {
    const { account, execution, order, positions } = input;
    if (!hasCompatibleExecutionIdentity(account, order, execution)) {
        return { ok: false, reason: 'EXECUTION_IDENTITY_MISMATCH' };
    }
    if (!hasCompatiblePositionScope(account, positions)) {
        return { ok: false, reason: 'INCOMPATIBLE_POSITION_IDENTITY' };
    }
    if (execution.actualInput.asset !== 'TOKEN' ||
        execution.actualInput.tokenMint !== order.tokenMint ||
        execution.actualOutput.asset !== 'PAPER_SOL') {
        return { ok: false, reason: 'EXECUTION_ASSET_MISMATCH' };
    }
    if (execution.actualInput.amount <= 0n) {
        return { ok: false, reason: 'EXECUTION_AMOUNT_MUST_BE_POSITIVE' };
    }
    if (execution.actualOutput.amount <= 0n) {
        return { ok: false, reason: 'ZERO_EXECUTION_OUTPUT' };
    }
    const matches = findCanonicalPositions(positions, order);
    if (matches.length === 0) {
        return { ok: false, reason: 'POSITION_NOT_FOUND' };
    }
    if (matches.length > 1) {
        return { ok: false, reason: 'INCOMPATIBLE_POSITION_IDENTITY' };
    }
    const position = matches[0];
    if (!position) {
        throw new Error('Canonical position lookup unexpectedly returned no position.');
    }
    if (execution.actualInput.amount > position.tokenAmount) {
        return { ok: false, reason: 'SELL_QUANTITY_EXCEEDS_POSITION' };
    }
    const isFullSell = execution.actualInput.amount === position.tokenAmount;
    const costBasisRemoved = isFullSell
        ? position.paperSolCostBasis
        : paperSolBaseUnits((position.paperSolCostBasis * execution.actualInput.amount) / position.tokenAmount);
    const remainingQuantity = tokenBaseUnits(position.tokenAmount - execution.actualInput.amount);
    const nextPositions = isFullSell
        ? positions.filter((candidate) => candidate !== position)
        : positions.map((candidate) => candidate === position
            ? {
                ...position,
                tokenAmount: remainingQuantity,
                paperSolCostBasis: paperSolBaseUnits(position.paperSolCostBasis - costBasisRemoved),
                updatedAt: execution.executedAt,
            }
            : candidate);
    const nextAccount = {
        ...account,
        paperSolBalance: paperSolBaseUnits(account.paperSolBalance + execution.actualOutput.amount),
        tokenSlots: [...account.tokenSlots],
    };
    const realizedPnl = paperSolDelta(execution.actualOutput.amount - costBasisRemoved);
    const isForcedSettlement = input.context === 'FORCED_SETTLEMENT';
    const ledgerEntries = [
        {
            id: input.ledgerEntryIds.input,
            competitionAccountId: account.id,
            eventType: isForcedSettlement ? 'FORCED_SETTLEMENT_TOKEN_DEBIT' : 'SELL_TOKEN_DEBIT',
            asset: 'TOKEN',
            tokenMint: order.tokenMint,
            amount: tokenBaseUnitDelta(-execution.actualInput.amount),
            orderId: order.id,
            executionId: execution.id,
            occurredAt: execution.executedAt,
        },
        {
            id: input.ledgerEntryIds.output,
            competitionAccountId: account.id,
            eventType: isForcedSettlement
                ? 'FORCED_SETTLEMENT_PAPER_SOL_CREDIT'
                : 'SELL_PAPER_SOL_CREDIT',
            asset: 'PAPER_SOL',
            amount: paperSolDelta(execution.actualOutput.amount),
            orderId: order.id,
            executionId: execution.id,
            occurredAt: execution.executedAt,
            executionFees: [...execution.quote.fees],
        },
    ];
    return {
        ok: true,
        account: nextAccount,
        positions: nextPositions,
        tokenSlots: nextAccount.tokenSlots,
        ledgerEntries,
        realizedPnl,
    };
}
export function createRoundCreditLedgerEntry(input) {
    return {
        id: input.id,
        competitionAccountId: input.account.id,
        eventType: 'ROUND_CREDIT',
        asset: 'PAPER_SOL',
        amount: paperSolDelta(input.account.paperSolBalance),
        occurredAt: input.creditedAt,
    };
}
//# sourceMappingURL=execution-application.js.map