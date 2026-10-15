(function () {
  "use strict";
  const core = window.PepsCore;
  const h = core.helpers;
  const el = id => document.getElementById(id);
  const esc = h.escapeHtml;
  const add = (date, days) => h.dateStr(h.addDays(h.parseDate(date), days));
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
  let editor = null;
  let step = 0;
  const stepNames = ["Dose & schedule", "Duration", "Vial & measurement", "Dose plan", "Review"];

  function cycleStatus(peptide, date = h.todayString()) {
    const duration = peptide.duration;
    if (peptide.stoppedDate && date >= peptide.stoppedDate) return { phase: "stopped", label: "Protocol stopped" };
    if (date < peptide.startDate) return { phase: "future", label: `Starts ${h.shortDate(peptide.startDate)}` };
    if (peptide.endDate && date > peptide.endDate) return { phase: "complete", label: "Course complete" };
    if (!duration || duration.mode !== "cycle") {
      if (duration?.mode === "fixed") {
        const day = h.daysBetween(peptide.startDate, date);
        const total = h.daysBetween(peptide.startDate, peptide.endDate) + 1;
        return { phase: "on", label: `Day ${day + 1} of ${total}`, nextDate: peptide.endDate };
      }
      return { phase: "on", label: "Ongoing" };
    }
    const on = Number(duration.onDays), off = Number(duration.offDays), length = on + off;
    if (!(on > 0 && off > 0)) return { phase: "on", label: "Cycle setup needed" };
    const starts = [peptide.startDate, ...(duration.starts || [])].filter(start => start <= date).sort();
    const anchor = starts.at(-1);
    const elapsed = h.daysBetween(anchor, date);
    if (duration.restart === "confirm" && elapsed >= length) {
      const nextStart = (duration.starts || []).filter(start => start > date).sort()[0];
      return nextStart ? { phase: "awaiting", label: "Restart confirmed", nextDate: nextStart } : { phase: "pending", label: "Restart confirmation needed", nextDate: add(anchor, length) };
    }
    const position = elapsed % length;
    const cycleStart = add(anchor, elapsed - position);
    if (position >= on) return { phase: "off", label: "Scheduled break", nextDate: add(cycleStart, length) };
    return { phase: "on", label: on % 7 === 0 ? `Week ${Math.floor(position / 7) + 1} of ${on / 7}` : `Day ${position + 1} of ${on}`, nextDate: add(cycleStart, on) };
  }

  function allowed(peptide, date) {
    if (!peptide.duration) return true;
    return ["on", "future"].includes(cycleStatus(peptide, date).phase);
  }

  function restart(id) {
    const peptide = core.findPeptide(id);
    if (!peptide?.active || cycleStatus(peptide).phase !== "pending") throw new Error("This cycle is not waiting for a restart.");
    let start = null;
    for (let offset = 0; offset < 730; offset += 1) {
      const date = add(h.todayString(), offset);
      const elapsed = h.daysBetween(peptide.startDate, date);
      if (peptide.endDate && date > peptide.endDate) throw new Error("This course has ended.");
      if (peptide.frequency === "daily" || (peptide.frequency === "weekly" && elapsed % 7 === 0) || (peptide.frequency === "weekdays" && peptide.weekdays.includes(h.parseDate(date).getDay())) || (peptide.frequency === "interval" && elapsed % peptide.intervalDays === 0)) { start = date; break; }
    }
    if (!start) throw new Error("No scheduled dose was found in the next two years. Update the schedule first.");
    peptide.duration.starts = [...peptide.duration.starts || [], start];
    core.commit();
    return start;
  }

  function readDuration(previous) {
    const mode = el("durationMode").value;
    const onDays = Math.round(Number(el("cycleOnWeeks").value) * 7);
    const offDays = Math.round(Number(el("cycleOffWeeks").value) * 7);
    const config = { mode, onDays: mode === "cycle" ? onDays : 0, offDays: mode === "cycle" ? offDays : 0, restart: el("cycleRestartMode").value, starts: [] };
    if (previous?.duration && previous.startDate === el("startDateInput").value && ["mode", "onDays", "offDays", "restart"].every(key => config[key] === previous.duration[key])) config.starts = previous.duration.starts || [];
    return config;
  }

  function updateFields() {
    const mode = el("durationMode").value;
    el("fixedDurationFields").hidden = mode !== "fixed";
    el("cycleDurationFields").hidden = mode !== "cycle";
    el("endDateInput").disabled = mode !== "fixed";
    el("endDateInput").required = mode === "fixed";
    ["cycleOnWeeks", "cycleOffWeeks"].forEach(id => { el(id).required = mode === "cycle"; el(id).disabled = mode !== "cycle"; });
    const start = el("startDateInput").value;
    const end = el("endDateInput").value;
    el("endDateInput").min = start;
    const weeks = Number(el("cycleOnWeeks").value);
    const offWeeks = Number(el("cycleOffWeeks").value);
    el("durationPreview").textContent = mode === "cycle" && positive(weeks) && positive(offWeeks) && start
      ? `${weeks} weeks on, ${offWeeks} weeks off. First break: ${h.shortDate(add(start, Math.round(weeks * 7)))}.`
      : mode === "fixed" && end ? `Last scheduled day: ${h.shortDate(end)}.` : "";
    const pending = el("measurementMode").value === "later";
    ["powderMgInput", "bacMlInput"].forEach(id => { el(id).disabled = pending; el(id).required = !pending; el(id).closest("label").hidden = pending; });
    const units = !pending && core.calculatorUnits({ powderMg: el("powderMgInput").value, waterMl: el("bacMlInput").value, doseAmount: el("doseAmountInput").value, doseUnit: el("doseUnitInput").value, unitsPerMl: core.state.unitsPerMl });
    el("measurementPreview").textContent = pending ? "Measurement setup needed before units are available." : units ? `${h.unitsLabel(units.units)} per dose on a ${core.state.unitsPerMl} units/ml syringe` : "";
    el("weekdaysInput").closest("label").hidden = el("frequencyInput").value !== "weekdays";
    el("weekdaysInput").required = el("frequencyInput").value === "weekdays";
    el("intervalDaysInput").closest("label").hidden = el("frequencyInput").value !== "interval";
    el("intervalDaysInput").required = el("frequencyInput").value === "interval";
  }

  function summary() {
    const duration = readDuration(editor);
    const dose = h.doseLabel(Number(el("doseAmountInput").value), el("doseUnitInput").value);
    const frequency = el("frequencyInput").selectedOptions[0].textContent;
    const mode = el("titrationMode").value;
    const plan = !el("titrationEnabled").checked ? "Keep current dose" : { increase: "Scheduled increases", maintain: "Maintain current dose", decrease: "Reduce to maintenance", stop: "Reduce to a planned stop" }[mode];
    const length = duration.mode === "ongoing" ? "Ongoing" : duration.mode === "fixed" ? `Through ${h.shortDate(el("endDateInput").value)}` : `${duration.onDays / 7} weeks on / ${duration.offDays / 7} weeks off; ${duration.restart === "confirm" ? "confirm each restart" : "repeat automatically"}`;
    el("protocolSummary").innerHTML = `<dl class="protocol-summary"><dt>Peptide</dt><dd>${esc(el("peptideNameInput").value)}</dd><dt>Dose</dt><dd>${esc(dose)}</dd><dt>Schedule</dt><dd>${esc(frequency)} / ${esc(el("timeInput").value)} / ${h.shortDate(el("startDateInput").value)}</dd><dt>Duration</dt><dd>${esc(length)}</dd><dt>Measurement</dt><dd>${esc(el("measurementPreview").textContent || "Setup needed")}</dd><dt>Dose plan</dt><dd>${esc(plan)}</dd></dl>`;
  }

  function showStep() {
    const wizard = !editor;
    el("view-settings").classList.toggle("protocol-onboarding", wizard);
    el("protocolPageTitle").textContent = wizard ? "Set up your protocol" : "Update protocol";
    el("protocolDashboardButton").hidden = wizard;
    el("protocolWizard").hidden = !wizard;
    el("protocolWizardActions").hidden = !wizard;
    document.querySelectorAll("[data-protocol-step]").forEach(fieldset => { fieldset.hidden = wizard ? Number(fieldset.dataset.protocolStep) !== step : fieldset.dataset.protocolStep === "4"; });
    el("protocolStepLabel").textContent = `Step ${step + 1} of 5: ${stepNames[step]}`;
    el("protocolStepProgress").value = step + 1;
    el("protocolBackButton").disabled = step === 0;
    el("protocolNextButton").hidden = step === 4;
    el("savePeptideButton").hidden = wizard && step !== 4;
    el("deletePeptideBtn").hidden = wizard;
    if (wizard && step === 4) summary();
  }

  function validateStep(index) {
    const fieldset = document.querySelector(`[data-protocol-step="${index}"]`);
    for (const input of fieldset.querySelectorAll("input,select")) {
      if (!input.disabled && !input.checkValidity()) { input.reportValidity(); return false; }
    }
    if (index === 0 && el("frequencyInput").value === "weekdays") {
      const valid = /^(sun(day)?|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|[0-6])$/i;
      if (!el("weekdaysInput").value.split(/[,\s]+/).filter(Boolean).every(day => valid.test(day))) { el("protocolError").textContent = "Enter weekdays such as Mon, Thu."; return false; }
    }
    return true;
  }

  function goalInfo() {
    const goal = Number(core.state.goals?.weightGoal);
    if (!positive(goal)) return null;
    const rows = h.weightRows();
    const latest = rows.at(-1);
    const first = rows[0];
    const reached = Boolean(latest && latest.weight <= goal);
    const percent = latest && first.weight > goal ? Math.max(0, Math.min(100, (first.weight - latest.weight) / (first.weight - goal) * 100)) : reached ? 100 : 0;
    return { goal, latest, reached, percent, reviewDue: reached && core.state.goals.reviewedGoal !== goal };
  }

  function setGoal(value) {
    if (value !== "" && value != null && !positive(value)) throw new Error("Enter a goal weight greater than zero.");
    const weightGoal = value === "" || value == null ? null : Number(value);
    core.state.goals = { weightGoal, reviewedGoal: core.state.goals?.weightGoal === weightGoal ? core.state.goals.reviewedGoal : null };
    core.commit();
  }

  function render() {
    const today = h.todayString();
    const rows = core.state.stack.filter(peptide => peptide.active && (peptide.duration && peptide.duration.mode !== "ongoing" || peptide.titration?.mode && peptide.titration.mode !== "increase" || peptide.stoppedDate));
    el("cycleSection").hidden = rows.length === 0;
    el("cycleList").innerHTML = rows.map(peptide => {
      const status = cycleStatus(peptide);
      const phase = peptide.titration?.mode;
      const mode = peptide.stoppedDate && peptide.stoppedDate > today ? `Stops ${h.shortDate(peptide.stoppedDate)}` : phase === "maintain" && peptide.titration.endpointDate > today ? `Maintenance starts ${h.shortDate(peptide.titration.endpointDate)}` : { maintain: "Maintenance", decrease: "Reducing to maintenance", stop: "Reducing to a planned stop" }[phase];
      return `<article class="protocol-status"><div><strong>${esc(peptide.name)}</strong><span>${esc(status.label)}${status.phase === "on" && mode ? ` / ${mode}` : ""}</span>${status.nextDate ? `<span>${status.phase === "awaiting" ? "Restarts" : status.phase === "off" ? "Next cycle" : status.phase === "pending" ? "Ready since" : peptide.duration?.mode === "fixed" ? "Last day" : "Break starts"}: ${h.shortDate(status.nextDate)}</span>` : ""}</div>${status.phase === "pending" ? `<button type="button" class="primary-button" data-cycle-restart="${esc(peptide.id)}">Confirm restart</button>` : `<button type="button" class="secondary-button" data-nav="settings" data-edit-peptide="${esc(peptide.id)}">Edit plan</button>`}</article>`;
    }).join("");
    const goal = goalInfo();
    el("goalSection").hidden = !goal;
    if (goal) {
      el("goalTitle").textContent = goal.reached ? "Goal reached" : "Weight progress";
      el("goalProgress").innerHTML = `<div class="goal-numbers"><strong>${h.formatNumber(goal.goal)} lb goal</strong><span>${goal.latest ? `${h.formatNumber(goal.latest.weight)} lb latest / ${h.formatNumber(Math.max(0, goal.latest.weight - goal.goal))} lb to goal` : "Log a weight to see progress"}</span></div><progress max="100" value="${goal.percent}" aria-label="Progress toward goal weight"></progress>`;
      el("goalReview").hidden = !goal.reviewDue;
    }
    if (document.activeElement !== el("goalWeightInput")) el("goalWeightInput").value = core.state.goals?.weightGoal || "";
    const selected = core.state.selectedDate;
    if (!core.plan(selected).tasks.length) {
      const breaks = core.state.stack.filter(peptide => peptide.active).map(peptide => ({ peptide, status: cycleStatus(peptide, selected) })).filter(item => ["off", "pending", "stopped", "complete"].includes(item.status.phase));
      if (breaks.length) el("selectedTasks").innerHTML = breaks.map(({ peptide, status }) => `<div class="empty-state"><strong>${esc(peptide.name)}</strong><p>${esc(status.label)}</p></div>`).join("");
    }
    // The current stack must not display a guessed pull for an unmixed vial.
    document.querySelectorAll("[data-dose-toggle]").forEach(button => {
      const peptide = core.state.stack.find(item => button.dataset.taskId.startsWith(item.id + "-"));
      if (peptide?.measurementPending) { button.disabled = true; button.setAttribute("title", "Complete vial measurement setup first"); }
    });
  }

  const loadEditor = window.PepsTitration.loadEditor;
  window.PepsTitration.loadEditor = function (peptide) {
    loadEditor(peptide);
    editor = peptide || null;
    step = 0;
    const duration = peptide?.duration;
    const legacyCycle = peptide?.cycleOnDays && peptide?.cycleOffDays;
    el("durationMode").value = duration?.mode || (legacyCycle ? "cycle" : peptide?.endDate ? "fixed" : "ongoing");
    el("cycleOnWeeks").value = duration?.onDays ? duration.onDays / 7 : legacyCycle ? peptide.cycleOnDays / 7 : "";
    el("cycleOffWeeks").value = duration?.offDays ? duration.offDays / 7 : legacyCycle ? peptide.cycleOffDays / 7 : "";
    el("cycleRestartMode").value = duration?.restart || (legacyCycle ? "auto" : "confirm");
    el("courseWeeksInput").value = peptide?.endDate ? (h.daysBetween(peptide.startDate, peptide.endDate) + 1) / 7 : "";
    el("measurementMode").value = peptide?.measurementPending ? "later" : "mixed";
    if (peptide?.measurementPending) { el("powderMgInput").value = ""; el("bacMlInput").value = ""; }
    el("setupWeightInput").value = "";
    el("setupGoalInput").value = core.state.goals?.weightGoal || "";
    el("protocolError").textContent = "";
    updateFields();
    showStep();
  };

  const savePeptide = core.savePeptide;
  core.savePeptide = function (peptide) {
    if (peptide.duration) {
      peptide.cycleOnDays = "";
      peptide.cycleOffDays = "";
      if (peptide.duration.mode !== "fixed") peptide.endDate = "";
    }
    const saved = savePeptide.call(core, peptide);
    if (saved && !editor && el("setupGoalInput")) {
      if (el("setupGoalInput").value) setGoal(el("setupGoalInput").value);
      if (positive(el("setupWeightInput").value)) {
        const date = h.todayString();
        core.state.checkins[date] = { ...core.state.checkins[date], weight: Number(el("setupWeightInput").value) };
        core.commit();
      }
    }
    return saved;
  };

  const plan = core.plan;
  core.plan = function (date) {
    const result = plan.call(core, date);
    result.tasks.forEach(task => {
      const peptide = core.findPeptide(task.peptideId);
      task.measurementPending = Boolean(peptide?.measurementPending);
      if (task.measurementPending) { task.units = null; task.warning = "Measurement setup needed"; }
    });
    core.state.stack.filter(peptide => peptide.active && peptide.duration?.mode === "cycle").forEach(peptide => {
      const status = cycleStatus(peptide, date);
      if (status.phase === "pending" && date === h.todayString()) result.events.push({ kind: "review", label: `${peptide.name} restart check-in` });
      if (status.phase === "off" && cycleStatus(peptide, add(date, -1)).phase === "on") result.events.push({ kind: "review", label: `${peptide.name} break begins` });
    });
    return result;
  };
  const unlock = core.unlock;
  core.unlock = async function (...args) {
    const result = await unlock.apply(core, args);
    if (result.ok) { editor = null; el("peptideIdInput").value = ""; el("protocolWizard").hidden = true; el("goalSavedStatus").textContent = ""; }
    if (result.ok && result.created) { core.state.stack = []; core.state.goals = {}; core.commit(); }
    if (result.ok && !result.created) {
      let changed = false;
      core.state.stack.forEach(peptide => {
        if (!peptide.duration && peptide.cycleOnDays && peptide.cycleOffDays) {
          peptide.duration = { mode: "cycle", onDays: peptide.cycleOnDays, offDays: peptide.cycleOffDays, restart: "auto", starts: [] };
          peptide.cycleOnDays = "";
          peptide.cycleOffDays = "";
          changed = true;
        } else if (!peptide.duration && peptide.endDate) {
          peptide.duration = { mode: "fixed" };
          changed = true;
        }
      });
      if (changed) core.commit();
    }
    return result;
  };
  window.PepsProtocol = { allowed, cycleStatus, restart, readDuration, render, goalInfo, setGoal, isCreating: () => !editor && !el("protocolWizard").hidden };

  document.addEventListener("DOMContentLoaded", () => {
    el("peptideForm").noValidate = true;
    el("peptideForm").addEventListener("submit", event => {
      el("protocolError").textContent = "";
      for (let index = 0; index < 5; index += 1) {
        if (!editor) { step = index; showStep(); }
        if (!validateStep(index)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      }
    }, true);
    el("protocolNextButton").addEventListener("click", () => { el("protocolError").textContent = ""; if (validateStep(step)) { step = Math.min(4, step + 1); showStep(); el("peptideForm").scrollIntoView({ block: "start" }); } });
    el("protocolBackButton").addEventListener("click", () => { step = Math.max(0, step - 1); showStep(); el("peptideForm").scrollIntoView({ block: "start" }); });
    ["durationMode", "cycleOnWeeks", "cycleOffWeeks", "cycleRestartMode", "measurementMode", "powderMgInput", "bacMlInput", "doseAmountInput", "doseUnitInput", "frequencyInput", "startDateInput"].forEach(id => el(id).addEventListener("input", updateFields));
    el("courseWeeksInput").addEventListener("input", () => {
      if (positive(el("courseWeeksInput").value) && el("startDateInput").value) el("endDateInput").value = add(el("startDateInput").value, Math.round(Number(el("courseWeeksInput").value) * 7) - 1);
      updateFields();
    });
    el("endDateInput").addEventListener("input", () => { el("courseWeeksInput").value = el("endDateInput").value ? (h.daysBetween(el("startDateInput").value, el("endDateInput").value) + 1) / 7 : ""; updateFields(); });
    el("goalForm").addEventListener("submit", event => { event.preventDefault(); setGoal(el("goalWeightInput").value); window.PepsRender(); el("goalSavedStatus").textContent = "Goal saved"; });
    el("clearGoalButton").addEventListener("click", () => { setGoal(null); window.PepsRender(); el("goalSavedStatus").textContent = "Goal removed"; });
    el("goalReviewButton").addEventListener("click", () => { document.querySelector('[data-nav="settings"]').click(); el("stackList").scrollIntoView({ block: "start" }); });
    el("goalDismissButton").addEventListener("click", () => { core.state.goals.reviewedGoal = core.state.goals.weightGoal; core.commit(); window.PepsRender(); });
    document.addEventListener("click", event => {
      const editButton = event.target.closest("[data-edit-peptide]");
      if (editButton && !event.composedPath().includes(el("stackList"))) {
        const entry = [...el("stackList").querySelectorAll("[data-edit-peptide]")].find(button => button.dataset.editPeptide === editButton.dataset.editPeptide);
        if (entry) entry.click();
      }
      const restartButton = event.target.closest("[data-cycle-restart]");
      if (restartButton) { restart(restartButton.dataset.cycleRestart); window.PepsRender(); }
    });
  });
})();
