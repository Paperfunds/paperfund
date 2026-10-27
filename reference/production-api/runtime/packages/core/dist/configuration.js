import { z } from 'zod';
import { lamports, paperSolBaseUnits } from './money.js';
import { BASIS_POINTS_PER_WHOLE, PARTS_PER_MILLION_PER_WHOLE, basisPoints, partsPerMillion, } from './percentages.js';
const basisPointsSchema = z.bigint().min(0n).max(BASIS_POINTS_PER_WHOLE).transform(basisPoints);
const payoutShareSchema = z
    .bigint()
    .min(0n)
    .max(PARTS_PER_MILLION_PER_WHOLE)
    .transform(partsPerMillion);
const feeAllocationSchema = z
    .object({
    hourlyBps: basisPointsSchema,
    bufferContributionBps: basisPointsSchema,
    dailyBps: basisPointsSchema,
    platformBps: basisPointsSchema,
})
    .readonly();
const payoutCurveEntrySchema = z
    .object({
    rank: z.number().int().positive(),
    sharePpm: payoutShareSchema,
})
    .readonly();
const payoutCurveSchema = z.array(payoutCurveEntrySchema).readonly();
function sumBasisPoints(values) {
    return values.reduce((total, value) => total + value, 0n);
}
function sumPartsPerMillion(values) {
    return values.reduce((total, value) => total + value, 0n);
}
export function validatePayoutCurve(curve, expectedWinnerCount) {
    if (curve.length !== expectedWinnerCount) {
        throw new RangeError(`Payout curve has ${curve.length.toString()} ranks; expected ${expectedWinnerCount.toString()}.`);
    }
    const uniqueRanks = new Set(curve.map(({ rank }) => rank));
    if (uniqueRanks.size !== curve.length) {
        throw new RangeError('Payout curve ranks must not contain duplicates.');
    }
    curve.forEach(({ rank, sharePpm }, index) => {
        const expectedRank = index + 1;
        if (rank !== expectedRank) {
            throw new RangeError(`Payout curve rank ${rank.toString()} is out of sequence; expected ${expectedRank.toString()}.`);
        }
        if (sharePpm < 0n) {
            throw new RangeError('Payout curve shares cannot be negative.');
        }
    });
    if (sumPartsPerMillion(curve.map(({ sharePpm }) => sharePpm)) !== PARTS_PER_MILLION_PER_WHOLE) {
        throw new RangeError('Payout curve must total exactly 100%.');
    }
}
export const competitionConfigSchema = z
    .object({
    version: z.string().min(1),
    startingPaperSolBaseUnits: z.bigint().positive().transform(paperSolBaseUnits),
    hourlyRoundDurationSeconds: z.number().int().positive(),
    authoritativeTimezone: z.literal('UTC'),
    maxUniqueTokensPerRound: z.number().int().positive(),
    maxBuyRatioBps: z.bigint().min(1n).max(BASIS_POINTS_PER_WHOLE).transform(basisPoints),
    hourlyWinnerCount: z.number().int().positive(),
    dailyWinnerCount: z.number().int().positive(),
    creatorFees: z
        .object({
        normal: feeAllocationSchema,
        bufferAccumulation: feeAllocationSchema,
    })
        .readonly(),
    rewardBuffer: z
        .object({
        dynamicCurveEnabled: z.boolean(),
        lambdaBps: basisPointsSchema,
        baselineWindowCompletedHours: z.number().int().positive(),
        explicitAccumulationEnabled: z.boolean(),
        explicitContributionBps: basisPointsSchema,
        reserveTargetLamports: z.bigint().min(0n).transform(lamports).nullable(),
        dailyBufferSupportEnabled: z.literal(false),
    })
        .readonly(),
    rewardFinalizationGracePeriodSeconds: z.number().int().min(0),
    hourlyPayoutCurve: payoutCurveSchema,
    dailyPayoutCurve: payoutCurveSchema,
})
    .superRefine((config, context) => {
    const normalTotal = sumBasisPoints([
        config.creatorFees.normal.hourlyBps,
        config.creatorFees.normal.bufferContributionBps,
        config.creatorFees.normal.dailyBps,
        config.creatorFees.normal.platformBps,
    ]);
    if (normalTotal !== BASIS_POINTS_PER_WHOLE) {
        context.addIssue({
            code: 'custom',
            path: ['creatorFees', 'normal'],
            message: 'Normal creator-fee allocation must total exactly 100%.',
        });
    }
    const bufferTotal = sumBasisPoints([
        config.creatorFees.bufferAccumulation.hourlyBps,
        config.creatorFees.bufferAccumulation.bufferContributionBps,
        config.creatorFees.bufferAccumulation.dailyBps,
        config.creatorFees.bufferAccumulation.platformBps,
    ]);
    if (bufferTotal !== BASIS_POINTS_PER_WHOLE) {
        context.addIssue({
            code: 'custom',
            path: ['creatorFees', 'bufferAccumulation'],
            message: 'Buffer Accumulation creator-fee allocation must total exactly 100%.',
        });
    }
    if (config.creatorFees.normal.bufferContributionBps !== 0n) {
        context.addIssue({
            code: 'custom',
            path: ['creatorFees', 'normal', 'bufferContributionBps'],
            message: 'Normal Mode cannot make an explicit Reward Buffer contribution.',
        });
    }
    if (config.creatorFees.bufferAccumulation.bufferContributionBps !==
        config.rewardBuffer.explicitContributionBps) {
        context.addIssue({
            code: 'custom',
            path: ['rewardBuffer', 'explicitContributionBps'],
            message: 'The explicit contribution must match Buffer Accumulation Mode.',
        });
    }
    if (config.creatorFees.bufferAccumulation.hourlyBps +
        config.creatorFees.bufferAccumulation.bufferContributionBps !==
        config.creatorFees.normal.hourlyBps) {
        context.addIssue({
            code: 'custom',
            path: ['creatorFees', 'bufferAccumulation'],
            message: 'The explicit buffer contribution must be deducted from the hourly allocation.',
        });
    }
    for (const [path, curve, count] of [
        ['hourlyPayoutCurve', config.hourlyPayoutCurve, config.hourlyWinnerCount],
        ['dailyPayoutCurve', config.dailyPayoutCurve, config.dailyWinnerCount],
    ]) {
        try {
            validatePayoutCurve(curve, count);
        }
        catch (error) {
            context.addIssue({
                code: 'custom',
                path: [path],
                message: error instanceof Error ? error.message : 'Invalid payout curve.',
            });
        }
    }
})
    .readonly();
