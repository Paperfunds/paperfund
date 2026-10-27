/* global document */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const session = JSON.parse(await readFile('logs/operator/session.json', 'utf8')),
  token = new URL(session.url).hash.slice(1);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1050 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  const base = 'http://127.0.0.1:3188';
  const auth = await page.request.post(base + '/session', {
    headers: { origin: base },
    data: { token },
  });
  assert.equal(auth.status(), 200);
  await page.goto(base + '/');
  await page.getByText('Direct loopback session. No financial authorization granted.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Approve', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Discover actual creator fees', exact: true }).click();
  await page.waitForFunction(
    () => document.getElementById('fees').textContent.includes('claimableBondingExcessLamports'),
    { timeout: 60000 },
  );
  assert.match(await page.locator('#fees').textContent(), /"walletBalanceLamports": "0"/);
  await page.screenshot({ path: 'artifacts/operator/dashboard.png', fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(
    'artifacts/operator/browser-smoke.json',
    JSON.stringify(
      {
        passed: true,
        localSession: true,
        approvalDisabled: true,
        freshMainnetDiscovery: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log('Browser acceptance passed; screenshot saved.');
} finally {
  await browser.close();
}
