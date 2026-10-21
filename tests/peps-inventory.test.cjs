const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto').webcrypto;

function fixture(options = {}) {
  const context = vm.createContext({ console, crypto,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-21T12:00:00'])); } },
    localStorage: { setItem() {} }, setTimeout, clearTimeout, CustomEvent: class {}, dispatchEvent() {}, PepsConfig: {},
    PepsAccountConfig: { enabled: true }, document: { addEventListener() {}, getElementById() { return { value: '' }; } } });
  context.window = context;
  for (const file of ['state.js', 'titration.js', 'protocol.js', 'dose-plans.js', 'inventory.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../peps', file), 'utf8'), context);
  const core = context.PepsCore, inv = context.PepsInventory;
  const peptide = core.savePeptide({ id: 'example', name: 'Example', startDate: '2026-10-21', frequency: 'weekly', doseAmount: 8, doseUnit: 'mg', times: ['PM'], powderMg: 40, bacMl: 2, ...options });
  const item = inv.saveItem({ name: 'Example', peptideId: peptide.id, powderMg: 40, unopened: 2, lowDays: 14 });
  return { core, inv, peptide, item };
}
const take = (core, done = true, time = 'pm', date = '2026-10-21') => core.toggleDoseDone({ date, taskId: `example-${time}`, done });
const open = (inv, item, remainingMg = 40, fromStock = true) => inv.openVial(item.id, { powderMg: 40, bacMl: 2, remainingMg }, fromStock);

