const LAMPORTS_PER_SOL = 1000000000n;
export function formatUnits(value, decimals, places = 4) {
    const raw = typeof value === 'bigint' ? value : BigInt(value);
    const negative = raw < 0n;
    const absolute = negative ? -raw : raw;
    const scale = 10n ** BigInt(decimals);
    const whole = absolute / scale;
    const fraction = (absolute % scale)
        .toString()
        .padStart(decimals, '0')
        .slice(0, places)
        .replace(/0+$/, '');
    return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}
export function formatSol(value, places = 4) {
    return `${formatUnits(value, 9, places)} SOL`;
}
export function solTextToLamports(value) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{0,9})?$/.test(value))
        return null;
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole) * LAMPORTS_PER_SOL + BigInt(fraction.padEnd(9, '0'));
}
export function lamportsToSolInput(value) {
    const whole = value / LAMPORTS_PER_SOL;
    const fraction = (value % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
}
export function percentageQuantity(quantity, percentage) {
    const total = BigInt(quantity);
    return percentage === 100 ? total.toString() : ((total * BigInt(percentage)) / 100n).toString();
}
export function shorten(value, size = 5) {
    return value.length <= size * 2 + 1 ? value : `${value.slice(0, size)}…${value.slice(-size)}`;
}
export function venueName(protocol) {
    if (protocol === 'PUMP_FUN')
        return 'Pump.fun';
    if (protocol === 'PUMP_SWAP')
        return 'PumpSwap';
    if (protocol === 'SOLANA_ROUTE')
        return 'Solana routed market';
    return protocol ?? '—';
}
export function buyPreflightMessage(preflight) {
    if (!preflight)
        return null;
    if (!preflight.marketSupported)
        return `Current token market unavailable: ${preflight.marketStatus}.`;
    if (preflight.blockingReason === 'GENERIC_OPERATOR_ENTRY_DISABLED')
        return 'BUY unavailable: generic-market entries are currently disabled. Existing positions can still be sold.';
    if (preflight.blockingReason === 'PORTFOLIO_EQUITY_UNAVAILABLE' ||
        preflight.equityValuationStatus === 'UNAVAILABLE' ||
        (!preflight.equityValuationStatus && preflight.valuationStatus !== 'AVAILABLE'))
        return 'BUY paused: portfolio equity cannot be established because an open position has no authoritative full-exit value. Partial SELL may still be available.';
    if (preflight.blockingReason)
        return `BUY unavailable: ${preflight.blockingReason}.`;
    if (preflight.equityValuationStatus === 'PARTIAL_LIQUIDITY')
        return 'BUY uses conservative equity: illiquid position remainder is valued at 0 Paper SOL.';
    if (!preflight.slotAvailable)
        return 'All token slots for this round have been used.';
    return null;
}
//# sourceMappingURL=browser.js.map