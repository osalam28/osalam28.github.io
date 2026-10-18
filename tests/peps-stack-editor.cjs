const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
      await page.route('**/account-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.PepsAccountConfig = { enabled: false };' }));
      await page.goto(pathToFileURL(path.join(__dirname, '../peps/index.html')).href);
      await page.evaluate(() => {
        PepsCore.state.stack = [];
        for (const name of ['Alpha', 'Beta', 'Gamma']) {
          PepsCore.savePeptide({ id: name.toLowerCase(), name, powderMg: 10, bacMl: 2, doseAmount: 2, doseUnit: 'mg', frequency: 'daily', startDate: PepsCore.helpers.todayString() });
        }
        PepsCore.unlock = async () => ({ ok: true });
      });
      await page.locator('#passwordInput').fill('test-password');
      await page.locator('#unlockForm button[type=submit]').click();
      await page.locator('[data-nav=settings]').first().click();
      const removed = width === 390 ? 'alpha' : 'beta';
      await page.locator(`#stackList [data-edit-peptide="${removed}"]`).click();
      await page.locator('#deletePeptideBtn').click();
      const next = width === 390 ? 'beta' : 'gamma';
      assert.equal(await page.locator('#protocolDialog').isVisible(), false);
      assert.equal(await page.locator('#stackList').isVisible(), true);
      assert.equal(await page.locator('#stackList [data-edit-peptide]').count(), 2);
      await page.locator(`#stackList [data-edit-peptide="${next}"]`).click();
      await page.locator('#doseAmountInput').fill('2.5');
      await page.locator('[data-protocol-edit-step="4"]').click();
      await page.locator('#goalReviewChoice').selectOption('off');
      await page.locator('#savePeptideButton').click();
      assert.equal(await page.evaluate(id => PepsCore.findPeptide(id).doseAmount, next), 2.5);
      const remaining = await page.locator('#stackList [data-edit-peptide]').evaluateAll(buttons => buttons.map(button => button.dataset.editPeptide));
      for (const id of remaining) {
        await page.locator(`#stackList [data-edit-peptide="${id}"]`).click();
        assert.equal(await page.locator('#peptideIdInput').inputValue(), id);
        await page.locator('[data-close-protocol]').click();
      }
      await page.locator('#newPeptideBtn').click();
      assert.equal(await page.locator('#protocolWizard').isVisible(), true);
      await page.locator('#protocolCancelButton').click();
      assert.equal(await page.locator('#stackList').isVisible(), true);
      assert.equal(await page.locator('#protocolDialog').isVisible(), false);
      while (await page.locator('#stackList [data-edit-peptide]').count()) {
        await page.locator('#stackList [data-edit-peptide]').first().click();
        await page.locator('#deletePeptideBtn').click();
        if (await page.locator('#stackList [data-edit-peptide]').count()) assert.equal(await page.locator('#stackList').isVisible(), true);
      }
      assert.equal(await page.locator('#protocolDialog').isVisible(), false);
      assert.equal(await page.locator('#peptideIdInput').inputValue(), '');
      await page.locator('#newPeptideBtn').click();
      assert.equal(await page.locator('#protocolCancelButton').isVisible(), true);
      assert.equal(await page.locator('#peptideNameInput').isVisible(), true);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: mobile/desktop first and middle deletion, edit remaining entries, cancel setup, repeated deletion and intentional empty-stack setup.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
