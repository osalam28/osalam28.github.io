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

test('protocol and inventory save together, rollback restores all state on failure', () => {
  const { core, inv } = fixture();
  const before = JSON.stringify(core.state);
  assert.throws(() => core.transaction(() => {
    const p = core.savePeptide({ id: 'new', name: 'New', doseAmount: 1, doseUnit: 'mg' });
    inv.applySetup({ source: 'new', powderMg: 10, unopened: 2, action: 'new', vial: { bacMl: 2, remainingMg: 10 } }, p);
    throw new Error('Later operation failed');
  }), /Later operation/);
  assert.equal(JSON.stringify(core.state), before);
  assert.throws(() => core.transaction(() => {
    const p = core.savePeptide({ id: 'new', name: 'New', doseAmount: 1, doseUnit: 'mg' });
    inv.applySetup({ source: 'new', powderMg: 10, unopened: 0, action: 'new', vial: {} }, p);
  }), /No unopened/);
  assert.equal(JSON.stringify(core.state), before);
});
test('new stock plus opening deducts once; later protocol edits preserve balances and usage', () => {
  const { core, inv } = fixture();
  const p = core.transaction(() => {
    const p = core.savePeptide({ id: 'new', name: 'New', doseAmount: 1, doseUnit: 'mg' });
    inv.applySetup({ source: 'new', powderMg: 10, unopened: 3, expiry: '2026-12-31', action: 'new', vial: { bacMl: 2, remainingMg: 10 } }, p);
    return p;
  });
  const item = inv.linked(p.id), before = JSON.stringify(item);
  assert.equal(item.unopened, 2);
  assert.equal(item.vials.length, 1);
  assert.equal(item.vials[0].expiry, '2026-12-31');
  inv.applySetup({ source: 'existing', itemId: item.id, action: 'keep' }, p);
  assert.equal(JSON.stringify(item), before);
  assert.equal(p.measurementPending, false);
  assert.equal(p.powderMg, 10);
  assert.equal(p.bacMl, 2);
});
test('setup links pre-opened inventory without decrement and keeps unknown balance unknown', () => {
  const { core, inv, item } = fixture();
  inv.saveItem({ ...item, peptideId: '' }, item.id);
  open(inv, item, '', false);
  const p = core.savePeptide({ id: 'new', name: 'New', doseAmount: 1 });
  inv.applySetup({ source: 'existing', itemId: item.id, action: 'keep' }, p);
  assert.equal(item.unopened, 2);
  assert.equal(item.vials.length, 1);
  assert.equal(inv.remaining(item, inv.activeVial(item)), null);
  assert.throws(() => inv.validateSetup({ source: 'later' }, p.id), /linked inventory/);
});
test('new stock can include a separately opened vial or no active vial without phantom usage', () => {
  const { core, inv } = fixture();
  const p = core.savePeptide({ id: 'new', name: 'New', doseAmount: 1 });
  inv.applySetup({ source: 'new', powderMg: 10, unopened: 0, action: 'opened', vial: { powderMg: 20, bacMl: '', remainingMg: '' } }, p);
  const item = inv.linked(p.id);
  assert.equal(item.unopened, 0);
  assert.equal(inv.remaining(item, inv.activeVial(item)), null);
  assert.equal(p.measurementPending, true);
  assert.equal(inv.entries(item).length, 0);
  const q = core.savePeptide({ id: 'no-vial', name: 'No vial', doseAmount: 1 });
  inv.applySetup({ source: 'new', powderMg: 10, unopened: 3, action: 'none' }, q);
  assert.equal(inv.linked(q.id).unopened, 3);
  assert.equal(inv.linked(q.id).vials.length, 0);
  assert.equal(q.measurementPending, true);
});
test('setup validates source, whole stock counts, vial availability and separate protocol ownership', () => {
  const { core, inv, item } = fixture();
  for (const unopened of ['', -1, 1.5]) assert.throws(() => inv.validateSetup({ source: 'new', powderMg: 10, unopened, action: 'none' }, 'new'), /whole number/);
  assert.throws(() => inv.validateSetup({}, 'new'), /Choose inventory/);
  assert.throws(() => inv.validateSetup({ source: 'existing', itemId: item.id, action: 'keep' }, 'new'), /available inventory/);
  assert.throws(() => inv.validateSetup({ source: 'existing', itemId: item.id, action: 'vial:missing' }, 'example'), /no longer available/);
  inv.validateSetup({ source: 'later' }, 'new');
  assert.equal(core.state.inventory.items.length, 1);
});

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

test('undo opening returns exactly one vial, preserves history and restores previous active vial', () => {
  const { core, inv, item } = fixture();
  const previous = open(inv, item, '', false), vial = open(inv, item);
  assert.equal(item.unopened, 1);
  assert.throws(() => inv.undoOpening(item.id, vial.id), /Confirm/);
  inv.undoOpening(item.id, vial.id, { unopened: true });
  assert.equal(item.unopened, 2);
  assert.equal(item.activeVialId, previous.id);
  assert.equal(vial.closed, true);
  assert.ok(vial.openingUndoneAt);
  assert.equal(inv.stock(item).knownMg, 80);
  assert.equal(item.vials.length, 2, 'Audit history is retained');
  assert.throws(() => inv.undoOpening(item.id, vial.id, { unopened: true }), /already/);
  assert.throws(() => inv.updateVial(item.id, vial.id, { remainingMg: 40, bacMl: 2, active: true }), /undone/);
  core.replace(JSON.parse(JSON.stringify(core.state)));
  assert.equal(inv.find(item.id).unopened, 2);
  assert.ok(inv.find(item.id).vials[1].openingUndoneAt);
});
test('undo refuses used, partial, separately added, and changed-strength vials', () => {
  const { core, inv, item } = fixture();
  const vial = open(inv, item);
  take(core);
  assert.throws(() => inv.undoOpening(item.id, vial.id, { unopened: true }), /Doses/);
  take(core, false);
  inv.updateVial(item.id, vial.id, { remainingMg: 30, bacMl: 2 });
  assert.throws(() => inv.undoOpening(item.id, vial.id, { unopened: true }), /partial/);
  inv.updateVial(item.id, vial.id, { remainingMg: 40, bacMl: 2 });
  item.powderMg = 50;
  assert.throws(() => inv.undoOpening(item.id, vial.id, { unopened: true }), /strength/);
  item.powderMg = 40;
  const separate = open(inv, item, 40, false);
  assert.throws(() => inv.undoOpening(item.id, separate.id, { unopened: true }), /separately/);
  assert.equal(item.unopened, 1);
});
test('legacy vial undo requires explicit confirmation of the stock deduction', () => {
  const { inv, item } = fixture();
  const vial = open(inv, item);
  delete vial.fromStock;
  assert.throws(() => inv.undoOpening(item.id, vial.id, { unopened: true }), /older entry/);
  inv.undoOpening(item.id, vial.id, { unopened: true, deducted: true });
  assert.equal(item.unopened, 2);
  assert.equal(item.corrections.at(-1).legacyConfirmed, true);
});
test('link existing inventory to protocol never opens or deducts a vial', () => {
  const { core, inv, item } = fixture();
  const vial = open(inv, item);
  inv.saveItem({ ...item, peptideId: '' }, item.id);
  const before = JSON.stringify(item.vials);
  inv.linkItem(item.id, 'example');
  assert.equal(item.unopened, 1);
  assert.equal(item.activeVialId, vial.id);
  assert.equal(JSON.stringify(item.vials), before);
  core.savePeptide({ id: 'different', name: 'Different' });
  assert.throws(() => inv.linkItem(item.id, 'different'), /already linked/);
});
