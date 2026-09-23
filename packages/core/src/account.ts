import type { CompetitionConfig } from './configuration.js';
import type { CompetitionAccountId, HourlyRoundId, UserId, WalletAddress } from './identifiers.js';
import type { CompetitionAccount } from './types.js';

export interface InitializeCompetitionAccountInput {
  readonly accountId: CompetitionAccountId;
  readonly userId: UserId;
  readonly walletAddress: WalletAddress;
  readonly hourlyRoundId: HourlyRoundId;
  readonly config: Pick<CompetitionConfig, 'startingPaperSolBaseUnits'>;
}

/** Creates fresh hourly state. No prior balance, exposure, or slot state is accepted or carried over. */
export function initializeCompetitionAccount(
  input: InitializeCompetitionAccountInput,
): CompetitionAccount {
  return {
    id: input.accountId,
    userId: input.userId,
    walletAddress: input.walletAddress,
    hourlyRoundId: input.hourlyRoundId,
    paperSolBalance: input.config.startingPaperSolBaseUnits,
    tokenSlots: [],
  };
}
