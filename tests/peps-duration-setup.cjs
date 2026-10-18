const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const existing of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
      await page.route('**/account-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.PepsAccountConfig = { enabled: false };' }));
      await page.goto(pathToFileURL(path.join(__dirname, '../peps/index.html')).href);
      await page.evaluate(existing => {
        PepsCore.state.stack = [];
        if (existing) PepsCore.savePeptide({ id: 'existing', name: 'Existing', powderMg: 10, bacMl: 2, doseAmount: 1, doseUnit: 'mg', frequency: 'daily', startDate: PepsCore.helpers.todayString() });
        PepsCore.unlock = async () => ({ ok: true });
      }, existing);
      await page.locator('#passwordInput').fill('preview-test');
      await page.locator('#unlockForm button[type="submit"]').click();
      await page.locator('[data-nav="settings"]').first().click();
      await page.locator('#newPeptideBtn').click();
      await page.locator('#peptideNameInput').fill('Cycle test');
      await page.locator('#doseAmountInput').fill('1');
      await page.locator('#protocolNextButton').click();
      assert.match(await page.locator('#protocolStepLabel').textContent(), /Step 2/);
      assert.equal(await page.locator('#durationMode').inputValue(), '');
      await page.locator('#protocolNextButton').click();
      assert.match(await page.locator('#protocolStepLabel').textContent(), /Step 2/);
      await page.locator('[name="durationChoice"][value="cycle"]').check();
      await page.locator('#cycleOnWeeks').fill('8');
      await page.locator('#protocolNextButton').click();
      assert.match(await page.locator('#protocolStepLabel').textContent(), /Step 2/);
      await page.locator('#cycleOffWeeks').fill('3');
      await page.locator('#protocolNextButton').click();
      await page.locator('#measurementMode').selectOption('later');
      await page.locator('#protocolNextButton').click();
      await page.locator('#dosePlanKind').selectOption('steady');
      await page.locator('#protocolNextButton').click();
      assert.match(await page.locator('#protocolSummary').textContent(), /8 weeks on \/ 3 weeks off/);
      await page.locator('#goalReviewChoice').selectOption('off');
      await page.locator('#savePeptideButton').click();
      const duration = await page.evaluate(() => PepsCore.state.stack.find(p => p.name === 'Cycle test').duration);
      assert.equal(duration.mode, 'cycle');
      assert.equal(duration.onDays, 56);
      assert.equal(duration.offDays, 21);
      assert.equal(duration.restart, 'confirm');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: first peptide and additional peptide require an explicit duration; cycle lengths validate and persist.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
