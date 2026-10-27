/** Largest exact-token input funded by the snapshot, using integer constant-product math.
 * Reserve feasibility is monotone. Net output is not assumed monotone: independently rounded
 * fees can create zero-output dust plateaus, which are skipped by exact gross-output inversion.
 * No RPC calls, fabricated reserves, or state mutations occur during this advisory search.
 */
export function maximumConstantProductSell(quantity, base, quote, funded, net) {
    let low = 0n;
    let high = quantity;
    const grossFor = (q) => (q * quote) / (base + q);
    while (low < high) {
        const mid = (low + high + 1n) / 2n;
        if (funded(grossFor(mid)))
            low = mid;
        else
            high = mid - 1n;
    }
    while (low > 0n) {
        const gross = grossFor(low);
        if (gross === 0n)
            return 0n;
        if (net(gross) > 0n)
            return low;
        // floor(q * quote / (base + q)) < gross.
        low = (gross * base - 1n) / (quote - gross);
    }
    return 0n;
}
//# sourceMappingURL=sell-capacity.js.map