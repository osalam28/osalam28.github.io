(function () {
  "use strict";
  const core = window.PepsCore, h = core.helpers;
  const id = () => crypto.randomUUID();
  const number = (value) => value !== "" && value != null && Number.isFinite(Number(value));
  const nonnegative = (value) => number(value) && Number(value) >= 0;
  const positive = (value) => number(value) && Number(value) > 0;
  const round = (value) => Math.round(value * 1e6) / 1e6;
  const add = (date, days) => h.dateStr(h.addDays(h.parseDate(date), days));
  const dateValid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && h.dateStr(h.parseDate(value)) === value;
  const mg = (amount, unit) => Number(amount) / (unit === "mcg" ? 1000 : 1);
  function normalize(raw) {
    if (!raw || typeof raw !== "object") return { version: 1, items: [], usage: {} };
    return {
      version: 1,
      items: (Array.isArray(raw.items) ? raw.items : []).filter(item => item && item.id && positive(item.powderMg) && nonnegative(item.unopened)).map(item => ({
        ...item, unopened: Math.floor(Number(item.unopened)), powderMg: Number(item.powderMg),
        vials: Array.isArray(item.vials) ? item.vials.filter(v => v && v.id && positive(v.powderMg)) : [],
        baselineKeys: Array.isArray(item.baselineKeys) ? item.baselineKeys : [],
        corrections: Array.isArray(item.corrections) ? item.corrections : [],
      })),
      usage: Object.fromEntries(Object.entries(raw.usage || {}).filter(([, entry]) => entry && positive(entry.amountMg) && entry.itemId)),
    };
  }
  const data = () => (core.state.inventory ||= normalize());
  const find = (key) => data().items.find(item => item.id === key);
  const entries = (item) => Object.entries(data().usage).filter(([, row]) => row.itemId === item.id);
  const used = (item, vial) => entries(item).filter(([, row]) => row.vialId === vial.id).reduce((sum, [, row]) => sum + row.amountMg, 0);
  const remaining = (item, vial) => vial.initialMg == null ? null : round(vial.initialMg - used(item, vial));
  const activeVial = (item) => item.vials.find(vial => vial.id === item.activeVialId && !vial.closed) || null;
  const linked = (peptideId) => data().items.find(item => !item.archived && item.peptideId === peptideId);
  function saveItem(input, key) {
    const existing = key ? find(key) : null;
    if (key && !existing) throw new Error("Stock item not found.");
    const name = String(input.name || "").trim();
    if (!name || name.length > 100) throw new Error("Enter a peptide name (up to 100 characters).");
    if (!positive(input.powderMg) || Number(input.powderMg) > 100000) throw new Error("Enter a valid amount per unopened vial in mg.");
    if (!nonnegative(input.unopened) || !Number.isInteger(Number(input.unopened)) || input.unopened > 100000) throw new Error("Enter a whole number of unopened vials.");
    if (!nonnegative(input.lowDays) || input.lowDays > 3650) throw new Error("Reminder days must be between 0 and 3650.");
    if (input.expiry && !dateValid(input.expiry)) throw new Error("Enter a valid expiration date.");
    if (input.peptideId && !core.findPeptide(input.peptideId)) throw new Error("Choose a current protocol or inventory only.");
    if (input.peptideId && data().items.some(item => item.id !== key && !item.archived && item.peptideId === input.peptideId)) throw new Error("That protocol already has inventory. Edit its stock instead.");
    const item = existing || { id: id(), vials: [], activeVialId: "", trackedFrom: h.todayString(), baselineKeys: [], corrections: [] };
    if (!existing || existing.peptideId !== input.peptideId) {
      for (const [date, tasks] of Object.entries(core.state.completedDoses))
        for (const task of Object.keys(tasks)) item.baselineKeys.push(`${date}|${task}`);
    }
    item.corrections.push({ at: new Date().toISOString(), unopened: Number(input.unopened), powderMg: Number(input.powderMg) });
    Object.assign(item, { name, peptideId: input.peptideId || "", powderMg: Number(input.powderMg), unopened: Number(input.unopened), expiry: input.expiry || "", lowDays: Number(input.lowDays), archived: !!input.archived });
    if (!existing) data().items.push(item);
    core.commit();
    return item;
  }
  function openVial(key, input, fromStock) {
    const item = find(key);
    if (!item) throw new Error("Stock item not found.");
    if (fromStock && item.unopened < 1) throw new Error("No unopened vials remain.");
    const powderMg = fromStock ? item.powderMg : Number(input.powderMg);
    if (!positive(powderMg)) throw new Error("Enter the original amount in this vial.");
    if (input.bacMl !== "" && input.bacMl != null && !positive(input.bacMl)) throw new Error("BAC water must be positive, or leave it unknown.");
    const balance = input.remainingMg === "" || input.remainingMg == null ? null : Number(input.remainingMg);
    if (balance !== null && (!nonnegative(balance) || balance > powderMg)) throw new Error("Remaining mg must be between zero and the original vial amount.");
    for (const field of ["mixedDate", "expiry"]) if (input[field] && !dateValid(input[field])) throw new Error("Enter valid vial dates.");
    if (input.mixedDate > h.todayString()) throw new Error("The mixed date cannot be in the future.");
    const vial = { id: id(), powderMg, bacMl: positive(input.bacMl) ? Number(input.bacMl) : null, initialMg: balance,
      mixedDate: input.mixedDate || "", expiry: input.expiry || "", closed: false, openedAt: new Date().toISOString() };
    if (fromStock) item.unopened -= 1;
    item.vials.push(vial);
    item.activeVialId = vial.id;
    core.commit();
    return vial;
  }
  function updateVial(key, vialId, input) {
    const item = find(key), vial = item?.vials.find(v => v.id === vialId);
    if (!vial) throw new Error("Vial not found.");
    const balance = input.remainingMg === "" ? null : Number(input.remainingMg);
    if (balance !== null && (!nonnegative(balance) || balance > vial.powderMg)) throw new Error("Remaining mg must be between zero and the original vial amount.");
    if (input.bacMl !== "" && !positive(input.bacMl)) throw new Error("BAC water must be positive, or leave it unknown.");
    for (const field of ["mixedDate", "expiry"]) if (input[field] && !dateValid(input[field])) throw new Error("Enter valid vial dates.");
    if (input.mixedDate > h.todayString()) throw new Error("The mixed date cannot be in the future.");
    item.corrections.push({ at: new Date().toISOString(), vialId, beforeMg: remaining(item, vial), remainingMg: balance });
    Object.assign(vial, { initialMg: balance === null ? null : round(balance + used(item, vial)),
      bacMl: input.bacMl === "" ? null : Number(input.bacMl), mixedDate: input.mixedDate || "", expiry: input.expiry || "", closed: !!input.closed });
    if (input.active && !vial.closed) item.activeVialId = vial.id;
    if (vial.closed && item.activeVialId === vial.id) item.activeVialId = "";
    core.commit();
  }
  function assignUsage(key, vialId) {
    const entry = data().usage[key], item = entry && find(entry.itemId);
    const vial = item?.vials.find(v => v.id === vialId);
    if (!vial || !entry) throw new Error("Choose a vial for this logged dose.");
    entry.vialId = vial.id;
    core.commit();
  }
  function recordDose(date, taskId, done) {
    const key = `${date}|${taskId}`, log = data().usage;
    if (!done) { delete log[key]; return; }
    if (log[key] || core.completedForDate(date)[taskId] || date > h.todayString()) return;
    const task = core.plan(date).tasks.find(task => task.taskId === taskId);
    const item = task && linked(task.peptideId);
    if (!item || date < item.trackedFrom || item.baselineKeys.includes(key)) return;
    const amountMg = mg(task.amount, task.unit);
    if (!(amountMg > 0)) return;
    // Backdated doses need an explicit vial assignment; never debit today's vial by guesswork.
    const vial = date === h.todayString() ? activeVial(item) : null;
    log[key] = { itemId: item.id, vialId: vial?.id || "", amountMg, date, taskId, time: task.time,
      amount: task.amount, unit: task.unit, units: task.units, doseLabel: task.doseLabel,
      recordedAt: new Date().toISOString() };
  }
  function stock(item, today = h.todayString()) {
    const buckets = [], unknown = [], expired = [];
    if (item.unopened) {
      const bucket = { mg: item.unopened * item.powderMg, expiry: item.expiry };
      (item.expiry && item.expiry < today ? expired : buckets).push(bucket);
    }
    for (const vial of item.vials.filter(v => !v.closed)) {
      const balance = remaining(item, vial);
      if (vial.expiry && vial.expiry < today) expired.push({ mg: Math.max(0, balance || 0), expiry: vial.expiry });
      else if (balance === null) unknown.push(vial);
      else buckets.push({ mg: Math.max(0, balance), expiry: vial.expiry });
    }
    const unassignedMg = entries(item).filter(([, row]) => !row.vialId).reduce((sum, [, row]) => sum + row.amountMg, 0);
    const overdrawnMg = item.vials.reduce((sum, vial) => sum + Math.max(0, -(remaining(item, vial) || 0)), 0);
    buckets.sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999"));
    let unresolved = unassignedMg + overdrawnMg;
    for (const bucket of buckets) { const taken = Math.min(bucket.mg, unresolved); bucket.mg -= taken; unresolved -= taken; }
    return { buckets, unknown, expired, unassignedMg, overdrawnMg, knownMg: round(buckets.reduce((sum, b) => sum + b.mg, 0)) };
  }
  function forecast(item, today = h.todayString()) {
    const supply = stock(item, today), peptide = core.findPeptide(item.peptideId);
    if (item.archived || !peptide?.active) return { ...supply, status: "unscheduled", doses: null };
    const dose = core.doseForDate(peptide, today), doseMg = mg(dose.amount, dose.unit);
    if (!(doseMg > 0)) return { ...supply, status: "unscheduled", doses: null };
    const result = { ...supply, dose, doseMg, doses: Math.floor((supply.knownMg + 1e-8) / doseMg), status: "covered", days: null, nextShortfall: null };
    const buckets = supply.buckets.map(b => ({ ...b }));
    let scheduledCount = 0, lastDate = null, bounded = false;
    // Current-dose scenario: future titration is intentionally not assumed. Re-evaluated on every render.
    for (let offset = 0; offset <= 36525; offset++) {
      const date = add(today, offset);
      if ((peptide.endDate && date > peptide.endDate) || (peptide.stoppedDate && date >= peptide.stoppedDate)) { bounded = true; break; }
      const cycle = window.PepsProtocol?.cycleStatus(peptide, date);
      if (cycle?.phase === "pending") { bounded = true; break; }
      if (!core.isScheduled(peptide, date)) continue;
      for (const time of peptide.times) {
        if (core.completedForDate(date)[`${peptide.id}-${time.toLowerCase()}`]) continue;
        scheduledCount++;
        for (const bucket of buckets) if (bucket.expiry && bucket.expiry < date) bucket.mg = 0;
        const available = buckets.reduce((sum, bucket) => sum + bucket.mg, 0);
        if (available + 1e-8 < doseMg) return { ...result, status: "limited", days: offset, nextShortfall: date, lastDate };
        let demand = doseMg;
        for (const bucket of buckets) { const taken = Math.min(demand, bucket.mg); bucket.mg -= taken; demand -= taken; }
        lastDate = date;
      }
    }
    return { ...result, status: !scheduledCount ? "unscheduled" : bounded ? "covered" : "horizon", lastDate };
  }
  window.PepsInventory = { normalize, find, entries, remaining, activeVial, linked, saveItem, openVial, updateVial, assignUsage, recordDose, stock, forecast };
  const plan = core.plan;
  core.plan = function (date) {
    const result = plan(date);
    if (date < h.todayString()) return result;
    for (const task of result.tasks) {
      const receipt = data().usage[`${date}|${task.taskId}`];
      if (receipt && core.completedForDate(date)[task.taskId]) {
        Object.assign(task, { amount: receipt.amount, unit: receipt.unit, doseLabel: receipt.doseLabel, units: receipt.units });
        continue;
      }
      const item = linked(task.peptideId), vial = item && activeVial(item);
      if (!vial) continue;
      task.inventoryVial = true;
      if (positive(vial.bacMl)) {
        task.units = mg(task.amount, task.unit) / (vial.powderMg / vial.bacMl) * core.state.unitsPerMl;
        task.measurementPending = false;
        task.warning = task.units > core.state.unitsPerMl ? "Volume exceeds one 1 ml syringe." : "";
      } else { task.units = null; task.measurementPending = true; }
      if (vial.expiry && vial.expiry < date) task.warning = "Active vial is past its recorded discard date.";
    }
    return result;
  };
})();
