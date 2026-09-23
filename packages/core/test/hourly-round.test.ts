import { describe, expect, it } from 'vitest';

import {
  beginHourlySettlement,
  closeHourlyRound,
  identifier,
  isTradingOpenAt,
  openHourlyRound,
  transitionHourlyRoundState,
  utcInstant,
  type HourlyRound,
  type HourlyRoundId,
} from '../src/index.js';

function round(state: HourlyRound['state'] = 'SCHEDULED'): HourlyRound {
  return {
    id: identifier('round-15', 'HourlyRoundId') as HourlyRoundId,
    state,
    startsAt: utcInstant('2026-09-23T15:00:00Z'),
    endsAtExclusive: utcInstant('2026-09-23T16:00:00Z'),
    configurationVersion: 'phase-1a-v1',
  };
}

describe('hourly round state machine', () => {
  it('allows every adjacent documented transition', () => {
    const transitions = [
      ['SCHEDULED', 'OPEN'],
      ['OPEN', 'CLOSING'],
      ['CLOSING', 'SETTLING'],
      ['SETTLING', 'FINALIZED'],
      ['FINALIZED', 'PAYING'],
      ['PAYING', 'PAID'],
    ] as const;

    for (const [from, to] of transitions) {
      expect(transitionHourlyRoundState(round(from), to)).toMatchObject({
        ok: true,
        round: { state: to },
      });
    }
  });

  it('rejects skipped, backwards, terminal, and same-state transitions', () => {
    for (const [from, to] of [
      ['SCHEDULED', 'SETTLING'],
      ['OPEN', 'FINALIZED'],
      ['SETTLING', 'OPEN'],
      ['PAID', 'OPEN'],
      ['OPEN', 'OPEN'],
    ] as const) {
      expect(transitionHourlyRoundState(round(from), to)).toEqual({
        ok: false,
        reason: 'INVALID_ROUND_STATE_TRANSITION',
      });
    }
  });

  it('opens only from SCHEDULED at or after start and before end', () => {
    expect(openHourlyRound(round(), utcInstant('2026-09-23T14:59:59.999Z'))).toEqual({
      ok: false,
      reason: 'ROUND_NOT_READY_TO_OPEN',
    });
    expect(openHourlyRound(round(), utcInstant('2026-09-23T15:00:00Z'))).toMatchObject({
      ok: true,
      round: { state: 'OPEN' },
    });
    expect(openHourlyRound(round(), utcInstant('2026-09-23T15:30:00Z'))).toMatchObject({
      ok: true,
    });
    expect(openHourlyRound(round(), utcInstant('2026-09-23T16:00:00Z'))).toEqual({
      ok: false,
      reason: 'ROUND_NOT_READY_TO_OPEN',
    });
    expect(openHourlyRound(round('OPEN'), utcInstant('2026-09-23T15:30:00Z'))).toEqual({
      ok: false,
      reason: 'INVALID_ROUND_STATE_TRANSITION',
    });
  });

  it('normal-closes only OPEN rounds at or after the exclusive end', () => {
    expect(closeHourlyRound(round('OPEN'), utcInstant('2026-09-23T15:59:59.999Z'))).toEqual({
      ok: false,
      reason: 'ROUND_NOT_READY_TO_CLOSE',
    });
    expect(closeHourlyRound(round('OPEN'), utcInstant('2026-09-23T16:00:00Z'))).toMatchObject({
      ok: true,
      round: { state: 'CLOSING' },
    });
    expect(closeHourlyRound(round('OPEN'), utcInstant('2026-09-23T16:00:00.001Z'))).toMatchObject({
      ok: true,
    });
    expect(closeHourlyRound(round('SCHEDULED'), utcInstant('2026-09-23T16:00:00Z'))).toEqual({
      ok: false,
      reason: 'ROUND_NOT_OPEN',
    });
  });

  it('provides the guarded CLOSING to SETTLING transition', () => {
    expect(beginHourlySettlement(round('CLOSING'))).toMatchObject({
      ok: true,
      round: { state: 'SETTLING' },
    });
    expect(beginHourlySettlement(round('OPEN'))).toEqual({
      ok: false,
      reason: 'INVALID_ROUND_STATE_TRANSITION',
    });
  });

  it('does not mutate the caller-owned round', () => {
    const original = round();
    const snapshot = structuredClone(original);
    const result = openHourlyRound(original, utcInstant('2026-09-23T15:00:00Z'));
    expect(result.ok).toBe(true);
    expect(original).toEqual(snapshot);
    if (result.ok) expect(result.round).not.toBe(original);
  });
});

describe('authoritative half-open trading window', () => {
  it.each([
    ['2026-09-23T14:59:59.999Z', false],
    ['2026-09-23T15:00:00Z', true],
    ['2026-09-23T15:30:00Z', true],
    ['2026-09-23T15:59:59.999Z', true],
    ['2026-09-23T16:00:00Z', false],
    ['2026-09-23T16:00:00.001Z', false],
  ])('evaluates %s as open=%s', (timestamp, expected) => {
    expect(isTradingOpenAt(round('OPEN'), utcInstant(timestamp))).toBe(expected);
  });

  it('requires OPEN state even inside the UTC interval', () => {
    expect(isTradingOpenAt(round('CLOSING'), utcInstant('2026-09-23T15:30:00Z'))).toBe(false);
  });

  it('handles midnight UTC and a year boundary', () => {
    const midnightRound: HourlyRound = {
      ...round('OPEN'),
      startsAt: utcInstant('2026-09-23T00:00:00Z'),
      endsAtExclusive: utcInstant('2026-09-23T01:00:00Z'),
    };
    expect(isTradingOpenAt(midnightRound, utcInstant('2026-09-23T00:00:00Z'))).toBe(true);

    const yearRound: HourlyRound = {
      ...round('OPEN'),
      startsAt: utcInstant('2026-12-31T23:00:00Z'),
      endsAtExclusive: utcInstant('2027-01-01T00:00:00Z'),
    };
    expect(isTradingOpenAt(yearRound, utcInstant('2026-12-31T23:59:59.999Z'))).toBe(true);
    expect(isTradingOpenAt(yearRound, utcInstant('2027-01-01T00:00:00Z'))).toBe(false);
  });
});
