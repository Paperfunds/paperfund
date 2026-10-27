export const LAMPORTS_PER_SOL = 1000000000n;
export const PAPER_SOL_BASE_UNITS_PER_SOL = 1000000000n;
function parseDecimalBaseUnits(input, decimals, allowNegative) {
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
function formatDecimalBaseUnits(value, decimals) {
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const base = 10n ** BigInt(decimals);
    const whole = absolute / base;
    const fraction = (absolute % base).toString().padStart(decimals, '0').replace(/0+$/, '');
    const formatted = fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
    return negative ? `-${formatted}` : formatted;
}
function assertNonNegative(value, name) {
    if (value < 0n) {
        throw new RangeError(`${name} cannot be negative.`);
    }
}
export function lamports(value) {
    assertNonNegative(value, 'Lamports');
    return value;
}
export function paperSolBaseUnits(value) {
    assertNonNegative(value, 'Paper SOL');
    return value;
}
export function paperSolDelta(value) {
    return value;
}
export function tokenBaseUnits(value) {
    assertNonNegative(value, 'Token base units');
    return value;
}
export function tokenBaseUnitDelta(value) {
    return value;
}
export function lamportsFromSolString(value) {
    return lamports(parseDecimalBaseUnits(value, 9, false));
}
export function paperSolFromSolString(value) {
    return paperSolBaseUnits(parseDecimalBaseUnits(value, 9, false));
}
export function paperSolDeltaFromSolString(value) {
    return paperSolDelta(parseDecimalBaseUnits(value, 9, true));
}
export function formatLamports(value) {
    return formatDecimalBaseUnits(value, 9);
}
export function formatPaperSol(value) {
    return formatDecimalBaseUnits(value, 9);
}
//# sourceMappingURL=money.js.map