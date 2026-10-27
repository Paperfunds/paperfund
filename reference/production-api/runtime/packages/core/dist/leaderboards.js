function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function rankByScore(results, score, userId) {
    const sorted = [...results].sort((left, right) => (score(left) > score(right) ? -1 : score(left) < score(right) ? 1 : 0) ||
        compareText(userId(left), userId(right)));
    const rankGroups = [];
    for (const result of sorted) {
        const previous = rankGroups.at(-1);
        if (previous && score(previous.results[0]) === score(result)) {
            const groupedResults = [...previous.results, result];
            rankGroups[rankGroups.length - 1] = {
                ...previous,
                tied: true,
                tieGroupSize: groupedResults.length,
                results: groupedResults,
            };
        }
        else {
            rankGroups.push({
                rank: rankGroups.reduce((count, group) => count + group.tieGroupSize, 0) + 1,
                tied: false,
                tieGroupSize: 1,
                results: [result],
            });
        }
    }
    return { participantCount: sorted.length, rankGroups };
}
function hasDuplicateUsers(results, userId) {
    return new Set(results.map(userId)).size !== results.length;
}
export function selectProvisionalWinners(leaderboard, winnerCount) {
    if (!Number.isInteger(winnerCount) || winnerCount <= 0) {
        return { ok: false, reason: 'INVALID_WINNER_COUNT' };
    }
    const provisionalWinners = [];
    for (const group of leaderboard.rankGroups) {
        const groupEnd = group.rank + group.tieGroupSize - 1;
        if (group.rank > winnerCount)
            break;
        if (groupEnd > winnerCount) {
            provisionalWinners.push(...group.results);
            break;
        }
        provisionalWinners.push(...group.results);
    }
    return { ok: true, winnerCount, cutoffBlocked: false, provisionalWinners };
}
export function buildHourlyLeaderboard(input) {
    if (input.round.state !== 'FINALIZED') {
        return { ok: false, reason: 'HOURLY_RESULT_NOT_FINALIZED' };
    }
    if (input.results.some(({ hourlyRoundId }) => hourlyRoundId !== input.round.id)) {
        return { ok: false, reason: 'HOURLY_RESULT_ROUND_MISMATCH' };
    }
    if (hasDuplicateUsers(input.results, ({ userId }) => userId)) {
        return { ok: false, reason: 'DUPLICATE_LEADERBOARD_USER' };
    }
    const leaderboard = rankByScore(input.results, ({ pnl }) => pnl, ({ userId }) => userId);
    return {
        ok: true,
        leaderboard,
        winnerSelection: selectProvisionalWinners(leaderboard, input.winnerCount),
    };
}
export function buildDailyLeaderboard(input) {
    if (input.results.some(({ dailyCompetitionId }) => dailyCompetitionId !== input.dailyCompetition.id)) {
        return { ok: false, reason: 'DAILY_COMPETITION_MISMATCH' };
    }
    if (hasDuplicateUsers(input.results, ({ userId }) => userId)) {
        return { ok: false, reason: 'DUPLICATE_LEADERBOARD_USER' };
    }
    const leaderboard = rankByScore(input.results, ({ cumulativePnl }) => cumulativePnl, ({ userId }) => userId);
    return {
        ok: true,
        leaderboard,
        winnerSelection: selectProvisionalWinners(leaderboard, input.winnerCount),
    };
}
//# sourceMappingURL=leaderboards.js.map