const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const url = process.env.PEPS_TEST_URL || pathToFileURL(path.join(__dirname, '../peps/index.html')).href;
async function next(page) { await page.locator('#protocolNextButton').click(); }
async function addPeptide(page, { name, duration, measurement = 'mixed', plan = 'steady' }) {
  await page.locator('#newPeptideBtn').click();
  await page.locator('#peptideNameInput').fill(name);
  await page.locator('#doseAmountInput').fill('1');
  await page.locator('#timeInput').selectOption('AM,PM');
  await next(page);
  await next(page);
  assert.match(await page.locator('#protocolError').textContent(), /Choose ongoing/);
  if (duration === 'ongoing') {
    await page.locator('[name="durationChoice"][value="fixed"]').check();
    await page.locator('#courseWeeksInput').fill('0');
  }
  await page.locator(`[name="durationChoice"][value="${duration}"]`).check();
  if (duration === 'cycle') {
    await page.locator('#cycleOnWeeks').fill('8');
    await next(page);
    assert.match(await page.locator('#protocolStepLabel').textContent(), /Step 2/);
    await page.locator('#cycleOffWeeks').fill('3');
  }
  if (duration === 'fixed') await page.locator('#courseWeeksInput').fill('8');
  await next(page);
  await page.locator('#measurementMode').selectOption(measurement);
  if (measurement === 'mixed') {
    await page.locator('#powderMgInput').fill('10');
    await page.locator('#bacMlInput').fill('2');
    assert.match(await page.locator('#measurementPreview').textContent(), /20 units/);
  }
  await next(page);
  await page.locator('#protocolPlanChoice').selectOption(plan);
  if (plan === 'increase') {
    await page.locator('#titrationIncrement').fill('0.5');
    await page.locator('#titrationCadence').fill('28');
    await page.locator('#titrationMax').fill('3');
  }
  await next(page);
  assert.equal(await page.locator('#savePeptideButton').isVisible(), true);
  await page.locator('#savePeptideButton').click();
  assert.equal(await page.locator('#protocolDialog').isVisible(), false);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1440, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, timezoneId: 'America/Los_Angeles' });
      const errors = [], rows = new Map();
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      await page.clock.install({ time: new Date('2026-10-17T12:00:00-07:00') });
      await page.route('**/rest/v1/**', async route => {
        const request = route.request();
        if (request.method() === 'POST') {
          const row = request.postDataJSON();
          rows.set(row.id, row);
          await route.fulfill({ status: 204 });
        } else {
          const id = new URL(request.url()).searchParams.get('id')?.replace(/^eq\./, '');
          await route.fulfill({ json: rows.has(id) ? [rows.get(id)] : [] });
        }
      });
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector('#unlockButtonText').textContent === 'Create private password');
      await page.locator('#passwordInput').fill('qa-only-private-password');
      await page.locator('#unlockForm button[type="submit"]').click();
      await page.locator('#firstVisitWelcome').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => PepsCore.state.stack.length), 0);
      await page.locator('[data-new-protocol]').click();
      await page.locator('#protocolCancelButton').click();
      assert.equal(await page.locator('#protocolDialog').isVisible(), false);
      await addPeptide(page, { name: 'Cycle example', duration: 'cycle' });
      assert.equal(await page.evaluate(() => PepsCore.findPeptide('cycle-example').duration.onDays), 56);
      assert.equal(await page.evaluate(() => PepsCore.findPeptide('cycle-example').duration.offDays), 21);
      assert.equal(await page.evaluate(() => PepsCore.plan('2026-12-12').tasks.length), 0, 'Cycle break removes doses');
      await addPeptide(page, { name: 'Fixed example', duration: 'fixed', measurement: 'later' });
      assert.equal(await page.evaluate(() => PepsCore.findPeptide('fixed-example').endDate), '2026-12-11');
      assert.equal(await page.evaluate(() => PepsCore.plan('2026-12-12').tasks.length), 0);
      await addPeptide(page, { name: 'Ongoing example', duration: 'ongoing', plan: 'increase' });
      assert.equal(await page.evaluate(() => PepsCore.findPeptide('ongoing-example').titration.nextReviewDate), '2026-11-14');
      assert.equal(await page.locator('#stackList .stack-card').count(), 3);
      await page.locator('#stackList [data-edit-peptide="cycle-example"]').click();
      await page.locator('[data-protocol-edit-step="1"]').click();
      assert.equal(await page.locator('#cycleOnWeeks').inputValue(), '8');
      await page.locator('#cycleOnWeeks').fill('10');
      await page.locator('[data-protocol-edit-step="4"]').click();
      assert.match(await page.locator('#protocolSummary').textContent(), /10 weeks on \/ 3 weeks off/);
      assert.equal(await page.locator('#initialWeightFields').isVisible(), false);
      await page.locator('#savePeptideButton').click();
      assert.equal(await page.evaluate(() => PepsCore.findPeptide('cycle-example').duration.onDays), 70);
      await page.evaluate(() => {
        PepsCore.state.checkins = {
          '2026-09-16': { weight: 212.8 }, '2026-09-23': { weight: 211.2 },
          '2026-09-30': { weight: 209.8 }, '2026-10-07': { weight: 208.6 },
          '2026-10-15': { weight: 207.8 }, '2026-10-16': { weight: 207.4 }
        };
        PepsCore.commit(); PepsRender();
      });
      await page.locator('.app-nav [data-nav="dashboard"]').click();
      assert.match(await page.locator('#dashboardMetrics').textContent(), /Pulls today6/);
      assert.match(await page.locator('#dashboardMetrics').textContent(), /Taken0 \/ 6/);
      assert.match(await page.locator('#dashboardMetrics').textContent(), /207.4/);
      assert.match(await page.locator('#dashboardMetrics').textContent(), /Oct 16/);
      assert.equal(await page.locator('#titrationSection').isVisible(), false, 'Future review does not clutter Today');
      assert.equal(await page.getByRole('button', { name: 'Mark Fixed example AM as taken' }).isDisabled(), true);
      await page.getByRole('button', { name: 'Mark Cycle example AM as taken' }).click();
      assert.match(await page.locator('#dashboardMetrics').textContent(), /Taken1 \/ 6/);
      await page.getByRole('button', { name: 'Undo Cycle example AM completion' }).click();
      assert.match(await page.locator('#dashboardMetrics').textContent(), /Taken0 \/ 6/);
      await page.locator('#quickWeightInput').fill('207');
      await page.locator('#quickCheckinForm button[type="submit"]').click();
      assert.match(await page.locator('#dashboardMetrics').textContent(), /207/);
      assert.match(await page.locator('#dashboardAnalyticsGrid .metric-total-loss').textContent(), /5.8 lb/);
      assert.match(await page.locator('#dashboardAnalyticsGrid .metric-daily-change').textContent(), /-0.4 lb/);
      assert.equal(await page.locator('#dashboardWeightChart circle').count(), 7);
      await page.clock.runFor(2300);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `/tmp/peps-live-qa/dashboard-${width}.png`, fullPage: true });
      await page.evaluate(() => { PepsCore.findPeptide('ongoing-example').titration.nextReviewDate = '2026-10-17'; PepsRender(); });
      await page.locator('.dose-review summary').click();
      await page.locator('[data-titration-hold="ongoing-example"]').click();
      assert.equal(await page.evaluate(() => PepsCore.findPeptide('ongoing-example').titration.nextReviewDate), '2026-11-14');
      assert.equal(await page.locator('#titrationSection').isVisible(), false);
      await page.locator('.app-nav [data-nav="settings"]').click();
      await page.locator('[data-remove-peptide="fixed-example"]').click();
      assert.equal(await page.locator('#stackList .stack-card').count(), 2);
      await page.locator('#newPeptideBtn').click();
      await page.locator('#protocolCancelButton').click();
      assert.equal(await page.locator('#stackList .stack-card').count(), 2);
      await page.locator('#stackList [data-edit-peptide="cycle-example"]').click();
      await page.locator('[data-protocol-edit-step="1"]').click();
      assert(await page.locator('#protocolDialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), 'Protocol editor fits viewport');
      await page.screenshot({ path: `/tmp/peps-live-qa/cycle-${width}.png`, fullPage: true });
      await page.locator('[data-close-protocol]').click();
      for (const nav of ['calendar', 'progress', 'settings', 'dashboard']) {
        await page.locator(`.app-nav [data-nav="${nav}"]`).click();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${nav} fits ${width}px`);
      }
      // Exercise real encryption/save/reload against an in-memory HTTP fixture.
      await page.clock.runFor(1500);
      await page.waitForFunction(() => document.querySelector('#syncStatus').textContent === 'Synced');
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#unlockButtonText').textContent === 'Unlock');
      await page.locator('#passwordInput').fill('qa-only-private-password');
      await page.locator('#unlockForm button[type="submit"]').click();
      await page.locator('#authScreen').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => PepsCore.state.stack.length), 2);
      assert.equal(await page.evaluate(() => PepsCore.findPeptide('cycle-example').duration.onDays), 70);
      assert.equal(await page.evaluate(() => PepsCore.state.checkins['2026-10-17'].weight), 207);
      await page.locator('.app-nav [data-nav="settings"]').click();
      for (const id of ['cycle-example', 'ongoing-example']) await page.locator(`[data-remove-peptide="${id}"]`).click();
      assert.equal(await page.locator('#protocolDialog').isVisible(), false);
      assert.match(await page.locator('#stackList').textContent(), /Your stack is empty/);
      assert.equal(await page.locator('#newPeptideBtn').isVisible(), true);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS ${width}px: new account, add/edit cycle/fixed/ongoing protocols, summary, completion/undo, weight math, milestone review, deletion, encrypted reload, responsive views.`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
