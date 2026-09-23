import type { Brand } from './brand.js';

export type BasisPoints = Brand<bigint, 'BasisPoints'>;
export type PartsPerMillion = Brand<bigint, 'PartsPerMillion'>;

export const BASIS_POINTS_PER_WHOLE = 10_000n;
export const PARTS_PER_MILLION_PER_WHOLE = 1_000_000n;

function assertRateInRange(value: bigint, scale: bigint, name: string): void {
  if (value < 0n || value > scale) {
    throw new RangeError(`${name} must be between 0 and ${scale.toString()} inclusive.`);
  }
}

export function basisPoints(value: bigint): BasisPoints {
  assertRateInRange(value, BASIS_POINTS_PER_WHOLE, 'Basis points');
  return value as BasisPoints;
}

export function partsPerMillion(value: bigint): PartsPerMillion {
  assertRateInRange(value, PARTS_PER_MILLION_PER_WHOLE, 'Parts per million');
  return value as PartsPerMillion;
}
