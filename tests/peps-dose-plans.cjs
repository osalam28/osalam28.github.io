const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
async function next(page) { await page.locator('#protocolNextButton').click(); }
async function start(page, name, duration) {
  await page.locator('.app-nav [data-nav="settings"]').click();
  await page.locator('#newPeptideBtn').click();
  await page.locator('#peptideNameInput').fill(name);
  await page.locator('#doseUnitInput').selectOption('mcg');
  await page.locator('#doseAmountInput').fill('300');
  await page.locator('#startDateInput').fill('2026-10-10');
  await next(page);
  await page.locator(`[name="durationChoice"][value="${duration}"]`).check();
  if (duration === 'fixed') await page.locator('#courseWeeksInput').fill('8');
  if (duration === 'cycle') {
    await page.locator('#cycleOnWeeks').fill('8');
    await page.locator('#cycleOffWeeks').fill('3');
    await page.locator('#cycleRestartMode').selectOption('auto');
  }
  await next(page);
  await page.locator('#setupStockSource').selectOption('later');
  await page.locator('#measurementMode').selectOption('mixed');
  await page.locator('#powderMgInput').fill('10');
  await page.locator('#bacMlInput').fill('2');
  await next(page);
}
async function save(page) {
  await next(page);
  await page.locator('#goalReviewChoice').selectOption('off');
  await page.locator('#savePeptideButton').click();
  assert.equal(await page.locator('#protocolDialog').isVisible(), false);
}
async function edit(page, id) {
  await page.locator('.app-nav [data-nav="settings"]').click();
  await page.locator(`#stackList [data-edit-peptide="${id}"]`).click();
  await page.locator('[data-protocol-edit-step="3"]').click();
}
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try {
      const body = file.endsWith('/account-config.js') ? 'window.PepsAccountConfig = {enabled:false};' : fs.readFileSync(file);
      res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(file)] || 'text/plain');
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 320, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, timezoneId: 'America/Los_Angeles' });
      const rows = new Map(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: new Date('2026-10-17T12:00:00-07:00') });
      await page.route('**/rest/v1/**', async route => {
        const request = route.request();
        if (request.method() === 'POST') { const row = request.postDataJSON(); rows.set(row.id, row); await route.fulfill({ status: 204 }); }
        else { const id = new URL(request.url()).searchParams.get('id')?.replace(/^eq\./, ''); await route.fulfill({ json: rows.has(id) ? [rows.get(id)] : [] }); }
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/peps/`);
      await page.waitForFunction(() => document.querySelector('#unlockButtonText').textContent === 'Create private password');
      await page.locator('#passwordInput').fill('synthetic-plan-test');
      await page.locator('#unlockForm button[type="submit"]').click();
      await page.locator('#firstVisitWelcome').waitFor({ state: 'visible' });
      await start(page, 'Preset example', 'fixed');
      await page.locator('#dosePlanKind').selectOption('preset');
      await page.locator('[data-stage-dose]').nth(1).fill('500');
      await page.locator('[data-stage-day]').nth(1).fill('0');
      await next(page);
      assert.match(await page.locator('#protocolError').textContent(), /Stage days/);
      await page.locator('[data-stage-day]').nth(1).fill('57');
      await next(page);
      assert.match(await page.locator('#protocolError').textContent(), /Stage days/);
      await page.locator('[data-stage-day]').nth(1).fill('8');
      assert.match(await page.locator('#presetPreview').textContent(), /Day 1-7: 300 mcg.*Day 8-56: 500 mcg/);
      assert.equal(await page.locator('#titrationNextDate').isVisible(), false);
      await page.screenshot({ path: `/tmp/peps-preset-${width}.png`, fullPage: true });
      await save(page);
      await page.locator('.app-nav [data-nav="dashboard"]').click();
      assert.match(await page.locator('#todayCards').textContent(), /500 mcg/);
      assert.equal(await page.locator('.scheduled-change').count() > 0, true);
      assert.equal(await page.locator('#titrationSection').isVisible(), false);
      assert.equal(await page.evaluate(() => PepsCore.doseForDate(PepsCore.findPeptide('preset-example'), '2026-10-16').amount), 300);
      await page.evaluate(() => PepsCore.toggleDoseDone({ date:'2026-10-17', taskId:'preset-example-am', done:true, doseLabel:'500 mcg' }));
      await edit(page, 'preset-example');
      assert.equal(await page.locator('#dosePlanKind').inputValue(), 'preset');
      assert.equal(await page.locator('#planEffectiveDate').inputValue(), '2026-10-18');
      await page.locator('[data-stage-dose]').nth(1).fill('450');
      await save(page);
      assert.equal(await page.evaluate(() => PepsCore.doseForDate(PepsCore.findPeptide('preset-example'), '2026-10-17').amount), 500);
      assert.equal(await page.evaluate(() => PepsCore.doseForDate(PepsCore.findPeptide('preset-example'), '2026-10-18').amount), 450);
      await start(page, 'Review example', 'ongoing');
      await page.locator('#dosePlanKind').selectOption('review');
      assert.equal(await page.locator('#titrationCadence').inputValue(), '7');
      await page.locator('#titrationCadence').fill('0');
      assert.doesNotMatch(await page.locator('#titrationPreview').textContent(), /every 0/);
      await next(page);
      assert.match(await page.locator('#protocolError').textContent(), /1 to 730/);
      await page.locator('#titrationCadence').fill('7');
      await page.screenshot({ path: `/tmp/peps-review-${width}.png`, fullPage: true });
      await save(page);
      assert.equal(await page.evaluate(() => PepsCore.findPeptide('review-example').titration.cadenceDays), 7);
      assert.equal(await page.evaluate(() => PepsCore.doseForDate(PepsCore.findPeptide('review-example'), '2026-12-01').amount), 300);
      await edit(page, 'review-example');
      await page.locator('#titrationCadence').fill('14');
      await save(page);
      assert.equal(await page.evaluate(() => PepsCore.findPeptide('review-example').titration.cadenceDays), 14);
      await edit(page, 'review-example');
      await page.locator('#dosePlanKind').selectOption('preset');
      await page.locator('[data-stage-dose]').nth(1).fill('500');
      await save(page);
      assert.equal(await page.evaluate(() => PepsCore.findPeptide('review-example').titration), null);
      await edit(page, 'preset-example');
      await page.locator('#dosePlanKind').selectOption('review');
      await save(page);
      assert.equal(await page.evaluate(() => PepsCore.findPeptide('preset-example').dosePlans.at(-1).disabled), true);
      assert.equal(await page.evaluate(() => PepsCore.doseForDate(PepsCore.findPeptide('preset-example'), '2026-10-17').amount), 500);
      await start(page, 'Cycle example', 'cycle');
      await page.locator('#dosePlanKind').selectOption('preset');
      await page.locator('[data-stage-dose]').nth(1).fill('500');
      await page.locator('#presetRepeat').selectOption('final');
      await page.locator('#addPresetStage').click();
      await page.locator('[data-remove-stage="2"]').click();
      await save(page);
      assert.equal(await page.evaluate(() => PepsCore.doseForDate(PepsCore.findPeptide('cycle-example'), '2026-12-26').amount), 500);
      await edit(page, 'cycle-example');
      await page.locator('#presetRepeat').selectOption('restart');
      await save(page);
      assert.equal(await page.evaluate(() => PepsCore.doseForDate(PepsCore.findPeptide('cycle-example'), '2026-12-26').amount), 300);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.clock.runFor(1500);
      await page.waitForFunction(() => document.querySelector('#syncStatus').textContent === 'Synced');
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#unlockButtonText').textContent === 'Unlock');
      await page.locator('#passwordInput').fill('synthetic-plan-test');
      await page.locator('#unlockForm button[type="submit"]').click();
      await page.locator('#authScreen').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => PepsCore.findPeptide('cycle-example').dosePlans.at(-1).repeat), 'restart');
      assert.equal(await page.evaluate(() => PepsCore.findPeptide('preset-example').dosePlans.at(-1).disabled), true);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS ${width}px: preset/review add and edit, invalid days, historical doses, mode switches, cycle repeat modes, encrypted reload`);
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
