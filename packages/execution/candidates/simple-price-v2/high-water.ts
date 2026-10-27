import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  CandidateError,
  MODEL_VERSION,
  fingerprint,
  validateEvidence,
  observationProgression,
  calibrate,
  discrepancy,
} from './model.js';
import type { Evidence, Policy, ReferenceQuote } from './model.js';

const encode = (value: unknown) =>
  JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v));
const decode = (value: string): unknown =>
  JSON.parse(value, (_, v: unknown) =>
    v && typeof v === 'object' && Object.keys(v).length === 1 && '$bigint' in v
      ? BigInt((v as { $bigint: string }).$bigint)
      : v,
  );
interface State {
  model: string;
  policyHash: string;
  markets: Record<string, Evidence>;
  baselines: Record<string, Evidence>;
  conversions: Record<string, NonNullable<Evidence['conversion']>>;
  conversionBaselines: Record<string, NonNullable<Evidence['conversion']>>;
  quotes: Record<string, ReferenceQuote>;
}
/** Isolated file-backed provider authority only. Not financial persistence or a production DB substitute. */
export class IsolatedHighWater {
  readonly directory: string;
  constructor(
    directory: string,
    private readonly policy: Policy,
  ) {
    this.directory = resolve(directory);
    const artifactRoot = resolve('artifacts/simple-price-v2-private') + sep;
    const tempRoot = resolve(tmpdir()) + sep + 'paperfund-simple-v2-';
    if (!this.directory.startsWith(artifactRoot) && !this.directory.startsWith(tempRoot))
      throw new CandidateError('ISOLATED_STORAGE_REQUIRED');
    this.policy = structuredClone(policy);
  }
  async accept(evidence: Evidence, now: number): Promise<void> {
    await this.acceptBatch([evidence], now);
  }
  async acceptBatch(evidence: readonly Evidence[], now: number): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const lockPath = join(this.directory, 'authority.lock'),
      file = join(this.directory, 'authority.json'),
      marker = join(this.directory, 'initialized');
    let lock;
    try {
      lock = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new CandidateError('HIGH_WATER_BUSY');
      throw error;
    }
    let temporary: string | null = null;
    try {
      let state: State;
      try {
        const envelope = JSON.parse(await readFile(file, 'utf8')) as { body: string; hash: string };
        if (fingerprint(envelope.body) !== envelope.hash)
          throw new CandidateError('HIGH_WATER_CORRUPTED');
        state = decode(envelope.body) as State;
        if (state.model !== MODEL_VERSION || state.policyHash !== fingerprint(this.policy))
          throw new CandidateError('HIGH_WATER_VERSION_MISMATCH');
        if (
          !state.markets ||
          !state.baselines ||
          !state.conversions ||
          !state.conversionBaselines ||
          !state.quotes
        )
          throw new CandidateError('HIGH_WATER_CORRUPTED');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          try {
            await readFile(marker);
            throw new CandidateError('HIGH_WATER_MISSING');
          } catch (markerError) {
            if ((markerError as NodeJS.ErrnoException).code !== 'ENOENT') throw markerError;
          }
          state = {
            model: MODEL_VERSION,
            policyHash: fingerprint(this.policy),
            markets: {},
            baselines: {},
            conversions: {},
            conversionBaselines: {},
            quotes: {},
          };
        } else
          throw error instanceof CandidateError
            ? error
            : new CandidateError('HIGH_WATER_CORRUPTED');
      }
      for (const raw of evidence) {
        const e = structuredClone(raw),
          key = fingerprint(e.identity),
          prior = state.markets[key];
        const price = validateEvidence(e, e.identity, now, this.policy, prior);
        // Whole-epoch movement baseline prevents a sequence of small accepted updates from ratcheting it.
        if (state.baselines[key])
          validateEvidence(e, e.identity, now, this.policy, state.baselines[key]);
        calibrate(e, price, now, this.policy);
        if (prior) {
          if (e.feeObservedAtMs < prior.feeObservedAtMs)
            throw new CandidateError('REGRESSING_FEE_EVIDENCE');
          if (
            e.feeObservedAtMs === prior.feeObservedAtMs &&
            fingerprint(e.fees) !== fingerprint(prior.fees)
          )
            throw new CandidateError('CONFLICTING_FEE_EVIDENCE');
        }
        for (const q of e.calibration.quotes) {
          const qKey = fingerprint({
            identity: e.identity,
            source: q.source,
            side: q.side,
            input: q.input,
          });
          const priorQuote = state.quotes[qKey];
          if (priorQuote) {
            if (q.upstream !== priorQuote.upstream)
              throw new CandidateError('CONFLICTING_SOURCE_EVIDENCE');
            if (q.slot < priorQuote.slot || q.observedAtMs < priorQuote.observedAtMs)
              throw new CandidateError('REGRESSING_QUOTE_EVIDENCE');
            if (
              q.slot === priorQuote.slot &&
              q.observedAtMs === priorQuote.observedAtMs &&
              (q.output !== priorQuote.output || q.feesHash !== priorQuote.feesHash)
            )
              throw new CandidateError('CONFLICTING_QUOTE_EVIDENCE');
          }
          state.quotes[qKey] = q;
        }
        if (e.conversion) {
          const fxKey = fingerprint({ quote: e.identity.quote, sol: this.policy.solQuote });
          const fxPrior = state.conversions[fxKey];
          if (fxPrior) observationProgression(e.conversion.observations, fxPrior.observations);
          if (state.conversionBaselines[fxKey])
            discrepancy(
              e.conversion.price,
              state.conversionBaselines[fxKey]!.price,
              this.policy.maxMovementBps,
            );
          state.conversions[fxKey] = e.conversion;
          state.conversionBaselines[fxKey] ??= e.conversion;
        }
        state.markets[key] = e;
        state.baselines[key] ??= e;
      }
      const body = encode(state);
      temporary = join(this.directory, 'authority-' + randomUUID() + '.tmp');
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ body, hash: fingerprint(body) }), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file);
      temporary = null;
      const initialized = await open(marker, 'a', 0o600);
      try {
        await initialized.sync();
      } finally {
        await initialized.close();
      }
    } finally {
      if (temporary) await unlink(temporary).catch(() => undefined);
      await lock.close();
      await unlink(lockPath);
    }
  }
}
