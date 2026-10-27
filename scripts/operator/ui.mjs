/* global document, location, history */
import { initPublicPaper } from './paper-ui.mjs';
let feeObservedAt = 0,
  claimExpiry = null,
  claimReview = null,
  developerTransferReview = null,
  rewardPlans = [],
  automationState = null;
const el = (id) => document.getElementById(id),
  show = (id, value) => {
    el(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  };
async function request(path, data) {
  const r = await fetch(
      path,
      data === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(data),
          },
    ),
    v = await r.json();
  if (!r.ok) throw Error([v.error, v.action, v.evidence?.file].filter(Boolean).join(' • '));
  return v;
}
async function refresh() {
  const evidence=await request('/api/round-evidence').catch(()=>({qualification:'REVIEW',missing:['EVIDENCE_STATUS_UNAVAILABLE']}));show('round-evidence',evidence);
  const s = await request('/api/status');
  show('system', {
    observedAt: s.observedAt,
    services: s.services,
    worker: s.worker,
    docker: s.docker,
    financial: s.financial,
  });
  renderStatus(s);
  renderRewards(await request('/api/reward-overview').catch(() => null));
  renderAutomation(await request('/api/automation').catch(() => null));
  const c = await request('/api/claim-review');
  if (c.latest) renderClaim(c.latest);
  const transfer=await request('/api/developer-transfer').catch(()=>null);if(transfer?.latest)renderDeveloperTransfer(transfer.latest);if(transfer)show('developer-transfer-result',{request:transfer.request,native:transfer.native??transfer.request,error:transfer.request?.phase==='FAILED'?transfer.request.error:transfer.native?.phase==='FAILED'?transfer.native.error:null,execution:transfer.execution?.result,recovery:transfer.recovery?.result});
  show('claim-result',{nativeWindow:c.nativeLaunch??null,execution:c.manualResult?.result??null,error:(!c.nativeLaunch||Date.parse(c.manualError?.at??'')>=Date.parse(c.nativeLaunch.at))?(c.manualError??null):null});
  if (c.signer)
    show(
      'claim-signer',
      'Read-only isolated wallet check: ' +
        c.signer.result.wallet +
        ' | DPAPI: ' +
        (c.signer.result.dpapiAvailable ? 'available' : 'unavailable') +
        ' | No signing performed by this check. Execution status appears below.',
    );
  if (s.fees?.lastSuccessfulObservation) renderFees(s.fees.lastSuccessfulObservation);
  show(
    'monitor',
    s.fees
      ? {
          status: s.fees.status,
          heartbeatAt: s.fees.heartbeatAt,
          lastCheckedAt: s.fees.lastCheckedAt,
          lastSuccessfulObservationAt: s.fees.lastSuccessfulObservationAt,
          nextObservationAt: s.fees.nextObservationAt,
          lastError: s.fees.lastError,
          mode: s.fees.mode,
          automaticClaiming: s.fees.automaticClaiming,
        }
      : { status: 'NOT_RUNNING' },
  );
  const d = s.database;
  show('wallet', 'Selected treasury: GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW • mainnet-beta');
  show('treasury', {
    databaseHealthy: d.healthy,
    receivedCreatorFeeLamports: d.verifiedReceivedCreatorFeeLamports,
    reservedPrincipalLamports: d.reservedPrincipalLamports,
    reservedFeeLamports: d.reservedFeeLamports,
    unpaidPlanLamports: d.unpaidPlanLamports,
    remainingApprovedBudgetLamports: d.remainingApprovedPayoutBudgetLamports,
    reservationCoverage: d.reservationCoverage,
    databaseStop: d.stop,
    databaseRole: d.roleRestriction,
  });
  show('competitions', { hours: d.rounds, days: d.days, reviews: d.reviews, plans: d.plans });
}
async function act(id, fn) {
  const b = el(id);
  b.disabled = true;
  show('session', b.textContent + ' — checking…');
  try {
    await fn();
    show(
      'session',
      b.textContent +
        ' — completed at ' +
        new Date().toISOString() +
        '. Check persisted authorization and transaction status below.',
    );
  } catch (e) {
    show('session', e.message);
  } finally {
    b.disabled = false;
  }
}
el('refresh').onclick = () => act('refresh', refresh);
el('discover').onclick = () =>
  act('discover', async () => renderFees(await request('/api/discover', {})));
el('claim').onclick = () =>
  act('claim', async () => renderClaim(await request('/api/claim-plan', {})));
