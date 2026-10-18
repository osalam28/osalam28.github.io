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
  for (const file of ['state.js', 'titration.js', 'protocol.js', 'dose-plans.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../peps', file), 'utf8'), context);
  context.PepsRender = () => {};
  const core = context.PepsCore;
  const peptide = core.savePeptide({ id: 'test', name: 'Test', doseAmount: 2, doseUnit: 'mg', powderMg: 10, bacMl: 2, startDate: '2026-09-17', frequency: 'weekly', times: ['PM'], doseChanges: [{ date: '2026-09-17', amount: 2, unit: 'mg' }], titration: { enabled: true, cadenceDays: 28, increment: 1, maxDose: 6, nextReviewDate: '2026-10-15', decisions: [], plannedSteps: [] } });
  return { core, peptide, engine: context.PepsTitration, protocol: context.PepsProtocol, plans: context.PepsDosePlans, nodes };
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

test('preset stages switch on day eight, hold through day 56, and stop with the course', () => {
  const { core, plans, engine } = fixture();
  const peptide = core.savePeptide({ id: 'preset', startDate: '2026-10-01', endDate: '2026-11-25', duration: { mode: 'fixed' },
    frequency: 'daily', times: ['AM', 'PM'], doseAmount: 300, doseUnit: 'mcg', powderMg: 10, bacMl: 2,
    dosePlans: [{ effectiveDate: '2026-10-01', startDate: '2026-10-01', unit: 'mcg', repeat: 'restart', stages: [{ day: 1, amount: 300 }, { day: 8, amount: 500 }] }] });
  plans.validatePlan(peptide.dosePlans[0], peptide);
  assert.equal(core.doseForDate(peptide, '2026-10-07').amount, 300);
  assert.equal(core.doseForDate(peptide, '2026-10-08').amount, 500);
  assert.equal(core.plan('2026-10-08').tasks.find(t => t.peptideId === 'preset').units, 10);
  assert.equal(core.plan('2026-10-08').tasks.find(t => t.peptideId === 'preset').scheduledChange, 'Scheduled dose changes today');
  assert.equal(core.plan('2026-11-25').tasks.filter(t => t.peptideId === 'preset').length, 2);
  assert.equal(core.plan('2026-11-26').tasks.filter(t => t.peptideId === 'preset').length, 0);
  assert.equal(engine.details(peptide), null);
  assert.equal(core.reviewDue('2026-10-08').some(item => item.peptide.id === 'preset'), false);
  assert.deepEqual(Object.keys(core.completedForDate('2026-10-08')), []);
  core.replace(JSON.parse(JSON.stringify(core.state)));
  assert.equal(core.doseForDate(core.findPeptide('preset'), '2026-10-08').amount, 500);
});

test('preset stages repeat or resume final dose after automatic and confirmed breaks', () => {
  const { core } = fixture();
  const peptide = core.savePeptide({ id: 'cycled', startDate: '2026-10-01', frequency: 'daily', doseUnit: 'mcg', doseAmount: 300,
    duration: { mode: 'cycle', onDays: 56, offDays: 21, restart: 'auto', starts: [] },
    dosePlans: [{ effectiveDate: '2026-10-01', startDate: '2026-10-01', unit: 'mcg', repeat: 'restart', stages: [{ day: 1, amount: 300 }, { day: 8, amount: 500 }] }] });
  assert.equal(core.plan('2026-11-26').tasks.some(t => t.peptideId === peptide.id), false);
  assert.equal(core.doseForDate(peptide, '2026-12-17').amount, 300);
  assert.equal(core.doseForDate(peptide, '2026-12-24').amount, 500);
  peptide.dosePlans[0].repeat = 'final';
  assert.equal(core.doseForDate(peptide, '2026-12-17').amount, 500);
  peptide.duration.restart = 'confirm';
  assert.equal(core.plan('2026-12-17').tasks.some(t => t.peptideId === peptide.id), false);
  peptide.duration.starts = ['2026-12-20'];
  peptide.dosePlans[0].repeat = 'restart';
  assert.equal(core.doseForDate(peptide, '2026-12-20').amount, 300);
  assert.equal(core.doseForDate(peptide, '2026-12-27').amount, 500);
});

