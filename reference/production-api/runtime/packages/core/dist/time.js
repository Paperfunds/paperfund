const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/;
export function utcInstant(value) {
    if (typeof value === 'string' && !EXPLICIT_TIMEZONE.test(value)) {
        throw new TypeError('String timestamps must include an explicit UTC offset or Z suffix.');
    }
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new TypeError('Invalid timestamp.');
    }
    return date.toISOString();
}
function dateFromUtcInstant(value) {
    return new Date(value);
}
export function utcHourlyBoundaries(value) {
    const instant = utcInstant(value);
    const start = dateFromUtcInstant(instant);
    start.setUTCMinutes(0, 0, 0);
    const endExclusive = new Date(start.getTime());
    endExclusive.setUTCHours(endExclusive.getUTCHours() + 1);
    return {
        start: utcInstant(start),
        endExclusive: utcInstant(endExclusive),
    };
}
export function utcDailyBoundaries(value) {
    const instant = utcInstant(value);
    const source = dateFromUtcInstant(instant);
    const start = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
    const endExclusive = new Date(start.getTime());
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    return {
        start: utcInstant(start),
        endExclusive: utcInstant(endExclusive),
    };
}
//# sourceMappingURL=time.js.map