el('review').onclick = () =>
  act('review', async () =>
    show('payout', await request('/api/review', { planId: el('plan').value })),
  );
function renderDeveloperTransfer(envelope){developerTransferReview=envelope;const r=envelope.review;metrics('developer-transfer-summary',[['Network',r.network],['Sender',r.sender],['Recipient',r.recipient],['Developer receipt',sol(r.recipientLamports)],['Transfer fee / maximum',sol(r.maximumFeeLamports)],['New sender debit',sol(r.totalDebitLamports)],['Prior claim fee',sol(r.claimFeeLamports)],['Platform total / ceiling',sol(r.totalPlatformCostLamports)+' / '+sol(r.platformAllocationLamports)],['Simulation',r.simulation.exactDeltasVerified?'Exact deltas verified':'BLOCKED'],['Message SHA256',r.messageSha256],['Authority','NONE — separate local YES required']]);updateDeveloperTransferExpiry();}
function updateDeveloperTransferExpiry(){const r=developerTransferReview?.review,valid=r?.readyForApproval&&Date.now()<Date.parse(r.expiresAt);el('developer-transfer-authorize').disabled=!valid;if(r)show('developer-transfer-expiry',(valid?'Review expires UTC: ':'EXPIRED — prepare again. Previous expiry UTC: ')+r.expiresAt);}
setInterval(updateDeveloperTransferExpiry,1000);
el('developer-transfer-prepare').onclick=()=>act('developer-transfer-prepare',async()=>renderDeveloperTransfer(await request('/api/developer-transfer/prepare',{})));
el('developer-transfer-authorize').onclick=()=>act('developer-transfer-authorize',async()=>{const r=developerTransferReview;show('developer-transfer-result','Opening protected Windows confirmation…');try{show('developer-transfer-result',await request('/api/developer-transfer/authorize',{reviewSha256:r.reviewSha256,messageSha256:r.review.messageSha256}));}catch(e){show('developer-transfer-result',{status:'NATIVE_LAUNCH_FAILED',error:e.message});throw e;}});
el('developer-transfer-reconcile').onclick=()=>act('developer-transfer-reconcile',async()=>show('developer-transfer-result',await request('/api/developer-transfer/reconcile',{})));

try {
  const token = location.hash.slice(1);
  history.replaceState(null, '', '/');
  if (token) await request('/session', { token });
  await initPublicPaper(request);
  await refresh();
  show('session', 'Direct loopback session. No financial authorization granted.');
} catch (e) {
  show('session', e.message);
}

function sol(value) {
  if (value === null || value === undefined) return 'Unavailable';
  const n = BigInt(value),
    fraction = (n % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '');
  return (n / 1000000000n).toString() + (fraction ? '.' + fraction : '') + ' SOL';
}
function metrics(id, rows) {
  const parent = el(id);
  parent.replaceChildren();
  for (const [label, value] of rows) {
    const card = document.createElement('div'),
      small = document.createElement('small'),
      strong = document.createElement('strong');
    card.className = 'metric';
    small.textContent = label;
    strong.textContent = value;
    card.append(small, strong);
    parent.append(card);
  }
}
function renderStatus(s) {
  const d = s.database,
    good = (x) => (x?.healthy ? 'Ready' : 'Unavailable / inspect');
  metrics('system-summary', [
    ['API', good(s.services.api)],
    ['Website', good(s.services.website)],
    ['PostgreSQL', good(d)],
    ['Redis', good(s.services.redis)],
    ['Settlement worker', good(s.worker)],
    [
      'Public tunnel endpoints',
      s.services.publicApi?.healthy && s.services.publicWebsite?.healthy
        ? 'Reachable'
        : 'Unavailable',
    ],
    ['UTC qualification', 'UNQUALIFIED'],
    ['Provider authority', 'UNQUALIFIED'],
    ['Financial operations', 'STOPPED'],
    ['Clock (UTC)', s.observedAt],
  ]);
  metrics('treasury-summary', [
    ['Verified received creator fees', sol(d.verifiedReceivedCreatorFeeLamports)],
    ['Unpaid plan obligations', sol(d.unpaidPlanLamports)],
    ['Unpaid rewards & buffer ownership', sol(d.unpaidRewardsAndBufferLamports)],
    ['Reserved principal', sol(d.reservedPrincipalLamports)],
    ['Reserved network fees', sol(d.reservedFeeLamports)],
    ['Approved budget remaining', sol(d.remainingApprovedPayoutBudgetLamports)],
    [
      'Database STOP control',
      d.stop?.stopped === null ? 'Not deployed' : d.stop?.stopped ? 'Asserted' : 'Released',
    ],
  ]);
  const parent = el('round-summary');
  parent.replaceChildren();
  for (const r of (d.rounds ?? []).slice(0, 4)) {
    const line = document.createElement('div');
    line.className = 'round-row';
    line.textContent = r.id + ' • ' + r.state;
    parent.append(line);
  }
  const line = document.createElement('p');
  line.textContent =
    'REVIEW evidence is financially unqualified. ' +
    (d.reviews?.length ?? 0) +
    ' recorded source holds. ' +
    (d.plans?.length ?? 0) +
    ' recent payout plans.';
  parent.append(line);
}
function renderFees(d) {
  if (Date.parse(d.observedAt) < feeObservedAt) return;
  feeObservedAt = Date.parse(d.observedAt);
  show('fees', d);
  metrics('fee-summary', [
    ['Selected wallet balance', sol(d.walletBalanceLamports)],
    ['Claimable creator-vault excess', sol(d.claimableBondingExcessLamports)],
    ['Claimable AMM WSOL', sol(d.claimableAmmWsolLamports)],
    ['Vault rent (excluded)', sol(d.rentLamports)],
    [
      'Recognized received creator claims',
      sol(d.received?.recognizedCreatorAggregateReceivedLamports),
    ],
    ['Creator fee rate', d.creatorFeeBps + ' bps'],
    ['Creator authority', d.authorityMatches ? 'Matches selected wallet' : 'REVIEW'],
    ['Finalized observation (UTC)', d.observedAt],
    ['Fee scope', 'Creator aggregate; token attribution requires REVIEW'],
    [
      'Receipt source status',
      d.received?.error?.code ?? d.received?.historyCoverage ?? 'Unchecked',
    ],
  ]);
}

