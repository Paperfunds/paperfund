/** Normal settlement hooks backed by immutable current-bank seals. No payout/source authority. */
import type { PoolClient } from 'pg';
import { identifier } from '@paperfund/core';
import {
  createMarketStateEvidence,
  type ExecutionRouter,
  type MarketIdentity,
  type MarketStateEvidence,
} from '@paperfund/execution';
import {
  cutoffHash,
  verifyCutoffCapture,
  verifyDurableQuoteCutoff,
  withGenericAccount,
  withGenericSystemRead,
  type CurrentCutoffCapture,
  type CutoffHeader,
} from '@paperfund/protocols';
import { planCutoffLiquidation, type CutoffLiquidationStep } from '@paperfund/execution';
import type { DatabaseService, PersistedSettlementRequest } from './database.js';
import { FinancialServiceError } from './financial-service.js';
import { currentQuoteHourlyProof } from './current-quote-proof.js';
function fail(reason: string): never {
  throw new FinancialServiceError('SETTLEMENT_REVIEW', 'CURRENT_CUTOFF_' + reason);
}
const json = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
function evidence(v: MarketStateEvidence): MarketStateEvidence {
  return { ...v, chainSlot: v.chainSlot === null ? null : BigInt(v.chainSlot) };
}
interface Seal {
  cutoff: string;
  captureHash: string;
  last: CutoffHeader;
  next: CutoffHeader | null;
  steps: CutoffLiquidationStep[];
}
export interface CurrentCutoffProvider {
  capture(identity: MarketIdentity, accountId: string): Promise<CurrentCutoffCapture>;
  frontier(slot: number, cutoff: Date): Promise<{ last: CutoffHeader; next: CutoffHeader }>;
  finality?(slot: number): Promise<CutoffHeader>;
}
export class CurrentQuoteSettlement {
  constructor(
    readonly base: DatabaseService,
    readonly router: ExecutionRouter,
    readonly policyId: string,
    readonly provider: CurrentCutoffProvider,
  ) {}
  private async policy(roundId: string, client: Pick<PoolClient, 'query'> = this.base.pool) {
    const r = (
      await client.query(
        `select r.*,p.id policy_id,to_jsonb(p) settlement_policy from hourly_rounds r join current_quote_settlement_policies p on p.id=$2
   and r.starts_at>=p.effective_from and r.starts_at<p.ends_before and p.recorded_at<r.starts_at where r.id=$1`,
        [roundId, this.policyId],
      )
    ).rows[0];
    if (!r) fail('FUTURE_POLICY_REQUIRED');
    if (
      (
        await client.query('select 1 from legacy_source_reviews where hourly_round_id=$1 limit 1', [
          roundId,
        ])
      ).rows.length
    )
      fail('HISTORICAL_REVIEW_PRESERVED');
    return {
      ...r,
      ...Object.fromEntries(
        ['selection_version', 'max_age_ms', 'uncertainty_ms', 'provider_id'].map((k) => [
          k,
          r.settlement_policy[k],
        ]),
      ),
    };
  }
  async captureDue(now: Date) {
    const positions = (
      await this.base.pool.query(
        `select p.id,p.competition_account_id,p.market_id,m.venue,b.mint_address,a.hourly_round_id
   from positions p join competition_accounts a on a.id=p.competition_account_id join hourly_rounds r on r.id=a.hourly_round_id
   join current_quote_settlement_policies q on q.id=$1 and q.recorded_at<r.starts_at and r.starts_at>=q.effective_from and r.starts_at<q.ends_before
   join markets m on m.id=p.market_id join assets b on b.id=p.asset_id
   where p.status='OPEN' and r.state in('OPEN','CLOSING','SETTLING') and r.ends_at_exclusive>$2::timestamptz-interval '15 seconds'
    and r.ends_at_exclusive<=$2::timestamptz+interval '20 seconds' order by p.id`,
        [this.policyId, now],
      )
    ).rows;
    const failures: string[] = [];
    // Bounded per-account positions already obey the five-token rule. No quote cache is used.
    for (let i = 0; i < positions.length; i += 3)
      await Promise.all(
        positions.slice(i, i + 3).map(async (p) => {
          try {
            const policy = await this.policy(p.hourly_round_id);
            const identity: MarketIdentity = {
              protocolId: identifier(p.venue, 'ProtocolId'),
              marketId: identifier(p.market_id, 'MarketId'),
              tokenMint: identifier(p.mint_address, 'TokenMint'),
            };
            const c = await withGenericSystemRead(() =>
              withGenericAccount(p.competition_account_id, () =>
                this.provider.capture(identity, p.competition_account_id),
              ),
            );
            if (
              c.evidence.identity.tokenMint !== identity.tokenMint ||
              createMarketStateEvidence(c.evidence).fingerprint !== c.evidence.fingerprint
            )
              fail('CAPTURE_IDENTITY');
            const id = 'current-capture:' + cutoffHash([p.id, c.hash]);
            await this.base.pool.query(
              `insert into current_quote_cutoff_captures(id,position_id,round_id,policy_id,slot,bank_time,document)
    values($1,$2,$3,$4,$5,$6,$7::jsonb) on conflict(position_id,slot) do nothing`,
              [
                id,
                p.id,
                p.hourly_round_id,
                this.policyId,
                c.evidence.chainSlot,
                c.bankTime,
                json(c),
              ],
            );
            const old = (
              await this.base.pool.query(
                'select document from current_quote_cutoff_captures where position_id=$1 and slot=$2',
                [p.id, c.evidence.chainSlot],
              )
            ).rows[0];
            if (old?.document.evidence.fingerprint !== c.evidence.fingerprint)
              fail('SAME_BANK_CONFLICT');
            if (policy.selection_version === 'DURABLE_QUOTE_V2') {
              const prior = (
                await this.base.pool.query(
                  'select max(slot)::text slot from current_quote_cutoff_captures where position_id=$1',
                  [p.id],
                )
              ).rows[0]?.slot;
              if (prior && BigInt(prior) > c.evidence.chainSlot!)
                fail('PROVIDER_CURSOR_REGRESSION');
              await this.base.pool.query('select certify_current_quote_capture($1)', [
                old ? 'current-capture:' + cutoffHash([p.id, old.document.hash]) : id,
              ]);
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : 'CURRENT_CUTOFF_CAPTURE_FAILED';
            failures.push(message);
            if (/SAME_BANK_CONFLICT|CURSOR_REGRESSION|CAPTURE_IDENTITY/.test(message)) {
              const present = (
                await this.base.pool.query(
                  "select to_regclass('public.current_quote_capture_faults') present",
                )
              ).rows[0]?.present;
              if (present)
                await this.base.pool.query(
                  'insert into current_quote_capture_faults(round_id,position_id,reason) values($1,$2,$3)',
                  [p.hourly_round_id, p.id, message],
                );
            }
          }
        }),
      );
    return { positions: positions.length, failures };
  }
  async prepareRound(roundId: string, cutoff: Date) {
    const enrolled = (
      await this.base.pool.query(
        `select 1 from hourly_rounds r join current_quote_settlement_policies p on p.id=$2 and r.starts_at>=p.effective_from and r.starts_at<p.ends_before and p.recorded_at<r.starts_at where r.id=$1`,
        [roundId, this.policyId],
      )
    ).rows.length;
    if (!enrolled) {
      const held = (
        await this.base.pool.query(
          `select 1 from legacy_source_reviews where hourly_round_id=$1 union all select 1 from fills f join orders o on o.id=f.order_id join competition_accounts a on a.id=o.competition_account_id where a.hourly_round_id=$1 limit 1`,
          [roundId],
        )
      ).rows.length;
      if (held) fail('FUTURE_POLICY_REQUIRED');
      await this.base.prepareMarketSettlement?.(roundId, cutoff);
      return;
    }
    const round = await this.policy(roundId);
    if (
      round.selection_version === 'DURABLE_QUOTE_V2' &&
      (
        await this.base.pool.query(
          'select 1 from current_quote_capture_faults where round_id=$1 limit 1',
          [roundId],
        )
      ).rows.length
    )
      fail('CAPTURE_INTEGRITY_REVIEW');
    if (
      !['CLOSING', 'SETTLING'].includes(round.state) ||
      +new Date(round.ends_at_exclusive) !== +cutoff
    )
      fail('ROUND_STATE');
    const db = this.database();
    const proof = await currentQuoteHourlyProof(db, this.router, roundId);
    if (proof.technicalReasons.some((r) => r !== 'RETAINED_CUTOFF_EXIT_EVIDENCE_REQUIRED'))
      fail('ACCOUNT_OR_FILL_QUALIFICATION');
    const positions = (
      await this.base.pool.query(
        `select p.*,m.venue,b.mint_address from positions p join competition_accounts a on a.id=p.competition_account_id
   join markets m on m.id=p.market_id join assets b on b.id=p.asset_id where a.hourly_round_id=$1 and p.status='OPEN' order by p.id`,
        [roundId],
      )
    ).rows;
    for (const p of positions) {
      if (
        (
          await this.base.pool.query(
            'select id from current_quote_cutoff_seals where position_id=$1',
            [p.id],
          )
        ).rows.length
      )
        continue;
      const captures = (
        await this.base.pool.query(
          `select * from current_quote_cutoff_captures where position_id=$1 and policy_id=$2
    and bank_time<$3 and bank_time>=$3::timestamptz-interval '10 seconds' order by recorded_at desc,id asc`,
          [p.id, this.policyId, cutoff],
        )
      ).rows;
      let selected:
        | {
            row: (typeof captures)[number];
            capture: CurrentCutoffCapture;
            last: CutoffHeader;
            next: CutoffHeader | null;
          }
        | undefined;
      for (const row of captures) {
        try {
          const c = {
            ...row.document,
            evidence: evidence(row.document.evidence),
          } as CurrentCutoffCapture;
          if (round.selection_version === 'DURABLE_QUOTE_V2') {
            const cert = (
              await this.base.pool.query(
                'select * from current_quote_capture_certificates where capture_id=$1',
                [row.id],
              )
            ).rows[0];
            if (!cert || cert.provider_id !== round.provider_id || !this.provider.finality)
              continue;
            let final = (
              await this.base.pool.query(
                'select * from current_quote_capture_finality where capture_id=$1',
                [row.id],
              )
            ).rows[0];
            if (!final) {
              const header = await this.provider.finality(Number(row.slot));
              await this.base.pool.query(
                'insert into current_quote_capture_finality(capture_id,header,provider_id) values($1,$2::jsonb,$3) on conflict do nothing',
                [row.id, json(header), round.provider_id],
              );
              final = (
                await this.base.pool.query(
                  'select * from current_quote_capture_finality where capture_id=$1',
                  [row.id],
                )
              ).rows[0];
            }
            if (final.provider_id !== round.provider_id) fail('PROVIDER_BINDING');
            verifyDurableQuoteCutoff(c, final.header, cutoff, {
              receivedAt: new Date(row.recorded_at),
              certifiedAt: new Date(cert.certified_at),
              finalizedAt: new Date(final.observed_at),
              maxAgeMs: round.max_age_ms,
              uncertaintyMs: round.uncertainty_ms,
            });
            // No fabricated adjacent-bank header is recorded for quote-based settlement.
            selected = { row, capture: c, last: final.header, next: null };
          } else {
            const f = await this.provider.frontier(Number(row.slot), cutoff);
            verifyCutoffCapture(c, f.last, f.next, cutoff);
            selected = { row, capture: c, ...f };
          }
          break;
        } catch {
          /* A different retained bank may qualify. No fresh quote substitutes for missing history. */
          if (round.selection_version === 'DURABLE_QUOTE_V2')
            throw Error('CURRENT_CUTOFF_SELECTED_QUOTE_UNQUALIFIED');
        }
      }
      if (!selected) fail('RETAINED_BOUNDARY_BANK_REQUIRED');
      if (
        round.selection_version === 'DURABLE_QUOTE_V2' &&
        (
          await this.base.pool.query(
            `select 1 from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1 and f.executed_at>$2 limit 1`,
            [p.competition_account_id, selected.row.recorded_at],
          )
        ).rows.length
      )
        fail('TRADE_AFTER_SELECTED_QUOTE');
      const latest = (
        await this.base.pool.query(
          `select max(e.chain_slot)::text slot from fills f join orders o on o.id=f.order_id
    join order_market_state_evidence l on l.order_id=o.id and l.position_id=$1 join market_state_evidence e on e.id=f.market_state_evidence_id`,
          [p.id],
        )
      ).rows[0]?.slot;
      if (
        latest !== null &&
        latest !== undefined &&
        BigInt(latest) > selected.capture.evidence.chainSlot!
      )
        fail('TRADE_AFTER_CUTOFF_BANK');
      const adapter = this.router.resolveVersion(
        selected.capture.evidence.identity.protocolId,
        selected.capture.evidence.adapterVersion,
      );
      const steps = await planCutoffLiquidation(
        adapter,
        selected.capture.evidence,
        BigInt(p.remaining_base_units),
        BigInt(p.cost_basis_lamports),
        cutoff,
      );
      const document: Seal = {
        cutoff: cutoff.toISOString(),
        captureHash: selected.capture.hash,
        last: selected.last,
        next: selected.next,
        steps,
      };
      const id = 'current-seal:' + cutoffHash([p.id, document]);
      await this.base.pool.query(
        `insert into current_quote_cutoff_seals(id,position_id,round_id,policy_id,capture_id,quantity_before,basis_before,document)
    values($1,$2,$3,$4,$5,$6,$7,$8::jsonb) on conflict(position_id) do nothing`,
        [
          id,
          p.id,
          roundId,
          this.policyId,
          selected.row.id,
          p.remaining_base_units,
          p.cost_basis_lamports,
          json(document),
        ],
      );
    }
  }
  private async next(
    input: PersistedSettlementRequest,
    client: Pick<PoolClient, 'query'> = this.base.pool,
  ) {
    await this.policy(input.roundId, client);
    const row = (
      await client.query(
        `select s.*, (select count(*)::int from current_quote_settlement_steps t where t.seal_id=s.id) cursor
   from current_quote_cutoff_seals s where s.position_id=$1 and s.round_id=$2 and s.policy_id=$3 for update of s`,
        [input.positionId, input.roundId, this.policyId],
      )
    ).rows[0];
    if (!row) fail('SEAL_REQUIRED');
    const doc = row.document as Seal;
    if ('current-seal:' + cutoffHash([input.positionId, doc]) !== row.id) fail('SEAL_CHANGED');
    const step = doc.steps[row.cursor];
    if (!step) fail('STEP_REQUIRED');
    const left = doc.steps.slice(row.cursor).reduce((n, s) => n + BigInt(s.quantity), 0n);
    if (
      left !== input.quantity ||
      BigInt(step.basisBefore) !== input.basis ||
      input.identity.tokenMint !== step.evidence.identity.tokenMint
    )
      fail('POSITION_CHANGED');
    return {
      row,
      step: { ...step, evidence: evidence(step.evidence) },
      key: 'current-cutoff:' + row.id + ':' + row.cursor,
    };
  }
  database(): DatabaseService {
    const next = this.next.bind(this),
      prepareRound = this.prepareRound.bind(this),
      base = this.base;
    return {
      ...this.base,
      prepareMarketSettlement: prepareRound,
      prepareCurrentQuoteMarketSettlement: prepareRound,
      persistedSettlementAccount: () => true,
      async preparePersistedSettlementStep(input) {
        const n = await next(input);
        return {
          quantity: BigInt(n.step.quantity),
          output: BigInt(n.step.output),
          evidence: n.step.evidence,
          idempotencyKey: n.key,
          writeoff: n.step.writeoff,
        };
      },
      async commitPersistedSettlementStep(client, input) {
        const p = (
          await client.query(
            'select p.market_id,m.venue,b.mint_address from positions p join markets m on m.id=p.market_id join assets b on b.id=p.asset_id where p.id=$1',
            [input.positionId],
          )
        ).rows[0];
        const n = await next(
          {
            accountId: input.accountId,
            roundId: input.roundId,
            positionId: input.positionId,
            quantity: input.quantityBefore,
            basis: input.basisBefore,
            identity: {
              marketId: identifier(p.market_id, 'MarketId'),
              protocolId: identifier(p.venue, 'ProtocolId'),
              tokenMint: identifier(p.mint_address, 'TokenMint'),
            },
          },
          client,
        );
        const fees = input.execution.quote.fees.reduce(
          (v, f) => v + (f.amount.asset === 'PAPER_SOL' ? f.amount.amount : 0n),
          0n,
        );
        if (
          n.step.writeoff ||
          n.key !== input.idempotencyKey ||
          input.execution.actualInput.amount !== BigInt(n.step.quantity) ||
          input.execution.actualOutput.amount !== BigInt(n.step.output) ||
          fees !== BigInt(n.step.fees) ||
          input.evidence.fingerprint !== n.step.evidence.fingerprint
        )
          fail('STEP_MISMATCH');
        await client.query(
          'insert into current_quote_settlement_steps(seal_id,step_index,fill_id) values($1,$2,$3)',
          [n.row.id, n.row.cursor, input.fillId],
        );
      },
      async commitPersistedSettlementWriteoff(client, input) {
        const n = await next(input, client);
        if (
          !n.step.writeoff ||
          n.key !== input.idempotencyKey ||
          input.evidence.fingerprint !== n.step.evidence.fingerprint ||
          BigInt(n.step.quantity) !== input.quantity
        )
          fail('WRITEOFF_MISMATCH');
        await client.query(
          'insert into current_quote_settlement_steps(seal_id,step_index,writeoff_journal_id) values($1,$2,$3)',
          [n.row.id, n.row.cursor, input.journalId],
        );
      },
      async verifySettlementFill(fillId) {
        return (
          (await base.pool.query('select current_quote_forced_fill_valid($1) valid', [fillId]))
            .rows[0]?.valid === true
        );
      },
    };
  }
}
