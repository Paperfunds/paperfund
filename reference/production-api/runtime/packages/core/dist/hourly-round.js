const NEXT_HOURLY_STATE = {
    SCHEDULED: 'OPEN',
    OPEN: 'CLOSING',
    CLOSING: 'SETTLING',
    SETTLING: 'FINALIZED',
    FINALIZED: 'PAYING',
    PAYING: 'PAID',
};
function instantMilliseconds(instant) {
    return new Date(instant).getTime();
}
export function transitionHourlyRoundState(round, targetState) {
    if (NEXT_HOURLY_STATE[round.state] !== targetState) {
        return { ok: false, reason: 'INVALID_ROUND_STATE_TRANSITION' };
    }
    return { ok: true, round: { ...round, state: targetState } };
}
/** Trading uses the authoritative half-open UTC interval [startsAt, endsAtExclusive). */
export function isTradingOpenAt(round, timestamp) {
    const instant = instantMilliseconds(timestamp);
    return (round.state === 'OPEN' &&
        instant >= instantMilliseconds(round.startsAt) &&
        instant < instantMilliseconds(round.endsAtExclusive));
}
/** A scheduled round may open at or after its start, but never at or after its exclusive end. */
export function openHourlyRound(round, timestamp) {
    if (round.state !== 'SCHEDULED') {
        return { ok: false, reason: 'INVALID_ROUND_STATE_TRANSITION' };
    }
    const instant = instantMilliseconds(timestamp);
    if (instant < instantMilliseconds(round.startsAt) ||
        instant >= instantMilliseconds(round.endsAtExclusive)) {
        return { ok: false, reason: 'ROUND_NOT_READY_TO_OPEN' };
    }
    return transitionHourlyRoundState(round, 'OPEN');
}
/** Normal close is permitted only for an OPEN round at or after its exclusive end. */
export function closeHourlyRound(round, timestamp) {
    if (round.state !== 'OPEN') {
        return { ok: false, reason: 'ROUND_NOT_OPEN' };
    }
    if (instantMilliseconds(timestamp) < instantMilliseconds(round.endsAtExclusive)) {
        return { ok: false, reason: 'ROUND_NOT_READY_TO_CLOSE' };
    }
    return transitionHourlyRoundState(round, 'CLOSING');
}
export function beginHourlySettlement(round) {
    return transitionHourlyRoundState(round, 'SETTLING');
}
//# sourceMappingURL=hourly-round.js.map