setInterval(
  () => refresh().catch((e) => show('monitor', { status: 'REFRESH_FAILED', error: e.message })),
  15000,
);

function renderClaim(envelope) {
  const r = envelope.review;
  claimReview=envelope;
  claimExpiry = r.expiresAt;
  renderFees(r.finalizedObservation);
  metrics('claim-summary', [
    ['Network', r.network],
    ['Creator / fee payer / recipient', r.wallet],
    ['Instruction', r.instruction],
    ['Expected gross', sol(r.expectedGrossLamports)],
    ['Maximum fee', sol(r.maximumFeeLamports)],
    ['Minimum net', sol(r.minimumNetLamports)],
    ['Fee funding', r.feeFundingSufficient ? 'Sufficient' : 'INSUFFICIENT'],
    [
      'Simulation',
      r.simulation.error === null && r.simulation.grossVerified
        ? 'SUCCESS — balances verified'
        : 'BLOCKED',
    ],
    ['Message SHA256', r.messageSha256],
    ['Transaction signature', 'None — unsigned'],
    ['Authority', 'NONE — execution blocked'],
  ]);
  show('claim-detail', envelope);
  updateClaimExpiry();
}
function updateClaimExpiry() {
  if (!claimExpiry) return;
  const remaining = Math.floor((Date.parse(claimExpiry) - Date.now()) / 1000);
  el('manual-claim').disabled=!(remaining>0&&claimReview?.review?.readyForApproval);
  el('manual-claim-test').disabled=el('manual-claim').disabled;
  show(
    'claim-expiry',
    remaining > 0
      ? 'Review expires in ' +
          remaining +
          ' seconds (' +
          claimExpiry +
          '). Block-height expiry also applies.'
      : 'EXPIRED — click Prepare & simulate creator claim before requesting exact approval.',
  );
}
setInterval(updateClaimExpiry, 1000);

function table(id, headers, rows) {
  const parent = el(id);
  parent.replaceChildren();
  const t = document.createElement('table'),
    head = document.createElement('tr');
  for (const label of headers) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  t.append(head);
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const value of row) {
      const td = document.createElement('td');
      td.textContent = String(value ?? 'Unavailable');
      tr.append(td);
    }
    t.append(tr);
  }
  parent.append(t);
}

