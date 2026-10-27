export function identifier(value, name) {
    if (value.length === 0 || value.trim() !== value) {
        throw new TypeError(`${name} must be a non-empty string without surrounding whitespace.`);
    }
    return value;
}
//# sourceMappingURL=identifiers.js.map