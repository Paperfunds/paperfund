import { applySuccessfulSellExecution, } from './execution-application.js';
import { paperSolDelta } from './money.js';
import { transitionHourlyRoundState } from './hourly-round.js';
export const HOURLY_SETTLEMENT_REJECTION_REASONS = [
    'ROUND_NOT_IN_SETTLING_STATE',
    'ROUND_ALREADY_FINALIZED',
    'SETTLEMENT_EXECUTION_MISSING',
    'SETTLEMENT_EXECUTION_DUPLICATE',
    'SETTLEMENT_EXECUTION_UNEXPECTED',
    'SETTLEMENT_POSITION_MISMATCH',
    'SETTLEMENT_MUST_FULLY_CLOSE_POSITION',
    'SETTLEMENT_INCOMPLETE',
    'SETTLEMENT_ACCOUNT_INVALID',
    'SETTLEMENT_LEDGER_ID_DUPLICATE',
];
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function compareCanonicalIdentity(left, right) {
    return (compareText(left.protocolId, right.protocolId) ||
        compareText(left.marketId, right.marketId) ||
        compareText(left.tokenMint, right.tokenMint));
}
function sameCanonicalIdentity(left, right) {
    return compareCanonicalIdentity(left, right) === 0;
}
function hasAdjacentDuplicate(items, compare) {
    return items.some((item, index) => index > 0 && compare(items[index - 1], item) === 0);
}
function mapApplicationFailure(reason) {
    if (reason === 'EXECUTION_IDENTITY_MISMATCH' ||
        reason === 'EXECUTION_ASSET_MISMATCH' ||
        reason === 'INCOMPATIBLE_POSITION_IDENTITY' ||
        reason === 'POSITION_NOT_FOUND') {
        return 'SETTLEMENT_POSITION_MISMATCH';
    }
    return reason;
}
function isStructurallyValidAccount(account, positions, startingPaperSolBaseUnits) {
    const slotMints = new Set(account.tokenSlots.map(({ tokenMint }) => tokenMint));
    const slotNumbers = [...account.tokenSlots]
        .map(({ slotNumber }) => slotNumber)
        .sort((left, right) => left - right);
    return (account.paperSolBalance >= 0n &&
        startingPaperSolBaseUnits > 0n &&
        slotMints.size === account.tokenSlots.length &&
        new Set(slotNumbers).size === slotNumbers.length &&
        slotNumbers.every((slotNumber, index) => slotNumber === index + 1) &&
        positions.every(({ tokenMint }) => slotMints.has(tokenMint)));
}
export function settleHourlyAccount(input) {
    if (input.round.state === 'FINALIZED' ||
        input.round.state === 'PAYING' ||
        input.round.state === 'PAID') {
        return { ok: false, reason: 'ROUND_ALREADY_FINALIZED' };
    }
    if (input.round.state !== 'SETTLING') {
        return { ok: false, reason: 'ROUND_NOT_IN_SETTLING_STATE' };
    }
    if (input.account.hourlyRoundId !== input.round.id) {
        return { ok: false, reason: 'SETTLEMENT_POSITION_MISMATCH' };
    }
    if (!isStructurallyValidAccount(input.account, input.positions, input.startingPaperSolBaseUnits)) {
        return { ok: false, reason: 'SETTLEMENT_ACCOUNT_INVALID' };
    }
    if (input.positions.some((position) => position.competitionAccountId !== input.account.id ||
        position.hourlyRoundId !== input.round.id ||
        position.tokenAmount <= 0n)) {
        return { ok: false, reason: 'SETTLEMENT_POSITION_MISMATCH' };
    }
    const sortedPositions = [...input.positions].sort(compareCanonicalIdentity);
    if (hasAdjacentDuplicate(sortedPositions, compareCanonicalIdentity)) {
        return { ok: false, reason: 'SETTLEMENT_POSITION_MISMATCH' };
    }
    const sortedSettlements = [...input.settlementExecutions].sort((left, right) => compareCanonicalIdentity(left.order, right.order));
    if (hasAdjacentDuplicate(sortedSettlements, (left, right) => compareCanonicalIdentity(left.order, right.order)) ||
        new Set(sortedSettlements.map(({ execution }) => execution.id)).size !==
            sortedSettlements.length) {
        return { ok: false, reason: 'SETTLEMENT_EXECUTION_DUPLICATE' };
    }
    const ledgerIds = sortedSettlements.flatMap(({ ledgerEntryIds }) => [
        ledgerEntryIds.input,
        ledgerEntryIds.output,
    ]);
    if (new Set(ledgerIds).size !== ledgerIds.length) {
        return { ok: false, reason: 'SETTLEMENT_LEDGER_ID_DUPLICATE' };
    }
    if (sortedSettlements.length < sortedPositions.length) {
        return { ok: false, reason: 'SETTLEMENT_EXECUTION_MISSING' };
    }
    if (sortedSettlements.length > sortedPositions.length) {
        return { ok: false, reason: 'SETTLEMENT_EXECUTION_UNEXPECTED' };
    }
    for (let index = 0; index < sortedPositions.length; index += 1) {
        const position = sortedPositions[index];
        const settlement = sortedSettlements[index];
        if (!sameCanonicalIdentity(position, settlement.order)) {
            return { ok: false, reason: 'SETTLEMENT_POSITION_MISMATCH' };
        }
        if (settlement.order.competitionAccountId !== input.account.id ||
            settlement.order.hourlyRoundId !== input.round.id ||
            settlement.execution.actualInput.asset !== 'TOKEN' ||
            settlement.execution.actualInput.tokenMint !== position.tokenMint) {
            return { ok: false, reason: 'SETTLEMENT_POSITION_MISMATCH' };
        }
        if (settlement.order.tokenInput !== position.tokenAmount ||
            settlement.execution.actualInput.amount !== position.tokenAmount) {
            return { ok: false, reason: 'SETTLEMENT_MUST_FULLY_CLOSE_POSITION' };
        }
    }
    let account = input.account;
    let positions = input.positions;
    const ledgerEntries = [];
    for (const settlement of sortedSettlements) {
        const applied = applySuccessfulSellExecution({
            account,
            positions,
            order: settlement.order,
            execution: settlement.execution,
            ledgerEntryIds: settlement.ledgerEntryIds,
            context: 'FORCED_SETTLEMENT',
        });
        if (!applied.ok) {
            return { ok: false, reason: mapApplicationFailure(applied.reason) };
        }
        account = applied.account;
        positions = applied.positions;
        ledgerEntries.push(...applied.ledgerEntries);
    }
    if (positions.length !== 0) {
        return { ok: false, reason: 'SETTLEMENT_INCOMPLETE' };
    }
    const finalizedRound = transitionHourlyRoundState(input.round, 'FINALIZED');
    if (!finalizedRound.ok) {
        return { ok: false, reason: 'ROUND_NOT_IN_SETTLING_STATE' };
    }
    const round = { ...finalizedRound.round, state: 'FINALIZED' };
    const hourlyResult = {
        hourlyRoundId: round.id,
        competitionAccountId: account.id,
        userId: account.userId,
        finalSettledPaperSol: account.paperSolBalance,
        pnl: paperSolDelta(account.paperSolBalance - input.startingPaperSolBaseUnits),
        finalizedAt: input.finalizedAt,
    };
    return {
        ok: true,
        round,
        account,
        positions: [],
        tokenSlots: account.tokenSlots,
        ledgerEntries,
        hourlyResult,
    };
}
//# sourceMappingURL=hourly-settlement.js.map