function renderSelectedReward() {
  const p = rewardPlans.find((p) => p.id === el('reward-plan').value);
  if (!p) return;
  el('plan').value = p.id;
  metrics('reward-plan-summary', [
    ['State', p.state + ' / ' + (p.qualified ? 'ACCEPTED' : 'REVIEW')],
    ['Exact budget', sol(p.prizeLamports)],
    ['Allocation math', p.mathValid ? 'PASS' : 'BLOCKED'],
    ['Approval', p.approval ? 'Recorded; current qualification still required' : 'NONE'],
    ['Review hash (not authority)', p.reviewSha256],
  ]);
  table(
    'reward-recipients',
    ['Rank / tie size', 'Pinned winning wallet', 'Exact SOL allocation'],
    p.recipients.map((r) => [r.rank + ' / ' + r.tieSize, r.wallet, sol(r.lamports)]),
  );
}
function renderRewards(r) {
  if (!r?.summary) return;
  metrics('reward-summary', [
    ['Account ledgers', r.summary.accountsReconciled + ' / ' + r.summary.accounts],
    ['Fill replay', r.replay ? r.replay.matched + ' / ' + r.replay.total : 'Pending'],
    ['Hourly / daily results', r.summary.hourlyResults + ' / ' + r.summary.dailyResults],
    ['Exact allocation plans', r.summary.exactAllocationPlans + ' / ' + r.summary.plans],
    ['Real financially accepted', String(r.summary.qualifiedRealCompetitions)],
    [
      'Verified token-attributed received capital',
      sol(r.provider?.receivedTokenAttributedLamports),
    ],
    ['UTC observation', r.clock?.status ?? 'Not running'],
    ['Devnet funding shortfall', sol(r.devnet?.fundingShortfallLamports)],
  ]);
  table(
    'reward-competitions',
    [
      'Competition / UTC window',
      'Displayed state',
      'Financial status',
      'Historical unbound forced fills',
    ],
    r.competitions
      .slice(0, 16)
      .map((c) => [c.id, c.state, c.qualification, c.unboundForcedFills ?? '—']),
  );
  const selected = el('reward-plan').value;
  rewardPlans = r.plans ?? [];
  el('reward-plan').replaceChildren();
  for (const p of rewardPlans) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent =
      p.type + ' | ' + p.sourceId + ' | ' + p.state + ' | ' + (p.qualified ? 'ACCEPTED' : 'REVIEW');
    el('reward-plan').append(o);
  }
  if (rewardPlans.some((p) => p.id === selected)) el('reward-plan').value = selected;
  renderSelectedReward();
  show('reward-evidence', {
    observedAt: r.observedAt,
    provider: r.provider,
    utc: r.clock
      ? {
          status: r.clock.status,
          startedAt: r.clock.startedAt,
          observedAt: r.clock.observedAt,
          samples: r.clock.samples,
          probeErrors: r.clock.probeErrors,
          qualification: r.clock.qualification,
          missing: r.clock.missing,
        }
      : null,
    devnet: r.devnet,
    executions: r.executions,
    finalizedSignatures: r.signatures,
    tests: r.tests,
  });
}
el('reward-plan').onchange = renderSelectedReward;
el('reward-refresh').onclick = () =>
  act('reward-refresh', async () => renderRewards(await request('/api/reward-refresh', {})));

