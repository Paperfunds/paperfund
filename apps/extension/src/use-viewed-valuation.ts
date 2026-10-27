import { useEffect, useRef, useState } from 'react';
import { apiRequest } from './client.js';
import { operatorDiagnostic } from './diagnostics.js';
import {
  ViewedValuationLoop,
  displayedValuation,
  type ValuationSample,
} from './viewed-valuation.js';
export function useViewedValuation(input: {
  userId: string | undefined;
  accountId: string | undefined;
  roundId: string | undefined;
  mint: string | undefined;
  endsAt: number;
  knownRevision: string;
  refresh: number;
}) {
  const identity = JSON.stringify([input.userId, input.roundId, input.mint]);
  const scope = JSON.stringify([identity, input.accountId, input.knownRevision, input.refresh]);
  const [sample, setSample] = useState<{
    scope: string;
    current: ValuationSample;
    good: ValuationSample | null;
  } | null>(null);
  const [clock, setClock] = useState(0);
  const deadline = useRef(input.endsAt);
  deadline.current = input.endsAt;
  const loopRef = useRef<ViewedValuationLoop | null>(null);
  const ordering = useRef({ scope: '', value: { slot: null as bigint | null, updatedAt: 0 } });
  useEffect(() => {
    if (!input.userId || !input.roundId || !input.mint) {
      setSample(null);
      return;
    }
    if (ordering.current.scope !== identity)
      ordering.current = { scope: identity, value: { slot: null, updatedAt: 0 } };
    let active = true;
    const loop = new ViewedValuationLoop(
      {
        userId: input.userId,
        accountId: input.accountId ?? null,
        roundId: input.roundId,
        mint: input.mint,
        endsAt: deadline.current,
      },
      (signal) => apiRequest('VIEWED_POSITION', { mint: input.mint! }, { signal }),
      (current) => {
        if (active)
          setSample((previous) => ({
            scope,
            current,
            good:
              current.response.status === 'AVAILABLE'
                ? current
                : previous?.scope === scope
                  ? previous.good
                  : null,
          }));
      },
      (details) => operatorDiagnostic('LIVE_VALUATION', { mint: input.mint, ...details }),
      ordering.current.value,
    );
    loopRef.current = loop;
    const visible = () => {
      if (document.hidden) loop.stop();
      else loop.start();
    };
    if (!document.hidden) loop.start();
    const timer = setInterval(() => setClock((v) => v + 1), 1000);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      if (loopRef.current === loop) loopRef.current = null;
      loop.stop();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [
    identity,
    scope,
    input.userId,
    input.accountId,
    input.roundId,
    input.mint,
    input.knownRevision,
    input.refresh,
  ]);
  useEffect(() => {
    loopRef.current?.updateDeadline(input.endsAt);
  }, [input.endsAt]);
  useEffect(() => {
    if (sample?.scope !== scope) return;
    const age = displayedValuation(sample.current, sample.good);
    operatorDiagnostic('LIVE_VALUATION_AGE', {
      mint: input.mint,
      displayedAgeMs: age.ageMs,
      stale: age.stale,
    });
  }, [clock, sample, scope, input.mint]);
  const current = sample?.scope === scope ? sample.current : null;
  return {
    ...displayedValuation(current, sample?.scope === scope ? sample.good : null),
    response: current?.response ?? null,
  };
}
