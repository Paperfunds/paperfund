import { useEffect, useState } from 'react';
import type { ChartTokenMetadata } from '@paperfund/shared/browser';
import { apiRequest } from './client.js';
export function useChartHistoryMetadata(ownerId: string | undefined, context: string | null) {
  const [saved, setSaved] = useState<{ ownerId: string; metadata: ChartTokenMetadata } | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  useEffect(() => {
    setSaved(null); setIssue(null);
    if (!ownerId || !context) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const metadata = await apiRequest('CHART_METADATA', { context });
        if (!active) return;
        if (metadata.requestedContext !== context) throw new Error('CHART_MINT_MISMATCH');
        setSaved({ ownerId, metadata }); setIssue(null);
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (active) setIssue(code && ['CHART_TOKEN_METADATA_MISSING', 'INVALID_TOKEN_DECIMALS', 'AUTHORITATIVE_SUPPLY_UNAVAILABLE'].includes(code) ? code : 'CHART_TOKEN_METADATA_RECONNECTING');
      } finally {
        if (active) timer = setTimeout(() => void read(), 10000);
      }
    };
    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [ownerId, context]);
  // Synchronous scope check prevents a render with the preceding navigation's identity.
  const metadata = saved && saved.ownerId === ownerId && saved.metadata.requestedContext === context ? saved.metadata : null;
  return { metadata, issue };
}
