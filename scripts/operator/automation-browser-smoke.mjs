import { operatorServer } from './server.mjs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const port = 3190,
  { server, token } = operatorServer({ port }),
  base = 'http://127.0.0.1:' + port;
await new Promise((r) => server.listen(port, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1450, height: 1150 } });
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  assert.equal(
    (
      await page.request.post(base + '/session', { headers: { origin: base }, data: { token } })
    ).status(),
    200,
  );
  await page.goto(base + '/');
  await page.waitForFunction(() =>
    document.getElementById('automation-summary').textContent.includes('Setup required'),
  );
  assert.equal(
    await page.getByRole('button', { name: 'Auto Claim Fees — OFF', exact: true }).count(),
    1,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Hourly Rewards — OFF', exact: true }).count(),
    1,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Daily Rewards — OFF', exact: true }).count(),
    1,
  );
  await page.getByRole('button', { name: 'Claim Fees Now', exact: true }).click();
  await page.waitForFunction(() =>
    document
      .getElementById('session')
      .textContent.includes('AUTO_SECURE_SERVICE_ENROLLMENT_REQUIRED'),
  );
  const after = await (await page.request.get(base + '/api/automation')).json();
  assert.equal(after.settings.claims, false);
  assert.equal(after.settings.hourly, false);
  assert.equal(after.settings.daily, false);
  assert.equal(
    (
      await page.request.post(base + '/api/automation/control', {
        headers: { origin: 'https://untrusted.example' },
        data: { action: 'claims:on' },
      })
    ).status(),
    403,
  );
  assert.equal(
    (await page.request.post(base + '/api/sign', { headers: { origin: base }, data: {} })).status(),
    423,
  );
  await page.getByRole('button', { name: 'Export standing-policy draft', exact: true }).click();
  await page.waitForFunction(() =>
    document.getElementById('automation-action').textContent.includes('draftPath'),
  );
  const draft = JSON.parse(await page.locator('#automation-action').textContent());
  const policy = JSON.parse(fs.readFileSync(draft.draftPath, 'utf8'));
  assert.equal(policy.claims.enabled, false);
  assert.equal(policy.claims.maxGrossLamports, '0');
  assert.equal(draft.authorityGranted, false);
  assert.deepEqual(errors, []);
  await page.locator('#automation-summary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/operator/automation-dashboard.png' });
  fs.writeFileSync(
    'artifacts/operator/automation-browser-smoke.json',
    JSON.stringify(
      {
        passed: true,
        missingEnrollmentFailsClosed: true,
        togglesRemainOff: true,
        crossOriginRejected: true,
        mainnetSigningBlocked: true,
        draftGrantsNoAuthority: true,
        errors,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  fs.unlinkSync(draft.draftPath);
  console.log(
    'Automation dashboard acceptance PASS: all controls truthful, unauthorized actions blocked, public draft grants no authority.',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