test('schedule revisions preserve history and cancellation retains the boundary dose', () => {
  const { core } = fixture();
  const peptide = core.savePeptide({ id: 'history', startDate: '2026-10-01', doseAmount: 300, doseUnit: 'mcg',
    doseChanges: [{ date: '2026-10-01', amount: 300, unit: 'mcg' }, { date: '2026-10-20', amount: 400, unit: 'mcg' }],
    dosePlans: [
      { effectiveDate: '2026-10-01', startDate: '2026-10-01', unit: 'mcg', stages: [{ day: 1, amount: 300 }, { day: 8, amount: 500 }] },
      { effectiveDate: '2026-10-16', startDate: '2026-10-01', unit: 'mcg', stages: [{ day: 1, amount: 300 }, { day: 8, amount: 450 }] },
      { effectiveDate: '2026-10-20', disabled: true }
    ] });
  assert.equal(core.doseForDate(peptide, '2026-10-15').amount, 500);
  assert.equal(core.doseForDate(peptide, '2026-10-16').amount, 450);
  assert.equal(core.doseForDate(peptide, '2026-10-20').amount, 400);
  core.addDoseChange({ peptideId: 'history', date: '2026-10-17', amount: 425, unit: 'mcg' });
  assert.equal(core.doseForDate(peptide, '2026-10-16').amount, 450);
  assert.equal(core.doseForDate(peptide, '2026-10-17').amount, 425);
  assert.equal(peptide.dosePlans.at(-1).disabled, true);
});

