import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from './api.js';
import { formatSol, shorten } from './format.js';
import type { User } from './types.js';

type Pool = {
  hourlyRoundId?: string;
  status: string;
  allocationMode?: string;
  splitRatesBps?: { hourly: string; daily: string; buffer: string; platform: string };
  verifiedCreatorFeeLamports?: string;
  creatorFeeLamports?: string;
  provisionalNaturalHourlyLamports?: string;
  naturalHourlyLamports?: string;
  finalHourlyPrizeLamports?: string;
  provisionalDailyAllocationLamports?: string;
  dailyAllocationLamports?: string;
  platformAllocationLamports?: string;
  explicitBufferContributionLamports?: string;
  endingBufferLamports?: string;
  accumulatedLamports?: string;
  startsAt?: string;
  endsAtExclusive?: string;
};
export type RewardEvidence = {
  readAt: string;
  paymentStateObservedAt: string | null;
  accountingObservedAt: string | null;
  providerObservedAt: string | null;
  fundingObservedAt: string | null;
  stop: string;
  payoutsActive: boolean;
  observedCreatorFeesLamports: string | null;
  receivedCreatorFeesLamports: string | null;
  qualifiedLamports: string | null;
  reservedLamports: string | null;
  qualification: string;
  claimReceipt: {
    signature: string;
    grossLamports: string | null;
    commitment: string;
    status: string;
  } | null;
  observations: {
    signature: string | null;
    eventIndex: number | null;
    eventTime: string | null;
    lamports: string | null;
    status: string;
  }[];
  payoutHistoryStatus: string;
  payoutHistory: { signature: string; lamports: string; verifiedAt: string; status: string }[];
};
const sol = (value: string | null | undefined) =>
  value == null ? 'Unavailable' : formatSol(value, 9);
