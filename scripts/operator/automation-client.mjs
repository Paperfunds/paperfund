import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from './common.mjs';
import { nextClaim, iso, fail } from './automation-core.mjs';
import { rewardOverview } from './reward-overview.mjs';
export const IPC = path.join(process.env.ProgramData ?? ROOT, 'PaperfundAutomation');
const local = path.join(ROOT, 'artifacts/operator/automation-observer.json');
async function get(file) {
  try {
    return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}
export async function automationStatus() {
  const [service, observer, rewards, diagnostics] = await Promise.all([
    get(path.join(IPC, 'public/status.json')),
    get(local),
    rewardOverview(),
    get(path.join(ROOT, 'artifacts/operator/automation-qualification-latest.json')),
  ]);
  const fresh =
    !!service &&
    Date.now() - Date.parse(service.at) >= 0 &&
    Date.now() - Date.parse(service.at) < 45000;
  return {
    observedAt: iso(Date.now()),
    protectedService: fresh ? 'RUNNING' : service ? 'STALE_NO_NEW_SIGNING' : 'NOT_ENROLLED',
    service: fresh ? service : null,
    lastServiceEvidence:
      service && !fresh ? { at: service.at, auditHead: service.auditHead } : null,
    observer,
    settings: fresh
      ? service.settings
      : { claims: false, hourly: false, daily: false, emergencyStop: true },
    nextClaimAt: fresh ? service.nextClaimAt : iso(nextClaim(Date.now())),
    schedule: 'HH:59 UTC',
    schedulerMode: fresh ? 'PROTECTED_POLICY_GATED' : 'OBSERVATION_ONLY_NO_SIGNING',
    claimableLamports: rewards.provider?.claimableLamports ?? null,
    receivedTokenAttributedLamports: rewards.provider?.receivedTokenAttributedLamports ?? '0',
    availableRewardLamports:
      (observer?.database?.verifiedReceivedCreatorFeeLamports ??
        rewards.provider?.receivedTokenAttributedLamports ??
        '0') === '0'
        ? '0'
        : null,
    availableRewardReason: 'NO_ACCEPTED_TOKEN_ATTRIBUTED_RECEIPT_AND_MAINNET_SOURCE_PROFILE',
    reservedPrincipalLamports: observer?.database?.reservedPrincipalLamports ?? null,
    queue: rewards.plans ?? [],
    paid: rewards.executions?.filter((x) => x.state === 'VERIFIED') ?? [],
    qualification: {
      stop: observer?.database?.stop ?? rewards.stop,
      provider:
        (fresh ? service.gate?.provider : null) ?? rewards.provider?.qualification ?? 'UNQUALIFIED',
      utc: (fresh ? service.gate?.utc : null) ?? rewards.clock?.qualification ?? 'UNQUALIFIED',
      diagnostics,
      mainnetPayoutAcceptance: fresh
        ? service.mainnet?.accepted
          ? 'ACCEPTED'
          : (service.mainnet?.reason ?? 'BACKEND_UPDATE_REQUIRED')
        : 'SERVICE_UNAVAILABLE',
    },
    policy: fresh ? service.policy : null,
    blockers: fresh
      ? service.blockers
      : [
          'PROTECTED_SERVICE_NOT_ENROLLED',
          'SIGNED_STANDING_POLICY_REQUIRED',
          'FRESH_UNCOMPROMISED_CUSTODY_REQUIRED',
          'FINANCIAL_STOP_ASSERTED',
          'MAINNET_PAYOUT_ACCEPTANCE_NOT_DEPLOYED',
        ],
  };
}
export async function automationControl(action) {
  if (
    ![
      'claim-now',
      'claims:on',
      'claims:off',
      'hourly:on',
      'hourly:off',
      'daily:on',
      'daily:off',
      'STOP',
      'reconcile',
    ].includes(action)
  )
    fail('CONTROL_INVALID');
  const status = await automationStatus();
  if (status.protectedService !== 'RUNNING') fail('SECURE_SERVICE_ENROLLMENT_REQUIRED');
  const id = randomUUID(),
    request = { schema: 'paperfund-automation-request-v1', id, action, createdAt: iso(Date.now()) };
  const dir = path.join(IPC, 'inbox');
  if (action === 'STOP')
    await fs.writeFile(path.join(dir, 'emergency.stop'), JSON.stringify(request), { flag: 'w' });
  await fs.writeFile(path.join(dir, id + '.json'), JSON.stringify(request), { flag: 'wx' });
  return {
    accepted: true,
    id,
    action,
    authorityGranted: false,
    status: 'REQUESTED_AWAIT_PROTECTED_SERVICE_ACK',
  };
}

export async function exportPolicyDraft() {
  const dir = path.join(process.env.LOCALAPPDATA, 'PaperfundOperator');
  await fs.mkdir(dir, { recursive: true });
  const now = Date.now(),
    draft = {
      schema: 'paperfund-standing-automation-v1',
      id: randomUUID(),
      operator: 'REPLACE_WITH_OPERATOR_ID',
      generation: 0,
      financialStopGeneration: '0',
      issuedAt: iso(now),
      expiresAt: iso(now + 86400000),
      network: 'mainnet-beta',
      genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
      wallet: 'REPLACE_WITH_FRESH_ENROLLED_PUBLIC_WALLET',
      mint: '3JVd8Z3kEEXBaBoZo9rcWk4MHJPSUAf6zAjvAF5spump',
      custody: {
        rotationConfirmed: false,
        wallet: 'REPLACE_WITH_FRESH_ENROLLED_PUBLIC_WALLET',
        mode: 'DPAPI_CURRENT_USER_ISOLATED',
      },
      claims: {
        enabled: false,
        instruction: 'collect_creator_fee_v2',
        minGrossLamports: '0',
        maxGrossLamports: '0',
        maxHourlyGrossLamports: '0',
        maxDailyGrossLamports: '0',
        maxFeeLamports: '0',
        maxDailyFeeLamports: '0',
        maxTransactionsPerHour: 1,
        maxTransactionsPerDay: 24,
      },
      payouts: {
        recipients: 'IMMUTABLE_QUALIFIED_EXISTING_PLANS',
        maxRecipientLamports: '0',
        maxDailyLamports: '0',
        maxOutstandingLamports: '0',
        maxFeeLamports: '0',
        maxDailyFeeLamports: '0',
        maxTransactionsPerDay: 1,
        hourly: { enabled: false, maxRoundLamports: '0' },
        daily: { enabled: false, maxRoundLamports: '0' },
      },
    };
  const file = path.join(dir, 'automation-policy-' + draft.id + '.draft.json');
  await fs.writeFile(file, JSON.stringify(draft, null, 2), { flag: 'wx' });
  return {
    draftPath: file,
    authorityGranted: false,
    instructions:
      'Edit only public identity and explicit limits. Enroll fresh custody and use the protected administrator approval tool. Zero limits grant no financial authority.',
    command:
      '& "C:\\Program Files\\PaperfundSigner\\authorize-automation.ps1" -Draft "' + file + '"',
  };
}
