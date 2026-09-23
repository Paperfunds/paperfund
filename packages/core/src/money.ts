import type { Brand } from './brand.js';

export type Lamports = Brand<bigint, 'Lamports'>;
export type PaperSolBaseUnits = Brand<bigint, 'PaperSolBaseUnits'>;
export type PaperSolDelta = Brand<bigint, 'PaperSolDelta'>;
export type TokenBaseUnits = Brand<bigint, 'TokenBaseUnits'>;
export type TokenBaseUnitDelta = Brand<bigint, 'TokenBaseUnitDelta'>;

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const PAPER_SOL_BASE_UNITS_PER_SOL = 1_000_000_000n;

function parseDecimalBaseUnits(input: string, decimals: number, allowNegative: boolean): bigint {
  const pattern = allowNegative ? /^-?(?:0|[1-9]\d*)(?:\.(\d+))?$/ : /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;
  const match = pattern.exec(input);

  if (!match) {
    throw new TypeError(`Invalid decimal amount: ${input}`);
  }

  const fraction = match[1] ?? '';
  if (fraction.length > decimals) {
    throw new RangeError(`Amount exceeds the supported precision of ${decimals} decimal places.`);
  }

  const negative = input.startsWith('-');
  const unsigned = negative ? input.slice(1) : input;
  const [whole = '0', fractional = ''] = unsigned.split('.');
  const base = 10n ** BigInt(decimals);
  const units = BigInt(whole) * base + BigInt(fractional.padEnd(decimals, '0') || '0');
  return negative ? -units : units;
}

function formatDecimalBaseUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  const formatted = fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
  return negative ? `-${formatted}` : formatted;
}

function assertNonNegative(value: bigint, name: string): void {
  if (value < 0n) {
    throw new RangeError(`${name} cannot be negative.`);
  }
}

export function lamports(value: bigint): Lamports {
  assertNonNegative(value, 'Lamports');
  return value as Lamports;
}

export function paperSolBaseUnits(value: bigint): PaperSolBaseUnits {
  assertNonNegative(value, 'Paper SOL');
  return value as PaperSolBaseUnits;
}

export function paperSolDelta(value: bigint): PaperSolDelta {
  return value as PaperSolDelta;
}

export function tokenBaseUnits(value: bigint): TokenBaseUnits {
  assertNonNegative(value, 'Token base units');
  return value as TokenBaseUnits;
}

export function tokenBaseUnitDelta(value: bigint): TokenBaseUnitDelta {
  return value as TokenBaseUnitDelta;
}

export function lamportsFromSolString(value: string): Lamports {
  return lamports(parseDecimalBaseUnits(value, 9, false));
}

export function paperSolFromSolString(value: string): PaperSolBaseUnits {
  return paperSolBaseUnits(parseDecimalBaseUnits(value, 9, false));
}

export function paperSolDeltaFromSolString(value: string): PaperSolDelta {
  return paperSolDelta(parseDecimalBaseUnits(value, 9, true));
}

export function formatLamports(value: Lamports): string {
  return formatDecimalBaseUnits(value, 9);
}

export function formatPaperSol(value: PaperSolBaseUnits | PaperSolDelta): string {
  return formatDecimalBaseUnits(value, 9);
}
