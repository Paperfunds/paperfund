/* global chrome, window, location */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const profile = mkdtempSync(join(tmpdir(), 'paperfund-production-smoke-'));
const mint = 'BewoWqr56gfPQXzWiMUSCVY4fJbthPZrdj17L3qCXEmg';
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.PAPERFUND_CHROMIUM_EXECUTABLE,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const loaded = await cdp.send('Extensions.loadUnpacked', {
    path: resolve('apps/extension/build'),
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async (mint) => {
    await chrome.storage.session.set({ paperfundSessionToken: 'fixture-session' });
    globalThis.smokeBuys = [];
    globalThis.smokeReject = false;
    const round = {
      id: 'smoke-round',
      state: 'OPEN',
      startsAt: '2099-01-01T00:00:00Z',
      endsAtExclusive: '2099-01-01T01:00:00Z',
      startingPaperSolLamports: '10000000000',
      maxUniqueTokens: 5,
      maxBuyRatioBps: 2000,
    };
    const account = {
      accountId: 'smoke-account',
      roundId: round.id,
      paperSolLamports: '10000000000',
      startingPaperSolLamports: '10000000000',
      slotsUsed: 0,
      slotLimit: 5,
      positions: [],
      roundState: 'OPEN',
    };
    globalThis.fetch = async (url, options) => {
      if (!url.startsWith('https://api.paperfund.app/api/v1/'))
        throw new Error('Unexpected production URL');
      const path = new URL(url).pathname;
      let data;
      if (path.endsWith('/auth/me')) data = { user: { id: 'fixture-user', walletAddress: mint } };
      else if (path.endsWith('/rounds/current'))
        data = { round, serverTime: '2099-01-01T00:30:00Z' };
      else if (path.endsWith('/account')) data = account;
      else if (path.endsWith('/positions'))
        data = {
          ...account,
          valuationStatus: 'AVAILABLE',
          portfolioEquityLamports: '10000000000',
          livePnlLamports: '0',
          positions: [],
        };
      else if (path.includes('/markets/'))
        data = { mint, supported: true, executionProtocol: 'PUMP_FUN', tokenDecimals: 6 };
      else if (path.endsWith('/buy-preflight'))
        data = { maxBuyLamports: '2000000000', slotAvailable: true, valuationStatus: 'AVAILABLE' };
      else if (path.endsWith('/buy')) {
        globalThis.smokeBuys.push({
          body: JSON.parse(options.body),
          key: options.headers['idempotency-key'],
        });
        if (globalThis.smokeReject)
          return new Response(
            JSON.stringify({ error: { code: 'RPC_UNAVAILABLE', message: 'Fixture unavailable' } }),
            { status: 503 },
          );
        data = {
          tokenQuantityReceivedBaseUnits: '1000000',
          actualPaperSolSpentLamports: '500000000',
        };
      } else data = { items: [], nextCursor: null };
      return new Response(JSON.stringify(data), { status: 200 });
    };
  }, mint);
  for (const host of ['axiom.trade', 'gmgn.ai', 'trade.padre.gg'])
    await context.route(`https://${host}/**`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body>Offline terminal fixture</body></html>',
      }),
    );
  await context.addInitScript((mint) => {
    window.solana = {
      publicKey: { toString: () => mint },
      connect: async () => ({ publicKey: { toString: () => mint } }),
    };
  }, mint);
  for (const url of [
    `https://axiom.trade/meme/${mint}`,
    `https://gmgn.ai/sol/token/${mint}`,
    `https://trade.padre.gg/trade/solana/${mint}`,
  ]) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.log(`Page error: ${error.message}`);
    });
    await page.goto(url);
    const bridge = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Bridge did not respond')), 5000);
          window.addEventListener('message', (event) => {
            if (event.data?.requestId === 'smoke' && event.data?.direction === 'RESPONSE') {
              clearTimeout(timer);
              resolve(event.data);
            }
          });
          window.postMessage(
            {
              channel: 'paperfund:page-bridge:v1',
              direction: 'REQUEST',
              requestId: 'smoke',
              operation: 'CONNECT',
            },
            location.origin,
          );
        }),
    );
    assert.equal(bridge.ok, true);
    assert.equal(bridge.walletAddress, mint);
    await page.getByLabel('Paper SOL amount').fill('0.5');
    const button = page.getByRole('button', { name: 'BUY · PAPER ONLY' });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.getByText(/Bought 1 for 0.5 SOL/)).toBeVisible();
    await worker.evaluate(() => {
      globalThis.smokeReject = true;
    });
    await page.getByLabel('Paper SOL amount').fill('0.5');
    await button.click();
    await expect(page.getByText(/RPC_UNAVAILABLE/)).toBeVisible();
    await worker.evaluate(() => {
      globalThis.smokeReject = false;
    });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS: classic bridge startup, wallet response, BUY success and typed rejection: ${new URL(url).hostname}`,
    );
  }
  const buys = await worker.evaluate(() => globalThis.smokeBuys);
  assert.equal(buys.length, 6);
  assert(buys.every((buy) => buy.body.mint === mint && buy.body.paperSol === '0.5' && buy.key));
  console.log(
    `PASS: production unpacked ${loaded.id}; six single-attempt BUY messages; no real API/trades.`,
  );
} finally {
  await context?.close();
  rmSync(profile, { recursive: true, force: true });
}
