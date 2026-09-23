import type { HourlyRoundState } from './states.js';
import type { UtcInstant } from './time.js';
import type { HourlyRound } from './types.js';

const NEXT_HOURLY_STATE: Readonly<Partial<Record<HourlyRoundState, HourlyRoundState>>> = {
  SCHEDULED: 'OPEN',
  OPEN: 'CLOSING',
  CLOSING: 'SETTLING',
  SETTLING: 'FINALIZED',
  FINALIZED: 'PAYING',
  PAYING: 'PAID',
};

export type HourlyRoundTransitionFailure =
  | 'INVALID_ROUND_STATE_TRANSITION'
  | 'ROUND_NOT_READY_TO_OPEN'
  | 'ROUND_NOT_OPEN'
  | 'ROUND_NOT_READY_TO_CLOSE';

export type HourlyRoundTransitionResult =
  | { readonly ok: true; readonly round: HourlyRound }
  | { readonly ok: false; readonly reason: HourlyRoundTransitionFailure };

function instantMilliseconds(instant: UtcInstant): number {
  return new Date(instant).getTime();
}

export function transitionHourlyRoundState(
  round: HourlyRound,
  targetState: HourlyRoundState,
): HourlyRoundTransitionResult {
  if (NEXT_HOURLY_STATE[round.state] !== targetState) {
    return { ok: false, reason: 'INVALID_ROUND_STATE_TRANSITION' };
  }
  return { ok: true, round: { ...round, state: targetState } };
}

/** Trading uses the authoritative half-open UTC interval [startsAt, endsAtExclusive). */
export function isTradingOpenAt(round: HourlyRound, timestamp: UtcInstant): boolean {
  const instant = instantMilliseconds(timestamp);
  return (
    round.state === 'OPEN' &&
    instant >= instantMilliseconds(round.startsAt) &&
    instant < instantMilliseconds(round.endsAtExclusive)
  );
}

/** A scheduled round may open at or after its start, but never at or after its exclusive end. */
export function openHourlyRound(
  round: HourlyRound,
  timestamp: UtcInstant,
): HourlyRoundTransitionResult {
  if (round.state !== 'SCHEDULED') {
    return { ok: false, reason: 'INVALID_ROUND_STATE_TRANSITION' };
  }
  const instant = instantMilliseconds(timestamp);
  if (
    instant < instantMilliseconds(round.startsAt) ||
    instant >= instantMilliseconds(round.endsAtExclusive)
  ) {
    return { ok: false, reason: 'ROUND_NOT_READY_TO_OPEN' };
  }
  return transitionHourlyRoundState(round, 'OPEN');
}

/** Normal close is permitted only for an OPEN round at or after its exclusive end. */
export function closeHourlyRound(
  round: HourlyRound,
  timestamp: UtcInstant,
): HourlyRoundTransitionResult {
  if (round.state !== 'OPEN') {
    return { ok: false, reason: 'ROUND_NOT_OPEN' };
  }
  if (instantMilliseconds(timestamp) < instantMilliseconds(round.endsAtExclusive)) {
    return { ok: false, reason: 'ROUND_NOT_READY_TO_CLOSE' };
  }
  return transitionHourlyRoundState(round, 'CLOSING');
}

export function beginHourlySettlement(round: HourlyRound): HourlyRoundTransitionResult {
  return transitionHourlyRoundState(round, 'SETTLING');
}
