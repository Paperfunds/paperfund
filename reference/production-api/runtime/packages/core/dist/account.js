/** Creates fresh hourly state. No prior balance, exposure, or slot state is accepted or carried over. */
export function initializeCompetitionAccount(input) {
    return {
        id: input.accountId,
        userId: input.userId,
        walletAddress: input.walletAddress,
        hourlyRoundId: input.hourlyRoundId,
        paperSolBalance: input.config.startingPaperSolBaseUnits,
        tokenSlots: [],
    };
}
//# sourceMappingURL=account.js.map