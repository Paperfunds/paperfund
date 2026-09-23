import { describe, expect, it } from 'vitest';

import { utcDailyBoundaries, utcHourlyBoundaries, utcInstant } from '../src/index.js';

describe('UTC competition boundaries', () => {
  it('calculates a normal hourly interval with an exclusive end', () => {
    expect(utcHourlyBoundaries('2026-09-23T15:42:10Z')).toEqual({
      start: '2026-09-23T15:00:00.000Z',
      endExclusive: '2026-09-23T16:00:00.000Z',
    });
  });

  it('calculates the hour at midnight UTC', () => {
    expect(utcHourlyBoundaries('2026-09-23T00:00:00Z')).toEqual({
      start: '2026-09-23T00:00:00.000Z',
      endExclusive: '2026-09-23T01:00:00.000Z',
    });
  });

  it('calculates the daily end-of-day transition', () => {
    expect(utcDailyBoundaries('2026-09-23T23:59:59.999Z')).toEqual({
      start: '2026-09-23T00:00:00.000Z',
      endExclusive: '2026-09-24T00:00:00.000Z',
    });
  });

  it('handles leap-day boundaries', () => {
    expect(utcDailyBoundaries('2028-02-29T12:00:00Z')).toEqual({
      start: '2028-02-29T00:00:00.000Z',
      endExclusive: '2028-03-01T00:00:00.000Z',
    });
  });

  it('handles end-of-year boundaries', () => {
    expect(utcHourlyBoundaries('2026-12-31T23:59:59Z')).toEqual({
      start: '2026-12-31T23:00:00.000Z',
      endExclusive: '2027-01-01T00:00:00.000Z',
    });
    expect(utcDailyBoundaries('2026-12-31T23:59:59Z')).toEqual({
      start: '2026-12-31T00:00:00.000Z',
      endExclusive: '2027-01-01T00:00:00.000Z',
    });
  });

  it('normalizes explicit offsets and rejects timezone-ambiguous strings', () => {
    expect(utcInstant('2026-09-23T17:00:00+02:00')).toBe('2026-09-23T15:00:00.000Z');
    expect(() => utcInstant('2026-09-23T15:00:00')).toThrow(/explicit UTC offset/);
  });
});
