import type { ChartMarkers } from './chart-marker.js';

/** GMGN's isolated chart has no verified native scale bridge. This is a labelled
 * extension-owned reference legend, never a guessed price/time coordinate. */
export class GmgnChartLegend {
  private layer: HTMLDivElement | null = null;
  private fingerprint = '';
  invalidate() {
    this.layer?.remove();
    this.layer = null;
    this.fingerprint = '';
  }
  render(data: ChartMarkers) {
    const url = new URL(location.href);
    const mint = /^\/sol\/token\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    if (url.hostname !== 'gmgn.ai' || data.url !== url.href || mint !== data.mint ||
      data.context !== mint || !data.ownerId) {
      this.invalidate();
      return { available: false, reason: 'GMGN_CHART_IDENTITY_UNVERIFIED', drawn: 0 };
    }
    const frame = [...document.querySelectorAll<HTMLIFrameElement>(
      'iframe[id^="tradingview_"], iframe[title="Financial Chart"]',
    )].find(f => {
      const r = f.getBoundingClientRect();
      return f.isConnected && r.width >= 280 && r.height >= 180 &&
        r.top + r.height > 0 && r.top < window.innerHeight &&
        getComputedStyle(f).visibility !== 'hidden' && getComputedStyle(f).display !== 'none';
    });
    if (!frame) {
      this.invalidate();
      return { available: false, reason: 'GMGN_CHART_INITIALIZING', drawn: 0 };
    }
    const r = frame.getBoundingClientRect();
    const average = data.markers.find(m => m.kind === 'AVERAGE');
    const history = data.history?.visible && data.history.ownerId === data.ownerId &&
      data.history.mint === data.mint ? data.history.drawings.filter(d =>
        d.ownerId === data.ownerId && d.mint === data.mint) : [];
    const rows: string[] = [];
    if (average) rows.push(average.usdEntry?.priceUsd
      ? `PF AVG $${average.usdEntry.priceUsd} / token`
      : `PF AVG ${average.priceSol} SOL / token`);
    for (const d of [...history].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)).slice(-6))
      rows.push(`${d.label} · $${d.levelUsd} cap · ${new Date(d.time * 1000).toISOString().slice(11, 19)}Z`);
    if (!rows.length) {
      this.invalidate();
      return { available: false, reason: 'GMGN_NO_ELIGIBLE_REFERENCE_LEVELS', drawn: 0, legendItems: 0 };
    }
    if (!this.layer?.isConnected) {
      this.layer = document.createElement('div');
      this.layer.dataset.paperfundGmgnLegend = 'true';
      this.layer.setAttribute('role', 'note');
      Object.assign(this.layer.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483000',
        color: '#d9eee2', background: 'rgba(13,22,18,.88)', font: '10px/1.4 sans-serif',
        padding: '5px 7px', border: '1px solid #496652', borderRadius: '4px',
        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' });
      document.body.append(this.layer);
      this.fingerprint = '';
    }
    const fingerprint = JSON.stringify([data.ownerId, data.mint, rows]);
    if (fingerprint !== this.fingerprint) {
      this.layer.replaceChildren();
      const title = document.createElement('div');
      title.textContent = 'PF reference levels · not chart coordinates';
      this.layer.append(title);
      for (const row of rows) {
        const item = document.createElement('div');
        item.textContent = row;
        item.title = row;
        this.layer.append(item);
      }
      this.fingerprint = fingerprint;
    }
    this.layer.style.left = `${Math.max(0, r.right - Math.min(270, r.width - 16) - 8)}px`;
    this.layer.style.top = `${Math.max(0, r.top + 8)}px`;
    this.layer.style.width = `${Math.min(270, r.width - 16)}px`;
    this.layer.style.maxHeight = `${Math.min(150, r.height - 16)}px`;
    return { available: false, reason: 'GMGN_NATIVE_SCALE_UNAVAILABLE', drawn: 0,
      legendItems: rows.length, legendAvailable: true };
  }
}
