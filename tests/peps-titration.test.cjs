const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
  const nodes = new Map();
  const context = vm.createContext({
    console, Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-15T12:00:00'])); } },
    localStorage: { setItem() {} }, setTimeout, clearTimeout,
    CustomEvent: class {}, dispatchEvent() {}, PepsConfig: {},
    document: { addEventListener() {}, getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', innerHTML: '' });
      return nodes.get(id);
    } }
  });
  context.window = context;
  for (const file of ['state.js', 'titration.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../peps', file), 'utf8'), context);
  context.PepsRender = () => {};
  const core = context.PepsCore;
  const peptide = core.savePeptide({ id: 'test', name: 'Test', doseAmount: 2, doseUnit: 'mg', powderMg: 10, bacMl: 2, startDate: '2026-09-17', frequency: 'weekly', times: ['PM'], doseChanges: [{ date: '2026-09-17', amount: 2, unit: 'mg' }], titration: { enabled: true, cadenceDays: 28, increment: 1, maxDose: 6, nextReviewDate: '2026-10-15', decisions: [], plannedSteps: [] } });
  return { core, peptide, engine: context.PepsTitration, nodes };
}

test('configured cadence survives save, and overdue review stays pending without changing dose', () => {
  const { core, peptide, engine } = fixture();
  assert.equal(peptide.titration.cadenceDays, 28);
  assert.equal(engine.details(peptide, '2026-10-14').due, false);
  assert.equal(engine.details(peptide, '2026-10-15').due, true);
  assert.equal(engine.details(peptide, '2026-11-01').due, true);
  assert.equal(core.doseForDate(peptide, '2026-11-01').amount, 2);
  assert.equal(core.reviewDue('2026-10-15').some(item => item.peptide.id === 'test'), false);
});

test('confirmation changes dose and units, then resets cadence', () => {
  const { core, peptide, engine } = fixture();
  engine.decide('test', 'change', 3);
  assert.equal(core.doseForDate(peptide, '2026-10-15').amount, 3);
  assert.equal(core.unitsForDose(peptide, 3, 'mg'), 60);
  assert.equal(peptide.titration.nextReviewDate, '2026-11-12');
  assert.equal(engine.details(peptide).due, false);
  assert.throws(() => engine.decide('test', 'change', 4), /no longer due/);
});

test('hold preserves dose, records decision and defers review', () => {
  const { core, peptide, engine } = fixture();
  engine.decide('test', 'hold');
  assert.equal(core.doseForDate(peptide, '2026-10-15').amount, 2);
  assert.equal(peptide.titration.nextReviewDate, '2026-11-12');
  assert.equal(peptide.titration.decisions[0].choice, 'hold');
});

test('custom lower dose is allowed, invalid amounts and amounts above plan limit are rejected', () => {
  const { core, peptide, engine } = fixture();
  for (const value of [0, -1, NaN, Infinity, 7]) assert.throws(() => engine.decide('test', 'change', value));
  engine.decide('test', 'change', 1.5);
  assert.equal(core.doseForDate(peptide, '2026-10-15').amount, 1.5);
});

test('completed injection is preserved; change starts on next scheduled injection', () => {
  const { core, peptide, engine } = fixture();
  core.toggleDoseDone({ date: '2026-10-15', taskId: 'test-pm', done: true, doseLabel: '2 mg' });
  engine.decide('test', 'change', 3);
  assert.equal(core.doseForDate(peptide, '2026-10-15').amount, 2);
  assert.equal(core.doseForDate(peptide, '2026-10-22').amount, 3);
  assert.equal(peptide.titration.nextReviewDate, '2026-11-19');
  assert.equal(core.completedForDate('2026-10-15')['test-pm'].doseLabel, '2 mg');
});

test('legacy future steps become pending plan, preserve historical doses and stop automatic increases', () => {
  const { core, engine } = fixture();
  const peptide = core.savePeptide({ id: 'legacy', name: 'Legacy', startDate: '2026-10-01', frequency: 'weekly', doseAmount: 2, reviewEveryDays: 28, stepAmount: 1, doseChanges: [{ date: '2026-10-01', amount: 2, unit: 'mg' }, { date: '2026-10-29', amount: 3, unit: 'mg' }, { date: '2026-11-26', amount: 4, unit: 'mg' }] });
  engine.migratePlans();
  assert.equal(peptide.titration.nextReviewDate, '2026-10-29');
  assert.equal(peptide.titration.plannedSteps.length, 2);
  assert.equal(core.doseForDate(peptide, '2026-12-01').amount, 2);
  engine.migratePlans();
  assert.equal(peptide.titration.plannedSteps.length, 2);
});

test('suggested increment stops at the saved limit and supports mcg', () => {
  const { peptide, engine } = fixture();
  peptide.titration.maxDose = 2.5;
  assert.equal(engine.details(peptide).suggested, 2.5);
  peptide.doseChanges[0].unit = 'mcg';
  peptide.doseChanges[0].amount = 250;
  peptide.titration.increment = 50;
  peptide.titration.maxDose = 500;
  assert.equal(engine.details(peptide).suggested, 300);
});

test('saving protocol retains titration state through normalization', () => {
  const { core, peptide } = fixture();
  core.replace(JSON.parse(JSON.stringify(core.state)));
  assert.equal(core.findPeptide(peptide.id).titration.increment, 1);
  assert.equal(core.findPeptide(peptide.id).titration.nextReviewDate, '2026-10-15');
});

test('ad hoc changes reset cadence and cancel the old planned sequence', () => {
  const { core, peptide } = fixture();
  peptide.titration.plannedSteps = [{ date: '2026-11-12', amount: 3, unit: 'mg' }];
  core.addDoseChange({ peptideId: 'test', date: '2026-10-16', amount: 2.5, unit: 'mg' });
  assert.equal(peptide.titration.nextReviewDate, '2026-11-13');
  assert.equal(peptide.titration.plannedSteps.length, 0);
});

test('disabling the plan removes legacy review prompts', () => {
  const { core, peptide, engine } = fixture();
  const updated = core.savePeptide({ ...peptide, titration: { ...peptide.titration, enabled: false } });
  assert.equal(engine.details(updated), null);
  assert.equal(updated.reviewEveryDays, '');
});

test('calendar includes planned review and carries an overdue review into today', () => {
  const { core, peptide } = fixture();
  assert(core.plan('2026-10-15').events.some(event => event.label === 'Test dose check-in'));
  peptide.titration.nextReviewDate = '2026-10-10';
  assert(core.plan('2026-10-15').events.some(event => event.label === 'Test dose check-in'));
});

test('future start preserves starting dose and does not treat it as the first increase', () => {
  const { core, engine } = fixture();
  const peptide = core.savePeptide({ id: 'future', startDate: '2026-11-01', doseAmount: 1, doseUnit: 'mg', frequency: 'weekly', doseChanges: [{ date: '2026-11-01', amount: 1, unit: 'mg' }], titration: { enabled: true, cadenceDays: 28, increment: 0.5, nextReviewDate: '2026-11-29', plannedSteps: [] } });
  assert.equal(peptide.doseChanges.length, 1);
  assert.equal(peptide.titration.plannedSteps.length, 0);
  assert.equal(engine.details(peptide, '2026-11-29').suggested, 1.5);
});
