const common = {
    targetProgram: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
    bridgeProgram: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
    baseTokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    quoteTokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
};
const goog = {
    quoteMint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN',
    bridgePool: 'Bh3njVo6i3UjgmaevEQMGoidphcueNjoPqGkYLbthzV5',
    bridgeSolVault: '6vaNc3WqFsfV2ghoQAUWsvEFjwjMVDq8WeMzMpAtqd4y',
    bridgeQuoteVault: 'BEfaWzWxdZWjZpdEnMacGmBJ6Hx1YdgBncV6z79dtmtf',
};
export const APPROVED_NON_SOL_PUMPSWAP_ROUTES = Object.freeze([
    Object.freeze({
        ...common,
        ...goog,
        mint: '5pHhLJn3nXKLXyHMpoMP8YLrt1Brt3z84NWspPkKWaep',
        targetPool: 'BJN4eK3Sa7XaNzEu73TTonRZfQ3aSzmbEbyCwE51Wb9h',
        targetBaseVault: '4ucYKU6mYiwtxnQWRR1mjpvaNnY7Km6qXoFNbLyJKryh',
        targetQuoteVault: '6kWYHHz6uR62CHWFu3JAgyxQYMpNs9Ck8raEYbEP2bQv',
    }),
    Object.freeze({
        ...common,
        mint: '7UhL5K7t1UDPLdhoj2Sz59kyn79Qvxkvk75ukfxDTUSD',
        quoteMint: 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn',
        targetPool: '3uYAmvTZwsAJbZhxBWRfexESBZCnfzmqjA56nJGCixNw',
        bridgePool: 'BofA2ViUSudPBTUms2KRuG6AHNeMawjNfwqTJDgx5BKW',
        targetBaseVault: 'Vzm9jQHBVFP5LUXUnWHRjmFAg3CAsBDcRJ1ccjpViNF',
        targetQuoteVault: 'HsQNWmcfyoVhv9dpcJ9HhXa3A3yY8Z4joYkjTkgBrnJz',
        bridgeSolVault: 'BkSYpPsv11UPDLonxBZf2mFndfuN2MrDwYt4gjDEnk8D',
        bridgeQuoteVault: '2wcLHj441NnqiUon4LcmMo6dGAUqwEW84nfFKnfuTnPt',
    }),
    Object.freeze({
        ...common,
        ...goog,
        mint: '9wcpJweVnKaGWhBd9xYT4ZXrjsyed53iipNiPQi6pump',
        targetPool: '2rM6Ep14wYYC9jNR9TtJj3pVggfj2qm7UXkfjd7tUJGK',
        targetBaseVault: '26AK9fNG5uoawcgPPbdXVd2WhegtKi9Gh7YQ9G7JwYs3',
        targetQuoteVault: '4QAJqpNt3K84fUb8ccX32HB1itS87WYE8NK7Cid4TPZt',
    }),
]);
export function validateNonSolPumpSwapRoutes(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 3)
        throw Error('NON_SOL_ALLOWLIST_REQUIRED');
    const seen = new Set();
    return Object.freeze(value.map((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw Error('NON_SOL_ALLOWLIST_INVALID');
        const row = raw, expected = APPROVED_NON_SOL_PUMPSWAP_ROUTES.find((r) => r.mint === row['mint']);
        if (!expected ||
            seen.has(expected.mint) ||
            Object.keys(row).length !== Object.keys(expected).length ||
            Object.entries(expected).some(([k, v]) => row[k] !== v))
            throw Error('NON_SOL_ALLOWLIST_IDENTITY_MISMATCH');
        seen.add(expected.mint);
        return expected;
    }));
}
//# sourceMappingURL=non-sol-pumpswap-routes.js.map