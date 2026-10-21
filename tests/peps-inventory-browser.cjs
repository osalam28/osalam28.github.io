const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
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
    for (const width of [320, 390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, timezoneId: 'America/Los_Angeles' });
      const rows = new Map(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: new Date('2026-10-21T12:00:00-07:00') });
      await page.route('**/rest/v1/**', async route => {
        const request = route.request();
        if (request.method() === 'POST') { const row = request.postDataJSON(); rows.set(row.id, row); await route.fulfill({ status: 204 }); }
        else { const id = new URL(request.url()).searchParams.get('id')?.replace(/^eq\./, ''); await route.fulfill({ json: rows.has(id) ? [rows.get(id)] : [] }); }
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/peps/`);
      await page.waitForFunction(() => document.querySelector('#unlockButtonText').textContent === 'Create private password');
      await page.locator('#passwordInput').fill('synthetic-inventory');
      await page.locator('#unlockForm button[type="submit"]').click();
      await page.locator('#authScreen').waitFor({ state: 'hidden' });
      // Synthetic fixture only. Production inventories are entered through the signed-in UI.
      await page.evaluate(() => { PepsCore.savePeptide({ id: 'example', name: 'Example peptide', startDate: '2026-10-21', frequency: 'weekly', doseAmount: 8, doseUnit: 'mg', times: ['PM'], powderMg: 40, bacMl: 2 }); PepsRender(); });
      await page.locator('.app-nav [data-nav="inventory"]').click();
      await page.locator('#inventoryAdd').click();
      await page.locator('#invProtocol').selectOption('example');
      assert.equal(await page.locator('#invName').inputValue(), 'Example peptide');
      await page.locator('#invCount').fill('2');
      await page.locator('#inventorySave').click();
      assert.match(await page.locator('#inventoryList').textContent(), /10 full doses.*10 weeks/s);
      await page.locator('[data-inventory-detail] summary').click();
      await page.locator('[data-inventory-action="new-vial"]').click();
      assert.equal(await page.locator('#invRemaining').inputValue(), '40');
      await page.locator('#inventorySave').click();
      assert.match(await page.locator('#inventoryList').textContent(), /1 unopened/);
      await page.locator('.app-nav [data-nav="dashboard"]').click();
      await page.locator('#todayCards [data-dose-toggle]').click();
      await page.locator('.app-nav [data-nav="inventory"]').click();
      assert.match(await page.locator('#inventoryList').textContent(), /32 mg remaining/);
      await page.locator('.app-nav [data-nav="dashboard"]').click();
      await page.locator('#todayCards [data-dose-toggle]').click();
      await page.locator('.app-nav [data-nav="inventory"]').click();
      assert.match(await page.locator('#inventoryList').textContent(), /40 mg remaining/);
      await page.locator('[data-inventory-action="existing-vial"]').click();
      assert.equal(await page.locator('#invRemaining').inputValue(), '');
      await page.screenshot({ path: `/tmp/peps-inventory-vial-${width}.png`, fullPage: true });
      await page.locator('#inventorySave').click();
      assert.match(await page.locator('#inventoryList').textContent(), /unknown remaining amount; excluded/);
      await page.evaluate(() => { PepsCore.addDoseChange({ peptideId: 'example', date: '2026-10-21', amount: 10, unit: 'mg' }); PepsRender(); });
      assert.match(await page.locator('#inventoryList').textContent(), /8 full doses.*8 weeks/s);
      await page.locator('[data-inventory-action="stock"]').click();
      await page.locator('#invLowDays').fill('60');
      await page.locator('#inventorySave').click();
      await page.locator('.app-nav [data-nav="dashboard"]').click();
      assert.equal(await page.locator('#inventoryAlerts button').count(), 1);
      await page.locator('#inventoryAlerts button').click();
      assert.equal(await page.locator('#view-inventory').isVisible(), true);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `/tmp/peps-inventory-${width}.png`, fullPage: true });
      await page.evaluate(() => PepsCore.flush());
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#unlockButtonText').textContent === 'Unlock');
      await page.locator('#passwordInput').fill('synthetic-inventory');
      await page.locator('#unlockForm button[type="submit"]').click();
      await page.locator('#authScreen').waitFor({ state: 'hidden' });
      await page.locator('.app-nav [data-nav="inventory"]').click();
      assert.match(await page.locator('#inventoryList').textContent(), /8 full doses/);
      assert.equal(await page.evaluate(() => PepsCore.state.inventory.items[0].vials.length), 2);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS ${width}px inventory: create, vial start, taken/undo, unknown quantity, dose change, alerts, encrypted reload, no overflow`);
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