function renderAutomation(a) {
  if (!a) return;
  automationState = a;
  metrics('automation-summary', [
    [
      'Protected service',
      a.protectedService === 'NOT_ENROLLED'
        ? 'Setup required'
        : a.protectedService === 'RUNNING'
          ? 'Running'
          : 'Offline / stale',
    ],
    [
      'Schedule',
      (a.schedulerMode === 'OBSERVATION_ONLY_NO_SIGNING'
        ? 'Read-only checks'
        : 'Policy controlled') +
        ' / ' +
        a.schedule,
    ],
    ['Next scheduled check (UTC)', a.nextClaimAt],
    ['Auto claim', a.settings.claims ? 'ON' : 'OFF'],
    ['Hourly rewards', a.settings.hourly ? 'ON' : 'OFF'],
    ['Daily rewards', a.settings.daily ? 'ON' : 'OFF'],
    ['Claimable fees (observation)', sol(a.claimableLamports)],
    ['Verified received token capital', sol(a.receivedTokenAttributedLamports)],
    ['Available qualified rewards', sol(a.availableRewardLamports)],
    ['Reserved principal', sol(a.reservedPrincipalLamports)],
    ['Last finalized claim', a.service?.lastSuccessfulClaim?.receipt?.signature ?? 'NONE'],
    ['Pending / uncertain', a.service?.unresolved ?? 0],
    ['Paid competitions', a.paid.length],
    ['UTC qualification', a.qualification.utc],
    ['Provider qualification', a.qualification.provider],
    [
      'Mainnet payout backend',
      a.qualification.mainnetPayoutAcceptance === 'ACCEPTED'
        ? 'Qualified'
        : 'Blocked — review evidence',
    ],
    [
      'Financial STOP',
      a.qualification.stop?.stopped === false
        ? 'RELEASED'
        : a.qualification.stop?.stopped === true
          ? 'ASSERTED'
          : 'UNKNOWN — signing blocked',
    ],
  ]);
  for (const [id, key, label] of [
    ['automation-claims', 'claims', 'Auto Claim Fees'],
    ['automation-hourly', 'hourly', 'Hourly Rewards'],
    ['automation-daily', 'daily', 'Daily Rewards'],
  ])
    el(id).textContent = label + ' — ' + (a.settings[key] ? 'ON' : 'OFF');
  show('automation-detail', {
    policy: a.policy,
    blockers: a.blockers,
    qualification: a.qualification,
    queue: a.queue.map((p) => ({
      id: p.id,
      type: p.type,
      state: p.state,
      qualified: p.qualified,
      recipients: p.recipients,
      blockers: p.blockers,
    })),
    observer: a.observer,
    requests: a.service?.requests ?? [],
  });
  const target = el('automation-history');
  target.replaceChildren();
  for (const j of a.service?.jobs ?? []) {
    const row = document.createElement('p');
    row.textContent = j.kind + ' | ' + j.state + ' | ' + (j.error ?? '');
    if (j.signature) {
      const link = document.createElement('a');
      link.href = 'https://explorer.solana.com/tx/' + encodeURIComponent(j.signature);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = j.signature;
      row.append(' ', link);
    }
    target.append(row);
  }
}
async function automationAction(action) {
  const result = await request('/api/automation/control', { action });
  show('automation-action', result);
  renderAutomation(await request('/api/automation'));
}
for (const [id, key] of [
  ['automation-claims', 'claims'],
  ['automation-hourly', 'hourly'],
  ['automation-daily', 'daily'],
])
  el(id).onclick = () =>
    act(id, () => automationAction(key + ':' + (automationState?.settings[key] ? 'off' : 'on')));
el('automation-claim-now').onclick = () =>
  act('automation-claim-now', () => automationAction('claim-now'));
el('automation-stop').onclick = () => act('automation-stop', () => automationAction('STOP'));
el('automation-reconcile').onclick = () =>
  act('automation-reconcile', () => automationAction('reconcile'));
el('automation-draft').onclick = () =>
  act('automation-draft', async () =>
    show('automation-action', await request('/api/automation/draft', {})),
  );
setInterval(
  () =>
    request('/api/automation')
      .then(renderAutomation)
      .catch(() => {}),
  10000,
);

el('manual-claim').onclick=()=>act('manual-claim',async()=>{const r=claimReview.review;show('claim-result',await request('/api/manual-claim',{reviewSha256:claimReview.reviewSha256,messageSha256:r.messageSha256}));});

el('manual-claim-test').onclick=()=>act('manual-claim-test',async()=>{const r=claimReview.review;show('claim-result',await request('/api/manual-claim',{reviewSha256:claimReview.reviewSha256,messageSha256:r.messageSha256,mode:'read-only-test'}));});


let winnerTestReview=null;
function renderWinnerTest(r){winnerTestReview=r.review?r:null;show('winner-test-result',r);el('winner-test-authorize').disabled=!(r.review&&Date.now()<Date.parse(r.review.expiresAt));}
el('winner-test-prepare').onclick=()=>act('winner-test-prepare',async()=>renderWinnerTest(await request('/api/winner-test/prepare',{})));
el('winner-test-authorize').onclick=()=>act('winner-test-authorize',async()=>show('winner-test-result',await request('/api/winner-test/authorize',{reviewSha256:winnerTestReview.reviewSha256,messageSha256:winnerTestReview.review.messageSha256})));
el('winner-test-reconcile').onclick=()=>act('winner-test-reconcile',async()=>show('winner-test-result',await request('/api/winner-test/reconcile',{})));
request('/api/winner-test').then(renderWinnerTest).catch(()=>{});
setInterval(()=>{if(winnerTestReview)el('winner-test-authorize').disabled=Date.now()>=Date.parse(winnerTestReview.review.expiresAt);},1000);

setInterval(()=>request('/api/winner-test').then(renderWinnerTest).catch(()=>{}),10000);