test('forecast recomputes current dose, frequency and stock rather than caching original supply', () => {
  const { core, inv, peptide, item } = fixture();
  assert.equal(inv.forecast(item).doses, 10);
  assert.equal(inv.forecast(item).days, 70);
  core.addDoseChange({ peptideId: peptide.id, date: '2026-10-21', amount: 10, unit: 'mg' });
  assert.equal(inv.forecast(item).doses, 8);
  assert.equal(inv.forecast(item).days, 56);
  peptide.frequency = 'daily';
  assert.equal(inv.forecast(item).days, 8);
});
test('taken is idempotent, undo restores actual amount, no deduction from unopened count', () => {
  const { core, inv, peptide, item } = fixture();
  const vial = open(inv, item);
  assert.equal(item.unopened, 1);
  take(core); take(core);
  assert.equal(inv.remaining(item, vial), 32);
  core.addDoseChange({ peptideId: peptide.id, date: '2026-10-21', amount: 10, unit: 'mg' });
  take(core, false);
  assert.equal(inv.remaining(item, vial), 40);
  assert.equal(item.unopened, 1);
});
test('unknown open balance stays unknown and does not inflate known supply', () => {
  const { core, inv, item } = fixture();
  const vial = open(inv, item, '', false);
  assert.equal(inv.forecast(item).knownMg, 80);
  take(core);
  assert.equal(inv.remaining(item, vial), null);
  assert.equal(inv.forecast(item).knownMg, 80);
  assert.equal(inv.forecast(item).unknown.length, 1);
});
test('existing completed doses are a baseline, not deducted a second time', () => {
  const { core, inv, item } = fixture();
  take(core);
  inv.saveItem({ ...item, peptideId: '' }, item.id);
  inv.saveItem({ ...item, peptideId: 'example' }, item.id);
  const vial = open(inv, item);
  take(core, false); take(core);
  assert.equal(inv.remaining(item, vial), 40);
});
test('mcg conversion and two daily pulls have exact balances', () => {
  const { core, inv, item } = fixture({ doseAmount: 250, doseUnit: 'mcg', frequency: 'daily', times: ['AM', 'PM'] });
  const vial = open(inv, item, 8.5, false);
  take(core, true, 'am'); take(core, true, 'pm');
  assert.equal(inv.remaining(item, vial), 8);
  take(core, false, 'am');
  assert.equal(inv.remaining(item, vial), 8.25);
});
test('cycle breaks and fixed end dates bound projections', () => {
  const { inv, peptide, item } = fixture({ frequency: 'daily', doseAmount: 10,
    duration: { mode: 'cycle', onDays: 7, offDays: 7, restart: 'auto' } });
  assert.equal(inv.forecast(item).days, 15);
  peptide.duration.restart = 'confirm';
  assert.equal(inv.forecast(item).status, 'covered');
  peptide.duration = { mode: 'fixed' }; peptide.endDate = '2026-10-24';
  assert.equal(inv.forecast(item).status, 'covered');
});
test('future planned doses are not assumed in the current-dose estimate', () => {
  const { inv, peptide, item } = fixture();
  peptide.dosePlans = [{ effectiveDate: '2026-10-21', startDate: '2026-10-21', unit: 'mg', stages: [{ day: 1, amount: 8 }, { day: 8, amount: 10 }] }];
  assert.equal(inv.forecast(item).doses, 10);
  assert.equal(inv.forecast(item, '2026-10-28').doses, 8);
});
test('inventory-only, paused, stopped and deleted protocols do not invent consumption', () => {
  const { core, inv, peptide, item } = fixture();
  peptide.active = false; assert.equal(inv.forecast(item).status, 'unscheduled');
  peptide.active = true; peptide.stoppedDate = '2026-10-21';
  assert.equal(inv.forecast(item).status, 'unscheduled');
  core.deletePeptide(peptide.id); assert.equal(inv.forecast(item).status, 'unscheduled');
  assert.equal(inv.forecast(item).knownMg, 80);
});
test('unassigned usage is conservative, assign and undo reconcile without double debit', () => {
  const { core, inv, item } = fixture();
  take(core);
  assert.equal(inv.stock(item).knownMg, 72);
  assert.equal(inv.stock(item).unassignedMg, 8);
  const vial = open(inv, item);
  inv.assignUsage('2026-10-21|example-pm', vial.id);
  assert.equal(inv.stock(item).knownMg, 72);
  assert.equal(inv.remaining(item, vial), 32);
  take(core, false); assert.equal(inv.stock(item).knownMg, 80);
});
test('new concentration changes upcoming units without rewriting completed pull', () => {
  const { core, inv, item } = fixture();
  const vial = open(inv, item);
  assert.equal(core.plan('2026-10-21').tasks[0].units, 40);
  take(core);
  inv.updateVial(item.id, vial.id, { remainingMg: 32, bacMl: 4, active: true });
  assert.equal(core.plan('2026-10-21').tasks[0].units, 40);
  assert.equal(core.plan('2026-10-28').tasks[0].units, 80);
});
test('corrections, expiry, overdrawn vials and undo are accounted for', () => {
  const { core, inv, item } = fixture();
  const vial = open(inv, item, 4, false);
  take(core); assert.equal(inv.stock(item).overdrawnMg, 4);
  assert.equal(inv.stock(item).knownMg, 76);
  inv.updateVial(item.id, vial.id, { remainingMg: 20, bacMl: 2 });
  assert.equal(inv.remaining(item, vial), 20);
  take(core, false); assert.equal(inv.remaining(item, vial), 28);
  item.expiry = '2026-10-20'; assert.equal(inv.stock(item).knownMg, 28);
  vial.expiry = '2026-10-20'; assert.equal(inv.stock(item).knownMg, 0);
});
test('a future expiration limits coverage; missing expiry is never invented', () => {
  const { inv, item } = fixture();
  item.expiry = '2026-10-22';
  assert.equal(inv.forecast(item).days, 7);
  item.expiry = ''; assert.equal(inv.forecast(item).days, 70);
});
test('round trip preserves inventory and a separate starter has no seeded personal stock', () => {
  const { core, inv, item } = fixture();
  open(inv, item); take(core);
  const before = JSON.stringify(core.state.inventory);
  core.replace(JSON.parse(JSON.stringify(core.state)));
  assert.equal(JSON.stringify(core.state.inventory), before);
  assert.equal(core.starterState('different-user').inventory.items.length, 0);
  const state = core.starterState('different-user'); core.replace(state);
  assert.equal(core.state.inventory.items.length, 0);
  assert.equal(Object.keys(core.state.inventory.usage).length, 0);
});
test('invalid stock quantities and duplicate protocol links are rejected without mutation', () => {
  const { inv, item } = fixture();
  assert.throws(() => inv.saveItem({ ...item, unopened: -1 }, item.id), /whole number/);
  assert.throws(() => inv.saveItem({ ...item, unopened: 1.5 }, item.id), /whole number/);
  assert.throws(() => inv.saveItem({ ...item }), /already has/);
  assert.throws(() => open(inv, item, 50), /Remaining/);
  assert.equal(item.unopened, 2);
});
