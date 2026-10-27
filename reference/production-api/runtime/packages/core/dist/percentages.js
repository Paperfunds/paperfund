export const BASIS_POINTS_PER_WHOLE = 10000n;
export const PARTS_PER_MILLION_PER_WHOLE = 1000000n;
function assertRateInRange(value, scale, name) {
    if (value < 0n || value > scale) {
        throw new RangeError(`${name} must be between 0 and ${scale.toString()} inclusive.`);
    }
}
export function basisPoints(value) {
    assertRateInRange(value, BASIS_POINTS_PER_WHOLE, 'Basis points');
    return value;
}
export function partsPerMillion(value) {
    assertRateInRange(value, PARTS_PER_MILLION_PER_WHOLE, 'Parts per million');
    return value;
}
//# sourceMappingURL=percentages.js.map