const canonicalConfigurationInput = {
    version: 'phase-1a-v1',
    startingPaperSolBaseUnits: 10000000000n,
    hourlyRoundDurationSeconds: 3_600,
    authoritativeTimezone: 'UTC',
    maxUniqueTokensPerRound: 5,
    maxBuyRatioBps: 2000n,
    hourlyWinnerCount: 10,
    dailyWinnerCount: 25,
    creatorFees: {
        normal: {
            hourlyBps: 6300n,
            bufferContributionBps: 0n,
            dailyBps: 2700n,
            platformBps: 1000n,
        },
        bufferAccumulation: {
            hourlyBps: 5800n,
            bufferContributionBps: 500n,
            dailyBps: 2700n,
            platformBps: 1000n,
        },
    },
    rewardBuffer: {
        dynamicCurveEnabled: true,
        lambdaBps: 6000n,
        baselineWindowCompletedHours: 12,
        explicitAccumulationEnabled: false,
        explicitContributionBps: 500n,
        reserveTargetLamports: null,
        dailyBufferSupportEnabled: false,
    },
    rewardFinalizationGracePeriodSeconds: 60,
    hourlyPayoutCurve: [
        { rank: 1, sharePpm: 250000n },
        { rank: 2, sharePpm: 192000n },
        { rank: 3, sharePpm: 147400n },
        { rank: 4, sharePpm: 113200n },
        { rank: 5, sharePpm: 86900n },
        { rank: 6, sharePpm: 66700n },
        { rank: 7, sharePpm: 51200n },
        { rank: 8, sharePpm: 39300n },
        { rank: 9, sharePpm: 30200n },
        { rank: 10, sharePpm: 23100n },
    ],
    dailyPayoutCurve: [
        { rank: 1, sharePpm: 150000n },
        { rank: 2, sharePpm: 127920n },
        { rank: 3, sharePpm: 109090n },
        { rank: 4, sharePpm: 93030n },
        { rank: 5, sharePpm: 79340n },
        { rank: 6, sharePpm: 67660n },
        { rank: 7, sharePpm: 57700n },
        { rank: 8, sharePpm: 49210n },
        { rank: 9, sharePpm: 41960n },
        { rank: 10, sharePpm: 35790n },
        { rank: 11, sharePpm: 30520n },
        { rank: 12, sharePpm: 26030n },
        { rank: 13, sharePpm: 22200n },
        { rank: 14, sharePpm: 18930n },
        { rank: 15, sharePpm: 16140n },
        { rank: 16, sharePpm: 13770n },
        { rank: 17, sharePpm: 11740n },
        { rank: 18, sharePpm: 10010n },
        { rank: 19, sharePpm: 8540n },
        { rank: 20, sharePpm: 7280n },
        { rank: 21, sharePpm: 6210n },
        { rank: 22, sharePpm: 5300n },
        { rank: 23, sharePpm: 4520n },
        { rank: 24, sharePpm: 3850n },
        { rank: 25, sharePpm: 3260n },
    ],
};
export function validateCompetitionConfig(input) {
    return competitionConfigSchema.parse(input);
}
export const competitionConfig = validateCompetitionConfig(canonicalConfigurationInput);
//# sourceMappingURL=configuration.js.map