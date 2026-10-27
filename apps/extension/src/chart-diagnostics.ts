import { operatorDiagnostic } from './diagnostics.js';

export const chartStages = [
  'CHART_CONTEXT_DETECTED',
  'CHART_IFRAME_FOUND',
  'CHART_API_ACCESSIBLE',
  'ACTIVE_CHART_AVAILABLE',
  'CURRENT_MINT_MATCHED',
  'CHART_MODE_DETECTED',
  'ENTRY_MARKET_CAP_VALIDATED',
  'DRAWING_REQUESTED',
  'DRAWING_CREATED',
  'DRAWING_VISIBLE_OR_REJECTED',
] as const;
export type ChartStage = (typeof chartStages)[number];
export interface ChartStageResult {
  stage: ChartStage;
  status: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  reason: string;
  details: Record<string, unknown>;
}
export class ChartDiagnosis {
  readonly stages: ChartStageResult[] = [];
  constructor(
    private context: string,
    private expectedMint: string | null,
  ) {}
  record(
    stage: ChartStage,
    status: ChartStageResult['status'],
    reason: string,
    details: Record<string, unknown> = {},
  ) {
    const index = this.stages.findIndex((result) => result.stage === stage);
    const record = { stage, status, reason, details };
    if (index < 0) this.stages.push(record);
    else this.stages[index] = record;
  }
  finish(reason: string) {
    for (const stage of chartStages)
      if (!this.stages.some((result) => result.stage === stage))
        this.record(stage, 'UNAVAILABLE', `NOT_REACHED: ${reason}`);
    const report = {
      world: 'MAIN',
      context: this.context,
      expectedMint: this.expectedMint,
      expectedMintSource:
        this.expectedMint === null ? 'PENDING_BACKEND_MARKET_RESOLUTION' : 'OVERLAY_BACKEND_MARKET',
      firstFailure: this.stages.find((stage) => stage.status !== 'PASS')?.stage ?? null,
      stages: chartStages.map((stage) => this.stages.find((result) => result.stage === stage)!),
    };
    operatorDiagnostic('CHART_DIAGNOSIS', report, 'MAIN');
    return report;
  }
}

/** Read-only inventory includes wrappers and descendant frames; never bypasses origin restrictions. */
export function chartContextInventory(root: Document): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const visit = (doc: Document, path: string, depth: number) => {
    if (depth > 5 || records.length >= 40) return;
    for (const [index, frame] of [...doc.querySelectorAll<HTMLIFrameElement>('iframe')].entries()) {
      if (records.length >= 40) break;
      const framePath = path + '/iframe[' + index + ']';
      const record: Record<string, unknown> = {
        framePath,
        id: frame.id,
        title: frame.title,
        selectedByAdapter:
          frame.matches('iframe[id^="tradingview_"], iframe[title="Financial Chart"]') &&
          depth === 0,
      };
      records.push(record);
      try {
        const child = frame.contentDocument;
        if (!child) {
          record.access = 'DOCUMENT_INACCESSIBLE_OR_NOT_READY';
          continue;
        }
        record.access = 'SAME_ORIGIN_DOCUMENT_ACCESSIBLE';
        const host = frame.contentWindow as (Window & { tradingViewApi?: unknown }) | null;
        record.tradingViewApi = typeof host?.tradingViewApi;
        visit(child, framePath, depth + 1);
      } catch (error) {
        record.access = 'FRAME_ACCESS_THREW';
        record.errorName =
          error && typeof error === 'object' && 'name' in error && typeof error.name === 'string'
            ? error.name.slice(0, 80)
            : 'UNKNOWN_ERROR';
      }
    }
  };
  visit(root, 'top', 0);
  return records;
}
