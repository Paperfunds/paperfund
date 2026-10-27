import type { PayoutSigner } from '../../db/src/payout-execution.js';
import { assertPayoutStep, invokeAuthorizedPayoutEffect } from '../../db/src/payout-security.js';

// This module belongs only in the separately supervised payout-signing process.
// There is deliberately no environment key loader, HTTP endpoint or configured production provider.
export interface SigningKeyHandle {
  readonly publicKey: string;
  signTransaction(unsigned: Uint8Array): ReturnType<PayoutSigner['signTransaction']>;
}
export interface IsolatedSigningProvider {
  open(): Promise<SigningKeyHandle>;
}
export function createIsolatedPayoutSigner(
  publicKey: string,
  provider: IsolatedSigningProvider,
): PayoutSigner {
  return {
    type: 'ISOLATED_PROVIDER',
    publicKey,
    async signTransaction(unsigned) {
      await assertPayoutStep('SIGN');
      let handle: SigningKeyHandle;
      try {
        handle = await provider.open();
      } catch {
        throw new Error('PAYOUT_SIGNING_PROVIDER_UNAVAILABLE');
      }
      if (handle.publicKey !== publicKey)
        throw new Error('PAYOUT_SIGNING_PROVIDER_IDENTITY_MISMATCH');
      return invokeAuthorizedPayoutEffect('SIGN', undefined, () => {
        try {
          return handle.signTransaction(unsigned).catch(() => {
            throw new Error('PAYOUT_SIGNING_PROVIDER_FAILED');
          });
        } catch {
          throw new Error('PAYOUT_SIGNING_PROVIDER_FAILED');
        }
      });
    },
  };
}
