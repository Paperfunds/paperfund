/** Candidate-only admission boundary; existing SOL adapter and all financial functions stay unchanged. */
import { ExecutionEngineError } from '@paperfund/execution';
import type { ProtocolAdapter } from '@paperfund/execution';
import { CandidateError } from '../../candidates/simple-price-v2/model.js';
import type { NonSolProvider } from './non-sol.js';
export function withNonSolEvidence(
  sol: ProtocolAdapter,
  provider: NonSolProvider,
): ProtocolAdapter {
  return {
    protocolId: sol.protocolId,
    adapterVersion: sol.adapterVersion,
    loadMarketState: async (identity) => {
      if (!identity.marketId.startsWith('solana-route:')) return sol.loadMarketState(identity);
      if (identity.marketId !== 'solana-route:' + identity.tokenMint)
        throw new ExecutionEngineError(
          'INVALID_MARKET_STATE',
          'TERMINAL_TOKEN_POOL_IDENTITY_MISMATCH',
        );
      try {
        await provider.inspect(identity.tokenMint);
        throw new CandidateError('DIRECTIONAL_COST_AND_ROUNDING_PROOF_REQUIRED');
      } catch (error) {
        if (error instanceof CandidateError)
          throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', error.code);
        if (error instanceof ExecutionEngineError)
          throw new ExecutionEngineError(
            'MARKET_STATE_UNAVAILABLE',
            error.code + ':' + error.message,
          );
        throw error;
      }
    },
    simulateBuy: (request, state) => sol.simulateBuy(request, state),
    simulateSell: (request, state) => sol.simulateSell(request, state),
    valuePositionForExit: (request, state) => sol.valuePositionForExit(request, state),
  };
}
