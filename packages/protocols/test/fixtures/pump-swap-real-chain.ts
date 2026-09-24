/**
 * Sanitized read-only Solana mainnet captures. Account identities and integer reserves are public;
 * no user account, signer, RPC URL, or secret is included. Captured 2026-09-24.
 */
export const RECORDED_PUMP_SWAP_FIXTURES = {
  normal: {
    capturedAt: '2026-09-24T21:48:12.707Z',
    slot: 450154797n,
    mint: '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump',
    pool: 'GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J',
    curve: '3MUkKMbuornHohtAtzrToSzqkj1gEEhQqYVz8sZnmQg1',
    curveBase64:
      'F7f4N2DYrGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAxqR+jQMAAUBSJXvOKKUQdTokJiE6YgocGypswlhuYW526HQhLhuuAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    baseVault: '5jMpkf4JF4noHftLgNKyPNh6roVfPSGSjuEk3U4eLKRa',
    quoteVault: '43DVcZR4kQFjh4Xm2i3DcneRxNjZp7HMud8yDrJWrDr8',
    baseReserves: 649_858_446_658_533n,
    rawQuoteReserves: 127_455_412_930n,
    virtualQuoteReserves: 0n,
    feeBps: { lp: 2n, protocol: 93n, creator: 30n },
  },
  deep: {
    capturedAt: '2026-09-24T21:48:46.745Z',
    slot: 450154927n,
    mint: '12PUFAUzgLj1onv3wSqX9ZagZBiaxofEjTd24CnQpump',
    pool: 'GQE8drmWfJBQ5djpHy39o4cFZNR1BDwcNb1eobGk531x',
    curve: 'GKQwrFVUdsvRzDbPgmXbHktSf4fJqJc3F6FTLsPkGcJ5',
    curveBase64:
      'F7f4N2DYrGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAxqR+jQMAAaRmvf10jStKOwyrLZ9DSnYSD5MMbLaX8SuQs7VllfRoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    baseVault: '2z8PBraUjSgFKvaYArMejAkSgKqcqLLh4NBc5oSkkEFb',
    quoteVault: '7T7sA6FQPxqSbjyeK8egKwNp5GmpEpoZxxGaTfnEuiaS',
    baseReserves: 663_193_816_522n,
    rawQuoteReserves: 26_597_129_590_375n,
    virtualQuoteReserves: 17_584_505_288n,
    feeBps: { lp: 20n, protocol: 5n, creator: 5n },
  },
  shallow: {
    capturedAt: '2026-09-24T21:49:28.641Z',
    slot: 450155085n,
    mint: '6FDw6jns8g7czuRucp5993RBNRPvqtMfv5Jv3hjnpump',
    pool: 'ATB9NBwxotPJPK43tyRuSecgKQBF5GmYuWohvr6f8tkZ',
    curve: '5DDomERtuUV8fonYNy72xS9yp5QmZVHFoEXmN66w6htQ',
    curveBase64:
      'F7f4N2DYrGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAxqR+jQMAAfCVZ6UcN68zTWdyPHEoKl6XyfR9Bs3F9X9X1SuSeJXlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    baseVault: '2JMDCUsGuADrodb8GtqkBkbjqwWrr3jyrqDt5CpHhQ2Q',
    quoteVault: '9uEmoPEDoRfsSQLnSQjhwEVzG5KBD1tktPtJti27uRKL',
    baseReserves: 169_721_117_942_763n,
    rawQuoteReserves: 88_387_197_954n,
    virtualQuoteReserves: 17_584_506_109n,
    feeBps: { lp: 20n, protocol: 5n, creator: 95n },
  },
} as const;