test('zero, fractional and negative cadence and malformed stages are rejected', () => {
  const { core, peptide, plans } = fixture();
  for (const cadenceDays of [0, -1, 1.5, 731, NaN])
    assert.throws(() => core.savePeptide({ ...peptide, titration: { ...peptide.titration, cadenceDays } }), /whole number/);
  for (const stages of [[{ day: 0, amount: 1 }, { day: 8, amount: 2 }], [{ day: 1, amount: 1 }, { day: 1, amount: 2 }], [{ day: 1, amount: 1 }, { day: 57, amount: 2 }], [{ day: 1, amount: 1 }, { day: 8, amount: 0 }]])
    assert.throws(() => plans.validatePlan({ stages }, { duration: { mode: 'cycle', onDays: 56 } }));
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

test('late confirmation keeps the full cadence instead of catching up to old dates', () => {
  const { peptide, engine } = fixture();
  peptide.titration.nextReviewDate = '2026-10-01';
  peptide.titration.plannedSteps = [{ date: '2026-10-01', amount: 3, unit: 'mg' }, { date: '2026-10-29', amount: 4, unit: 'mg' }];
  engine.decide('test', 'change', 3);
  assert.equal(peptide.titration.nextReviewDate, '2026-11-12');
  assert.equal(peptide.titration.plannedSteps[0].amount, 4);
});

test('reduction clamps to maintenance and ends further dose changes at the endpoint', () => {
  const { core, peptide, engine } = fixture();
  Object.assign(peptide.titration, { mode: 'decrease', increment: 1, targetDose: 1.5, maxDose: null });
  assert.equal(engine.details(peptide).suggested, 1.5);
  assert.throws(() => engine.decide('test', 'change', 1), /endpoint/);
  assert.throws(() => engine.decide('test', 'change', 3), /endpoint/);
  engine.decide('test', 'change', 1.5);
  assert.equal(peptide.titration.mode, 'maintain');
  assert.equal(peptide.titration.enabled, false);
  assert.equal(core.plan('2026-10-22').tasks.find(task => task.peptideId === 'test').amount, 1.5);
  assert.equal(engine.details(peptide), null);
});

test('planned stop requires confirmation and ends future injections without a zero-dose task', () => {
  const { core, peptide, engine, protocol } = fixture();
  Object.assign(peptide.titration, { mode: 'stop', increment: 3, targetDose: 0, maxDose: null });
  assert.equal(engine.details(peptide).suggested, 0);
  assert(core.plan('2026-10-22').tasks.some(task => task.peptideId === 'test'));
  engine.decide('test', 'change', 0);
  assert.equal(peptide.stoppedDate, '2026-10-15');
  assert.equal(peptide.titration.mode, 'stopped');
  assert(!peptide.doseChanges.some(change => change.amount === 0));
  assert(!core.plan('2026-10-22').tasks.some(task => task.peptideId === 'test'));
  assert(core.plan('2026-10-08').tasks.some(task => task.peptideId === 'test'));
  assert.equal(protocol.cycleStatus(peptide).phase, 'stopped');
});

test('planned stop preserves an injection already completed today', () => {
  const { core, peptide, engine } = fixture();
  Object.assign(peptide.titration, { mode: 'stop', increment: 3, targetDose: 0, maxDose: null });
  core.toggleDoseDone({ date: '2026-10-15', taskId: 'test-pm', done: true, doseLabel: '2 mg' });
  engine.decide('test', 'change', 0);
  assert.equal(peptide.stoppedDate, '2026-10-22');
  assert(core.plan('2026-10-15').tasks.some(task => task.peptideId === 'test'));
  assert(!core.plan('2026-10-22').tasks.some(task => task.peptideId === 'test'));
});

test('fixed courses include their last day and stop scheduling afterward', () => {
  const { core, peptide, protocol } = fixture();
  peptide.duration = { mode: 'fixed' };
  peptide.endDate = '2026-10-15';
  assert(core.plan('2026-10-15').tasks.some(task => task.peptideId === 'test'));
  assert(!core.plan('2026-10-22').tasks.some(task => task.peptideId === 'test'));
  assert.equal(protocol.cycleStatus(peptide, '2026-10-16').phase, 'complete');
});

test('automatic cycles exclude breaks and resume at the cycle boundary', () => {
  const { core, peptide, protocol } = fixture();
  peptide.duration = { mode: 'cycle', onDays: 14, offDays: 7, restart: 'auto', starts: [] };
  assert.equal(protocol.cycleStatus(peptide, '2026-09-24').label, 'Week 2 of 2');
  assert.equal(protocol.cycleStatus(peptide, '2026-10-01').phase, 'off');
  assert(!core.plan('2026-10-01').tasks.some(task => task.peptideId === 'test'));
  assert(core.plan('2026-10-08').tasks.some(task => task.peptideId === 'test'));
});

test('confirmation cycles remain paused until approved, then begin a full new cycle', () => {
  const { core, peptide, protocol } = fixture();
  peptide.duration = { mode: 'cycle', onDays: 14, offDays: 7, restart: 'confirm', starts: [] };
  assert.equal(protocol.cycleStatus(peptide).phase, 'pending');
  assert(!core.plan('2026-10-15').tasks.some(task => task.peptideId === 'test'));
  assert.equal(protocol.restart('test'), '2026-10-15');
  assert(core.plan('2026-10-15').tasks.some(task => task.peptideId === 'test'));
  assert.equal(protocol.cycleStatus(peptide, '2026-10-28').phase, 'on');
  assert.equal(protocol.cycleStatus(peptide, '2026-10-29').phase, 'off');
  assert(!core.plan('2026-10-08').tasks.some(task => task.peptideId === 'test'));
  assert.throws(() => protocol.restart('test'), /not waiting/);
});

test('goal tracking ignores blank weights, prompts at goal and never changes a protocol', () => {
  const { core, peptide, protocol } = fixture();
  core.state.checkins = { '2026-10-01': { weight: 250 }, '2026-10-08': { weight: null }, '2026-10-15': { weight: 240 } };
  peptide.goalReview = { enabled: true };
  protocol.setGoal(240);
  const before = JSON.stringify(peptide);
  assert.equal(protocol.goalInfo().reviewDue, true);
  assert.equal(protocol.goalInfo().percent, 100);
  assert.equal(JSON.stringify(peptide), before);
  assert.equal(core.helpers.weightRows().length, 2);
  protocol.recordGoalDecision(peptide.id, 'keep');
  assert.equal(protocol.goalInfo().reviewDue, false);
  protocol.setGoal(null);
  assert.equal(protocol.goalInfo(), null);
});

test('weight milestones are per peptide and independent of dose review cadence', () => {
  const { core, peptide, protocol, engine } = fixture();
  peptide.goalReview = { enabled: true };
  const second = core.savePeptide({ ...peptide, id: 'second', goalReview: { enabled: true } });
  const cadence = JSON.stringify(peptide.titration);
  core.state.checkins = { '2026-10-15': { weight: 200 } };
  protocol.setGoal(200);
  assert.equal(protocol.goalReviewStatus(peptide).due, true);
  assert.equal(protocol.goalReviewStatus(second).due, true);
  protocol.recordGoalDecision(peptide.id, 'keep');
  assert.equal(protocol.goalReviewStatus(peptide).due, false);
  assert.equal(protocol.goalReviewStatus(second).due, true);
  assert.equal(JSON.stringify(peptide.titration), cadence);
  assert.equal(engine.details(peptide).due, true);
  protocol.recordGoalDecision(second.id, 'later');
  assert.equal(second.goalReview.snoozedUntil, '2026-10-22');
  assert.equal(protocol.goalInfo().reviewDue, false);
  second.goalReview.snoozedUntil = '2026-10-15';
  assert.equal(protocol.goalReviewStatus(second).due, true);
  protocol.setGoal(190);
  assert.equal(protocol.goalReviewStatus(peptide).due, false);
  protocol.setGoal(200);
  assert.equal(protocol.goalReviewStatus(peptide).due, true, 'Changing the goal resets acknowledgements');
  const snapshot = JSON.parse(JSON.stringify(core.state));
  core.replace(snapshot);
  assert.equal(core.findPeptide('second').goalReview.enabled, true);
  assert.equal(protocol.goalReviewStatus(core.findPeptide('test')).due, true);
});

test('future weights and ineligible protocols do not trigger milestones', () => {
  const { core, peptide, protocol } = fixture();
  peptide.goalReview = { enabled: true };
  core.state.checkins = { '2026-10-14': { weight: 210 }, '2026-10-20': { weight: 190 } };
  protocol.setGoal(200);
  assert.equal(protocol.goalInfo().reached, false);
  core.state.checkins['2026-10-15'] = { weight: 200 };
  assert.equal(protocol.goalInfo().reviewDue, true);
  peptide.active = false;
  assert.equal(protocol.goalInfo().reviewDue, false);
  peptide.active = true;
  peptide.stoppedDate = '2026-10-15';
  assert.equal(protocol.goalInfo().reviewDue, false);
  peptide.stoppedDate = '';
  peptide.goalReview = null;
  assert.equal(protocol.goalReviewStatus(peptide).configured, false);
  assert.equal(protocol.goalInfo().reviewDue, false);
  peptide.goalReview = { enabled: false };
  assert.equal(protocol.goalInfo().reviewDue, false);
});

test('saving a peptide never creates a weight check-in from stale editor values', () => {
  const { core, peptide, nodes } = fixture();
  nodes.set('setupWeightInput', { value: '200' });
  nodes.set('setupGoalInput', { value: '180' });
  core.savePeptide({ ...peptide, id: 'second' });
  assert.equal(Object.keys(core.state.checkins).length, 0);
});

test('duration, goals, measurement status and stop dates survive reload normalization', () => {
  const { core, peptide, protocol } = fixture();
  peptide.duration = { mode: 'cycle', onDays: 56, offDays: 21, restart: 'confirm', starts: ['2026-12-03'] };
  peptide.measurementPending = true;
  peptide.stoppedDate = '2027-01-01';
  protocol.setGoal(220);
  core.replace(JSON.parse(JSON.stringify(core.state)));
  const loaded = core.findPeptide('test');
  assert.equal(loaded.duration.onDays, 56);
  assert.equal(loaded.duration.starts[0], '2026-12-03');
  assert.equal(loaded.measurementPending, true);
  assert.equal(loaded.stoppedDate, '2027-01-01');
  assert.equal(core.state.goals.weightGoal, 220);
});

test('missing measurement never provides an assumed unit value', () => {
  const { core, peptide } = fixture();
  peptide.measurementPending = true;
  const task = core.plan('2026-10-15').tasks.find(task => task.peptideId === 'test');
  assert.equal(task.units, null);
  assert.equal(task.measurementPending, true);
});

test('a future weekly restart is confirmed once and starts on the next scheduled weekday', () => {
  const { core, peptide, protocol } = fixture();
  peptide.startDate = '2026-09-16';
  peptide.duration = { mode: 'cycle', onDays: 14, offDays: 7, restart: 'confirm', starts: [] };
  assert.equal(protocol.restart('test'), '2026-10-21');
  assert.equal(protocol.cycleStatus(peptide).phase, 'awaiting');
  assert.throws(() => protocol.restart('test'), /not waiting/);
  assert(!core.plan('2026-10-15').tasks.some(task => task.peptideId === 'test'));
  assert(core.plan('2026-10-21').tasks.some(task => task.peptideId === 'test'));
});

test('weekly review defaults to the current dose and holding defers exactly seven days', () => {
  const { peptide, engine } = fixture();
  Object.assign(peptide.titration, { mode: 'review', increment: 0, cadenceDays: 7, maxDose: null });
  assert.equal(engine.details(peptide).suggested, 2);
  engine.decide('test', 'hold');
  assert.equal(peptide.titration.nextReviewDate, '2026-10-22');
  assert.equal(engine.details(peptide).due, false);
  assert.equal(engine.details(peptide, '2026-10-22').due, true);
});

test('weekly review accepts a user-entered change and does not create automatic increases', () => {
  const { core, peptide, engine } = fixture();
  Object.assign(peptide.titration, { mode: 'review', increment: 0, cadenceDays: 7, maxDose: null });
  engine.decide('test', 'change', 2.5);
  assert.equal(core.doseForDate(peptide, '2026-11-01').amount, 2.5);
  assert.equal(peptide.titration.nextReviewDate, '2026-10-22');
  assert.equal(engine.details(peptide, '2026-10-22').suggested, 2.5);
});

test('weight-only check-in preserves existing notes and review summaries contain no side effects', () => {
  const { core, peptide } = fixture();
  core.state.selectedDate = '2026-10-15';
  core.state.checkins['2026-10-15'] = { weight: 245, notes: 'Existing note', sideEffects: 'none', decision: 'hold' };
  core.saveCheckin({ weight: 244 });
  assert.equal(core.state.checkins['2026-10-15'].notes, 'Existing note');
  assert.equal(core.state.checkins['2026-10-15'].weight, 244);
  assert(!/side effects/i.test(core.snapshotForPeptide(peptide, '2026-10-15').summary));
});