function TxLink({ signature }: { signature: string }) {
  return (
    <a
      className="transaction-link mono"
      href={`https://solscan.io/tx/${encodeURIComponent(signature)}`}
      target="_blank"
      rel="noreferrer"
      title={signature}
    >
      {shorten(signature, 9)} ↗
    </a>
  );
}
function Amount({
  label,
  value,
  note,
}: {
  label: string;
  value?: string | null | undefined;
  note: string;
}) {
  return (
    <div className="reward-metric">
      <span>{label}</span>
      <strong>{sol(value)}</strong>
      <small>{note}</small>
    </div>
  );
}
export function RewardsPage({ user }: { user: User | null }) {
  const hourly = useQuery({
    queryKey: ['reward-hourly'],
    queryFn: () => api.hourlyRewards() as Promise<Pool | null>,
    refetchInterval: 15000,
  });
  const daily = useQuery({
    queryKey: ['reward-daily'],
    queryFn: () => api.dailyRewards() as Promise<Pool | null>,
    refetchInterval: 15000,
  });
  const evidence = useQuery({
    queryKey: ['public-reward-evidence'],
    queryFn: async (): Promise<RewardEvidence> => {
      const r = await fetch('/website/rewards', { credentials: 'omit' });
      if (!r.ok) throw Error('Reward evidence is temporarily unavailable.');
      return r.json();
    },
    refetchInterval: 30000,
  });
  const mine = useQuery({
    queryKey: ['reward-allocations', user?.id],
    queryFn: api.rewardAllocations,
    enabled: Boolean(user),
    refetchInterval: 15000,
  });
  const finalized = useQuery({ queryKey: ['hourly'], queryFn: api.hourly, refetchInterval: 15000 });
  const finalizedRoundId = finalized.data?.round.id;
  const frozen = useQuery({
    queryKey: ['frozen-reward-pool', finalizedRoundId],
    queryFn: () => api.hourlyRewardPool(finalizedRoundId!) as Promise<Pool | null>,
    enabled: Boolean(finalizedRoundId),
    refetchInterval: 15000,
  });
  const h = hourly.data;
  const payoutsEnabled =
    evidence.data?.payoutsActive === true &&
    typeof evidence.data.stop === 'string' &&
    !['ASSERTED', 'UNKNOWN', 'STATUS UNAVAILABLE'].includes(evidence.data.stop.toUpperCase());
  return (
    <div className="page rewards-page">
      <header className="page-title">
        <span className="eyebrow">FUNDING & ACCOUNTABILITY</span>
        <h1>Rewards, in the open.</h1>
        <p>
          Real creator-fee evidence, recorded allocations and payment states. Paper SOL is
          simulated; reward accounting is separate.
        </p>
      </header>
      <div className="reward-hold">
        <span className="hold-icon">Ⅱ</span>
        <div>
          <strong>
            {payoutsEnabled
              ? 'SOL payouts available'
              : evidence.data
                ? 'SOL payouts currently unavailable'
                : 'Payout status unavailable'}
          </strong>
          <p>
            {payoutsEnabled
              ? 'Winner payments are recorded below after results, funding and on-chain settlement are verified.'
              : 'Only confirmed on-chain transfers count as paid rewards. Funding observations and preliminary allocations are not payments.'}
          </p>
        </div>
        <span className="badge">{payoutsEnabled ? 'PAYMENTS AVAILABLE' : evidence.data ? 'PAYMENTS PAUSED' : 'STATUS UNAVAILABLE'}</span>
      </div>
      {evidence.error && (
        <p role="alert" className="error-inline">
          {errorMessage(evidence.error)}
        </p>
      )}
      <section className="reward-metrics" aria-label="Funding states">
        <Amount
          label="Observed creator fees"
          value={evidence.data?.observedCreatorFeesLamports}
          note="Recorded attribution candidates · REVIEW"
        />
        <Amount
          label="Qualified reward capital"
          value={evidence.data?.qualifiedLamports}
          note="Accepted mainnet creator-fee funding receipts"
        />
        <Amount
          label="Reserved for payouts"
          value={evidence.data?.reservedLamports}
          note="Outstanding mainnet payout principal · not paid"
        />
      </section>
      <section className="reward-pool-grid">
        <article className="panel">
          <header className="panel-head">
            <div>
              <span className="eyebrow">CURRENT UTC HOUR</span>
              <h2>Hourly allocation</h2>
            </div>
            <span className="badge">{h?.status ?? 'UNAVAILABLE'}</span>
          </header>
          {hourly.error && <p role="alert">{errorMessage(hourly.error)}</p>}
          <Amount
            label="Hourly reward pool"
            value={h?.finalHourlyPrizeLamports ?? h?.provisionalNaturalHourlyLamports}
            note="Recorded accounting only · not a payable promise"
          />
          <div className="reward-detail">
            <span>Verified fees</span>
            <b>{sol(h?.creatorFeeLamports ?? h?.verifiedCreatorFeeLamports)}</b>
            <span>Daily allocation</span>
            <b>{sol(h?.dailyAllocationLamports ?? h?.provisionalDailyAllocationLamports)}</b>
            <span>Platform share · 10%</span>
            <b>{sol(h?.platformAllocationLamports)}</b>
            <span>Buffer contribution</span>
            <b>{sol(h?.explicitBufferContributionLamports)}</b>
            <span>Buffer balance</span>
            <b>{sol(h?.endingBufferLamports)}</b>
          </div>
          {h?.startsAt && (
            <p className="table-note">
              {new Date(h.startsAt).toUTCString()} ·{' '}
              {h.allocationMode ?? 'Mode not exposed by provisional API'}
            </p>
          )}
        </article>
        <article className="panel">
          <header className="panel-head">
            <div>
              <span className="eyebrow">CURRENT UTC DAY</span>
              <h2>Daily Championship</h2>
            </div>
            <span className="badge">{daily.data?.status ?? 'UNAVAILABLE'}</span>
          </header>
          {daily.error && <p role="alert">{errorMessage(daily.error)}</p>}
          <Amount
            label="Accumulated daily allocation"
            value={daily.data?.accumulatedLamports}
            note="Frozen contributions + provisional contribution"
          />
          <div className="reward-model">
            <h3>90% players. 10% platform.</h3>
            <p>Normal: 63% hourly / 27% daily / 10% platform.</p>
            <p>Buffer accumulation: 58% hourly / 5% buffer / 27% daily / 10% platform.</p>
            <p>
              Displayed amounts come from the API. Unexposed amounts stay unavailable. Buffer
              support depends on available recorded funds.
            </p>
          </div>
        </article>
      </section>
      <section className="panel evidence-panel">
        <header className="panel-head">
          <div>
            <span className="eyebrow">MOST RECENT FINALIZED ROUND / ACCOUNTING SNAPSHOT</span>
            <h2>Allocation &amp; buffer detail</h2>
          </div>
          <span className="badge">{frozen.data?.status ?? 'UNAVAILABLE'}</span>
        </header>
        {frozen.error && (
          <p role="alert" className="table-note">
            {errorMessage(frozen.error)}
          </p>
        )}
        <p className="table-note">
          {finalized.data
            ? `${new Date(finalized.data.round.starts_at).toUTCString()} · ${frozen.data?.allocationMode ?? 'Mode unavailable'}`
            : 'No finalized reward accounting available.'}{' '}
          · Recorded allocations do not establish qualification or payment.
        </p>
        <div className="reward-metrics">
          <Amount
            label="Hourly allocation"
            value={frozen.data?.finalHourlyPrizeLamports}
            note="After recorded buffer smoothing"
          />
          <Amount
            label="Daily allocation"
            value={frozen.data?.dailyAllocationLamports}
            note="Contribution for the recorded UTC hour"
          />
          <Amount
            label="Platform allocation · 10%"
            value={frozen.data?.platformAllocationLamports}
            note="Separate from player rewards"
          />
        </div>
        <div className="reward-detail">
          <span>Explicit buffer contribution</span>
          <b>{sol(frozen.data?.explicitBufferContributionLamports)}</b>
          <span>Ending reward buffer</span>
          <b>{sol(frozen.data?.endingBufferLamports)}</b>
          <span>Recorded split (hourly / daily / buffer / platform)</span>
          <b>
            {frozen.data?.splitRatesBps
              ? Object.values(frozen.data.splitRatesBps)
                  .map((value) => `${BigInt(value) / 100n}%`)
                  .join(' / ')
              : 'Unavailable'}
          </b>
        </div>
      </section>
      <section className="panel evidence-panel">
        <header className="panel-head">
          <div>
            <span className="eyebrow">CHAIN EVIDENCE / NOT WINNER PAYMENTS</span>
            <h2>Creator-fee observations</h2>
          </div>
          <span className="badge">REVIEW</span>
        </header>
        <p className="table-note">
          Bounded latest evidence snapshot; not a complete fee ledger. Observation links are
          provided for inspection and do not establish accepted reward capital.
        </p>
        {evidence.data?.fundingObservedAt && (
          <p className="table-note">
            Funding evidence captured {new Date(evidence.data.fundingObservedAt).toUTCString()}.
            Snapshots can be stale; refresh checks for newer evidence.
          </p>
        )}
        {evidence.data?.claimReceipt && (
          <div className="claim-receipt">
            <div>
              <strong>Creator-fee claim receipt · {evidence.data.claimReceipt.commitment}</strong>
              <p>
                {sol(evidence.data.claimReceipt.grossLamports)} gross · REVIEW · Not a winner payout
              </p>
            </div>
            <TxLink signature={evidence.data.claimReceipt.signature} />
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Event time (UTC)</th>
                <th>Observed fee (SOL)</th>
                <th>Status</th>
                <th>Transaction / event</th>
              </tr>
            </thead>
            <tbody>
              {evidence.data?.observations.map((row, i) => (
                <tr key={`${row.signature}-${row.eventIndex}-${i}`}>
                  <td>{row.eventTime ? new Date(row.eventTime).toUTCString() : 'Unavailable'}</td>
                  <td>{sol(row.lamports)}</td>
                  <td>
                    <span className="review-label">OBSERVED · REVIEW</span>
                  </td>
                  <td>
                    {row.signature ? <TxLink signature={row.signature} /> : 'Unavailable'} /{' '}
                    {row.eventIndex ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!evidence.data?.observations.length && (
          <div className="empty">
            <h3>No observation evidence available</h3>
            <p>No estimated fees are substituted.</p>
          </div>
        )}
      </section>
      <section className="panel evidence-panel">
        <header className="panel-head">
          <div>
            <span className="eyebrow">YOUR WALLET / RECORDED ALLOCATIONS</span>
            <h2>Reward allocations</h2>
          </div>
        </header>
        {!user ? (
          <div className="empty">
            <h3>Sign in to view your allocations</h3>
            <p>Connect your wallet and sign the authentication message.</p>
          </div>
        ) : mine.error ? (
          <p role="alert">{errorMessage(mine.error)}</p>
        ) : mine.isLoading ? (
          <p className="table-note">Loading your allocations…</p>
        ) : mine.data?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Competition</th>
                  <th>Source</th>
                  <th>Rank</th>
                  <th>Allocation (SOL)</th>
                  <th>Recorded status</th>
                </tr>
              </thead>
              <tbody>
                {mine.data.map((row) => (
                  <tr key={row.payoutPlanId}>
                    <td>{row.competitionType}</td>
                    <td>{row.hourlyRoundId ?? row.dailyCompetitionId}</td>
                    <td>
                      #{row.competitiveRank}
                      {row.tied ? ' · TIE' : ''}
                    </td>
                    <td>{sol(row.rewardAllocationLamports)}</td>
                    <td>
                      {row.status} / {row.payoutPlanState}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>No recorded allocations</h3>
            <p>A leaderboard result alone does not establish a reward.</p>
          </div>
        )}
      </section>
      <section className="panel evidence-panel">
        <header className="panel-head">
          <div>
            <span className="eyebrow">VERIFIED PAYMENTS ONLY</span>
            <h2>Payout history</h2>
          </div>
        </header>
        <>
          {evidence.data?.payoutHistory.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Verified at (UTC)</th>
                    <th>Paid principal (SOL)</th>
                    <th>Status</th>
                    <th>On-chain payment</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.data.payoutHistory.map((row) => (
                    <tr key={row.signature}>
                      <td>{new Date(row.verifiedAt).toUTCString()}</td>
                      <td>{sol(row.lamports)}</td>
                      <td>VERIFIED · PAID</td>
                      <td>
                        <TxLink signature={row.signature} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <h3>
                {evidence.data?.payoutHistoryStatus === 'NO_RECORDED_PAYOUTS'
                  ? 'No recorded winner payouts'
                  : 'Verified payout receipts unavailable'}
              </h3>
              <p>
                Signed transactions, broadcasts and creator-fee claims are not verified winner
                payments. No fictional payments are displayed.
              </p>
            </div>
          )}
        </>
        {evidence.data?.paymentStateObservedAt && (
          <p className="table-note">
            Payment state read: {new Date(evidence.data.paymentStateObservedAt).toUTCString()}.
          </p>
        )}
      </section>
    </div>
  );
}
