import type { AxiomNativeChart } from './axiom-native.js';
import type { TradeHistoryPlan } from './trade-history-chart.js';
import { operatorDiagnostic } from './diagnostics.js';
/** Native-only history renderer. Own IDs are reconciled separately from the working active AVG. */
export class AxiomHistoricalDrawings {
  private entities = new Map<
    string,
    { chart: AxiomNativeChart; id: string; fingerprint: string }
  >();
  private revision = 0;
  private busy = false;
  private completed = '';
  private retryAt = 0;
  private latest: {
    plan: TradeHistoryPlan;
    chart: AxiomNativeChart;
    valid: () => boolean;
    signature: string;
    identity: string;
  } | null = null;
  clear(reason: string) {
    this.revision++;
    this.latest = null;
    this.completed = '';
    for (const entity of this.entities.values()) {
      try {
        entity.chart.removeEntity(entity.id);
      } catch {
        /* Host disposed. */
      }
    }
    if (this.entities.size)
      operatorDiagnostic('CHART_HISTORY_REMOVED', { reason, count: this.entities.size }, 'MAIN');
    this.entities.clear();
  }
  unavailable(plan: TradeHistoryPlan | undefined, reason: string) {
    this.clear(reason);
    if (plan)
      operatorDiagnostic(
        'CHART_HISTORY_STATUS',
        {
          ...plan.diagnostics,
          ownerId: plan.ownerId,
          mint: plan.mint,
          entities: 0,
          errors: [reason],
          unavailableDrawings: [
            ...(plan.diagnostics.unavailableDrawings ?? []),
            ...plan.drawings.map((d) => ({
              drawingId: d.id,
              kind: d.kind,
              cycleId: d.cycleId,
              reason,
            })),
          ],
          visualAcceptance: 'PENDING',
        },
        'MAIN',
      );
  }
  render(
    plan: TradeHistoryPlan | undefined,
    chart: AxiomNativeChart,
    ownerId: string | undefined,
    mint: string | null,
    identity: string,
    valid: () => boolean,
  ) {
    if (!plan || plan.ownerId !== ownerId || plan.mint !== mint) {
      this.clear('HISTORY_SCOPE_UNAVAILABLE_OR_CHANGED');
      return;
    }
    if (!valid()) {
      this.clear('HISTORY_CHART_IDENTITY_CHANGED');
      return;
    }
    const signature = JSON.stringify([ownerId, mint, identity, plan]);
    if (this.latest?.signature !== signature || this.latest.chart !== chart) {
      this.revision++;
      this.latest = { plan, chart, valid, signature, identity };
    }
    if (this.busy) return;
    if (this.completed === signature) {
      if (this.entities.size < (plan.visible ? plan.drawings.length : 0)) {
        if (Date.now() < this.retryAt) return;
      } else {
        try {
          const shapes = chart.getAllShapes?.();
          if (
            !shapes ||
            [...this.entities.values()].every((e) => shapes.some((s) => s.id === e.id))
          )
            return;
        } catch {
          return;
        }
      }
    }
    void this.reconcile();
  }
  private async reconcile() {
    const request = this.latest;
    if (!request) return;
    this.busy = true;
    const version = this.revision;
    const requested = request.plan.visible ? request.plan.drawings : [];
    const wanted = new Set(requested.map((d) => d.id));
    const errors: string[] = [];
    const unavailableDrawings: {
      drawingId: string;
      kind: string;
      cycleId: string;
      reason: string;
    }[] = [];
    const report = (drawing: TradeHistoryPlan['drawings'][number], reason: string) => {
      errors.push(reason);
      unavailableDrawings.push({
        drawingId: drawing.id,
        kind: drawing.kind,
        cycleId: drawing.cycleId,
        reason,
      });
    };
    let lines = 0,
      markers = 0;
    try {
      for (const [key, e] of this.entities)
        if (!wanted.has(key) || e.chart !== request.chart) {
          try {
            e.chart.removeEntity(e.id);
          } catch {
            /* disposed */
          }
          this.entities.delete(key);
        }
      for (const drawing of requested) {
        if (version !== this.revision) break;
        if (!request.valid()) {
          this.clear('HISTORY_CHART_IDENTITY_CHANGED');
          break;
        }
        if (drawing.ownerId !== request.plan.ownerId || drawing.mint !== request.plan.mint) {
          report(drawing, 'HISTORY_DRAWING_SCOPE_MISMATCH');
          continue;
        }
        const price = Number(drawing.levelUsd);
        if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(drawing.time)) {
          report(
            drawing,
            !Number.isSafeInteger(drawing.time)
              ? 'INVALID_FILL_TIMESTAMP'
              : 'INVALID_HISTORICAL_LEVEL',
          );
          continue;
        }
        const fingerprint = JSON.stringify([
          request.plan.ownerId,
          request.plan.mint,
          request.identity,
          drawing,
        ]);
        const previous = this.entities.get(drawing.id);
        if (previous?.fingerprint === fingerprint) {
          const shapes = request.chart.getAllShapes?.();
          if (!shapes || shapes.some((s) => s.id === previous.id)) continue;
        }
        if (previous) {
          try {
            previous.chart.removeEntity(previous.id);
          } catch {
            /* Host already removed this drawing. */
          }
          this.entities.delete(drawing.id);
        }
        const line = drawing.kind.endsWith('_AVG');
        const buy = drawing.kind.startsWith('BUY');
        const color = buy ? '#579e7b' : '#b8737e';
        try {
          const id = await request.chart.createShape(
            { price, time: drawing.time },
            {
              shape: line ? 'horizontal_line' : 'text',
              text: line ? drawing.label : buy ? '\u24b7' : '\u24c8',
              lock: true,
              disableSelection: true,
              disableSave: true,
              disableUndo: true,
              zOrder: 'bottom',
              overrides: line
                ? {
                    linecolor: color,
                    textcolor: color,
                    linewidth: 1,
                    linestyle: 2,
                    showLabel: true,
                    showPrice: false,
                    fontsize: 9,
                    text: drawing.label,
                    horzLabelsAlign: buy ? 'right' : 'left',
                    vertLabelsAlign: 'top',
                  }
                : {
                    color,
                    fontsize: 14,
                    bold: true,
                    fixedSize: true,
                    fillBackground: false,
                    drawBorder: false,
                  },
            },
          );
          if (!id) {
            report(
              drawing,
              line ? 'HISTORICAL_LINE_ID_UNAVAILABLE' : 'HISTORICAL_MARKER_ID_UNAVAILABLE',
            );
            continue;
          }
          if (version !== this.revision || !request.valid()) {
            request.chart.removeEntity(id);
            break;
          }
          this.entities.set(drawing.id, { chart: request.chart, id, fingerprint });
          if (line) lines++;
          else markers++;
        } catch {
          report(drawing, line ? 'HISTORICAL_LINE_API_REJECTED' : 'HISTORICAL_MARKER_API_REJECTED');
        }
      }
      if (version === this.revision) {
        this.completed = request.signature;
        this.retryAt = errors.length ? Date.now() + 2000 : 0;
        operatorDiagnostic(
          'CHART_HISTORY_STATUS',
          {
            ...request.plan.diagnostics,
            ownerId: request.plan.ownerId,
            mint: request.plan.mint,
            visible: request.plan.visible,
            markerStyle: 'NATIVE_TEXT_CIRCLED_LETTER',
            unavailableDrawings: [
              ...(request.plan.diagnostics.unavailableDrawings ?? []),
              ...unavailableDrawings,
            ],
            entities: this.entities.size,
            entityIds: [...this.entities.values()].map((e) => e.id),
            entityState: (() => {
              try {
                const shapes = request.chart.getAllShapes?.();
                return shapes
                  ? [...this.entities.values()].every((e) =>
                      shapes.some((shape) => shape.id === e.id),
                    )
                    ? 'PRESENT'
                    : 'MISSING'
                  : 'UNAVAILABLE';
              } catch {
                return 'UNAVAILABLE';
              }
            })(),
            restoration: errors.length ? 'DRAWING_API_FAILURE' : this.entities.size ? 'HISTORICAL_DRAWINGS_RESTORED' : 'NO_ELIGIBLE_HISTORICAL_DRAWINGS',
            lineCreations: lines,
            markerCreations: markers,
            errors: [...new Set(errors)],
            visualAcceptance: 'PENDING',
          },
          'MAIN',
        );
      }
    } catch {
      this.completed = request.signature;
      this.retryAt = Date.now() + 2000;
      operatorDiagnostic(
        'CHART_HISTORY_STATUS',
        {
          ownerId: request.plan.ownerId,
          mint: request.plan.mint,
          errors: ['HISTORICAL_RECONCILIATION_FAILED'],
          visualAcceptance: 'PENDING',
        },
        'MAIN',
      );
    } finally {
      this.busy = false;
      if (
        this.latest &&
        (this.latest.signature !== request.signature || this.latest.chart !== request.chart)
      )
        void this.reconcile();
    }
  }
}
