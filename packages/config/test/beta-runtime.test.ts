import { expect, it } from 'vitest';
import { parseApplicationEnvironment } from '../src/index.js';
const base = {
  DATABASE_URL: 'postgresql://fixture@127.0.0.1/fixture',
  REDIS_URL: 'redis://127.0.0.1',
  BETA_INVITE_ONLY: 'true',
};
it('ordinary services require invite-only non-paying configuration and cannot receive signing/operator secrets', () => {
  expect(parseApplicationEnvironment(base).BETA_WALLET_ALLOWLIST).toEqual([]);
  for (const patch of [
    { BETA_INVITE_ONLY: 'false' },
    { PRIVATE_BETA_NON_PAYING: 'false' },
    { PAYOUT_EXECUTION_ENABLED: 'true' },
    { PAYOUT_SIGNER_TYPE: 'KEYPAIR' },
    { PAYOUT_SIGNER_SECRET_KEY: '' },
    { PAYOUT_SIGNER_SECRET_FILE: '' },
    { PAYOUT_OPERATOR_PRIVATE_KEY: '' },
    { PAYOUT_OPERATOR_TOKEN: '' },
  ])
    expect(() => parseApplicationEnvironment({ ...base, ...patch })).toThrow();
});
