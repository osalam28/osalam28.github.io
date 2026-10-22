(function () {
  "use strict";
  const core = window.PepsCore;
  const h = core.helpers;
  const el = (id) => document.getElementById(id);
  const esc = h.escapeHtml;
  const add = (date, days) => h.dateStr(h.addDays(h.parseDate(date), days));
  const positive = (value) =>
    Number.isFinite(Number(value)) && Number(value) > 0;
  let editor = null;
  let initialWeight = "";
  let pendingGoalReview = null;
  let step = 0;
  const stepNames = [
    "Dose & schedule",
    "Cycle length & duration",
    "Inventory & vial",
    "Dose plan",
    "Review",
  ];

  function cycleStatus(peptide, date = h.todayString()) {
    const duration = peptide.duration;
    if (peptide.stoppedDate && date >= peptide.stoppedDate)
      return { phase: "stopped", label: "Protocol stopped" };
    if (date < peptide.startDate)
      return {
        phase: "future",
        label: `Starts ${h.shortDate(peptide.startDate)}`,
      };
    if (peptide.endDate && date > peptide.endDate)
      return { phase: "complete", label: "Course complete" };
    if (!duration || duration.mode !== "cycle") {
      if (duration?.mode === "fixed") {
        const day = h.daysBetween(peptide.startDate, date);
        const total = h.daysBetween(peptide.startDate, peptide.endDate) + 1;
        return {
          phase: "on",
          label: `Day ${day + 1} of ${total}`,
          nextDate: peptide.endDate,
        };
      }
      return { phase: "on", label: "Ongoing" };
    }
    const on = Number(duration.onDays),
      off = Number(duration.offDays),
      length = on + off;
    if (!(on > 0 && off > 0))
      return { phase: "on", label: "Cycle setup needed" };
    const starts = [peptide.startDate, ...(duration.starts || [])]
      .filter((start) => start <= date)
      .sort();
    const anchor = starts.at(-1);
    const elapsed = h.daysBetween(anchor, date);
    if (duration.restart === "confirm" && elapsed >= length) {
      const nextStart = (duration.starts || [])
        .filter((start) => start > date)
        .sort()[0];
      return nextStart
        ? { phase: "awaiting", label: "Restart confirmed", nextDate: nextStart }
        : {
            phase: "pending",
            label: "Restart confirmation needed",
            nextDate: add(anchor, length),
          };
    }
    const position = elapsed % length;
    const cycleStart = add(anchor, elapsed - position);
    if (position >= on)
      return {
        phase: "off",
        label: "Scheduled break",
        nextDate: add(cycleStart, length),
      };
    return {
      phase: "on",
      label:
        on % 7 === 0
          ? `Week ${Math.floor(position / 7) + 1} of ${on / 7}`
          : `Day ${position + 1} of ${on}`,
      nextDate: add(cycleStart, on),
    };
  }

  function allowed(peptide, date) {
    if (!peptide.duration) return true;
    return ["on", "future"].includes(cycleStatus(peptide, date).phase);
  }

  function restart(id) {
    const peptide = core.findPeptide(id);
    if (!peptide?.active || cycleStatus(peptide).phase !== "pending")
      throw new Error("This cycle is not waiting for a restart.");
    let start = null;
    for (let offset = 0; offset < 730; offset += 1) {
      const date = add(h.todayString(), offset);
      const elapsed = h.daysBetween(peptide.startDate, date);
      if (peptide.endDate && date > peptide.endDate)
        throw new Error("This course has ended.");
      if (
        peptide.frequency === "daily" ||
        (peptide.frequency === "weekly" && elapsed % 7 === 0) ||
        (peptide.frequency === "weekdays" &&
          peptide.weekdays.includes(h.parseDate(date).getDay())) ||
        (peptide.frequency === "interval" &&
          elapsed % peptide.intervalDays === 0)
      ) {
        start = date;
        break;
      }
    }
    if (!start)
      throw new Error(
        "No scheduled dose was found in the next two years. Update the schedule first.",
      );
    peptide.duration.starts = [...(peptide.duration.starts || []), start];
    core.commit();
    return start;
  }

  function readDuration(previous) {
    const mode = el("durationMode").value;
    if (!["ongoing", "fixed", "cycle"].includes(mode))
      throw new Error("Choose how long this protocol lasts.");
    const onDays = Math.round(Number(el("cycleOnWeeks").value) * 7);
    const offDays = Math.round(Number(el("cycleOffWeeks").value) * 7);
    const config = {
      mode,
      onDays: mode === "cycle" ? onDays : 0,
      offDays: mode === "cycle" ? offDays : 0,
      restart: el("cycleRestartMode").value,
      starts: [],
    };
    if (
      previous?.duration &&
      previous.startDate === el("startDateInput").value &&
      ["mode", "onDays", "offDays", "restart"].every(
        (key) => config[key] === previous.duration[key],
      )
    )
      config.starts = previous.duration.starts || [];
    return config;
  }

  function updateFields() {
    const mode = el("durationMode").value;
    document.querySelectorAll('[name="durationChoice"]').forEach((input) => {
      input.checked = input.value === mode;
    });
    el("fixedDurationFields").hidden = mode !== "fixed";
    el("cycleDurationFields").hidden = mode !== "cycle";
    el("endDateInput").disabled = mode !== "fixed";
    el("endDateInput").required = mode === "fixed";
    el("courseWeeksInput").disabled = mode !== "fixed";
    ["cycleOnWeeks", "cycleOffWeeks"].forEach((id) => {
      el(id).required = mode === "cycle";
      el(id).disabled = mode !== "cycle";
    });
    const start = el("startDateInput").value;
    const end = el("endDateInput").value;
    el("endDateInput").min = start;
    const weeks = Number(el("cycleOnWeeks").value);
    const offWeeks = Number(el("cycleOffWeeks").value);
    el("durationPreview").textContent =
      mode === "cycle" && positive(weeks) && positive(offWeeks) && start
        ? `${weeks} weeks on, ${offWeeks} weeks off. First break: ${h.shortDate(add(start, Math.round(weeks * 7)))}.`
        : mode === "fixed" && end
          ? `Last scheduled day: ${h.shortDate(end)}. No doses after this date.`
          : "";
    window.PepsProtocolInventory?.update();
    const inventoryManaged = window.PepsProtocolInventory?.managed();
    const pending = el("measurementMode").value !== "mixed";
    ["powderMgInput", "bacMlInput"].forEach((id) => {
      el(id).disabled = pending || inventoryManaged;
      el(id).required = !pending && !inventoryManaged;
      el(id).closest("label").hidden = pending;
    });
    const units =
      !pending &&
      core.calculatorUnits({
        powderMg: el("powderMgInput").value,
        waterMl: el("bacMlInput").value,
        doseAmount: el("doseAmountInput").value,
        doseUnit: el("doseUnitInput").value,
        unitsPerMl: core.state.unitsPerMl,
      });
    el("measurementPreview").textContent = pending
      ? "Measurement setup needed before units are available."
      : units
        ? `${h.unitsLabel(units.units)} per dose on a ${core.state.unitsPerMl} units/ml syringe`
        : "";
    el("weekdaysInput").closest("label").hidden =
      el("frequencyInput").value !== "weekdays";
    el("weekdaysInput").required = el("frequencyInput").value === "weekdays";
    el("intervalDaysInput").closest("label").hidden =
      el("frequencyInput").value !== "interval";
    el("intervalDaysInput").required =
      el("frequencyInput").value === "interval";
    el("intervalDaysInput").disabled =
      el("frequencyInput").value !== "interval";
    window.PepsDosePlans?.updateVisibility();
  }

  function summary() {
    const duration = readDuration(editor);
    const dose = h.doseLabel(
      Number(el("doseAmountInput").value),
      el("doseUnitInput").value,
    );
    let frequency = el("frequencyInput").selectedOptions[0].textContent;
    if (el("frequencyInput").value === "weekdays") frequency += `: ${el("weekdaysInput").value}`;
    if (el("frequencyInput").value === "interval") frequency = `Every ${el("intervalDaysInput").value} days`;
    if (el("frequencyInput").value === "weekly") frequency += ` on ${h.parseDate(el("startDateInput").value).toLocaleDateString(undefined, { weekday: "long" })}`;
    const mode = el("titrationMode").value;
    let plan = !el("titrationEnabled").checked
      ? "Keep current dose"
      : {
          increase: "Scheduled increases",
          review: `Review every ${el("titrationCadence").value} days / confirm any change`,
          maintain: "Maintain current dose",
          decrease: "Reduce to maintenance",
          stop: "Reduce to a planned stop",
        }[mode];
    if (
      el("titrationEnabled").checked &&
      ["increase", "decrease", "stop"].includes(mode)
    ) {
      plan += `: ${mode === "increase" ? "+" : "-"}${h.doseLabel(Number(el("titrationIncrement").value), el("doseUnitInput").value)} every ${el("titrationCadence").value} days`;
      const endpoint =
        mode === "stop"
          ? "0"
          : mode === "decrease"
            ? el("titrationTarget").value
            : el("titrationMax").value;
      if (endpoint !== "")
        plan += `; endpoint ${h.doseLabel(Number(endpoint), el("doseUnitInput").value)}`;
      plan += `; next review ${h.shortDate(el("titrationNextDate").value)}; confirm each change`;
    }
    const length =
      duration.mode === "ongoing"
        ? "Ongoing"
        : duration.mode === "fixed"
          ? `Through ${h.shortDate(el("endDateInput").value)}`
          : `${duration.onDays / 7} weeks on / ${duration.offDays / 7} weeks off; first break ${h.shortDate(add(el("startDateInput").value, duration.onDays))}; ${duration.restart === "confirm" ? "confirm each restart" : "repeat automatically"}`;
    if (el("dosePlanKind").value === "preset") {
      try { window.PepsDosePlans.validateEditor(); plan = window.PepsDosePlans.summary(); }
      catch (error) { plan = error.message; }
    } else if (el("titrationEnabled").checked && mode !== "maintain" &&
      (!Number.isInteger(Number(el("titrationCadence").value)) || Number(el("titrationCadence").value) < 1 || Number(el("titrationCadence").value) > 730)) {
      plan = "Choose a valid review interval from 1 to 730 whole days.";
    }
    el("protocolSummary").innerHTML =
      `<dl class="protocol-summary"><dt>Peptide</dt><dd>${esc(el("peptideNameInput").value)}</dd><dt>Dose</dt><dd>${esc(dose)}</dd><dt>Schedule</dt><dd>${esc(frequency)} / ${esc(el("timeInput").value)} / ${h.shortDate(el("startDateInput").value)}</dd><dt>Duration</dt><dd>${esc(length)}</dd><dt>Measurement</dt><dd>${esc(el("measurementPreview").textContent || "Setup needed")}</dd><dt>Dose plan</dt><dd>${esc(plan)}</dd></dl>`;
    if (window.PepsProtocolInventory) el("protocolSummary").innerHTML += `<dl class="protocol-summary"><dt>Inventory</dt><dd>${esc(window.PepsProtocolInventory.summary())}</dd></dl>`;
    if (replacesFuturePlan(editor, el("protocolPlanChoice").value)) {
      el("protocolSummary").innerHTML += '<p class="titration-preview">Saving this goal review replaces future dose changes and any future stop date with this plan. Past doses stay unchanged.</p>';
    }
  }

  function replacesFuturePlan(peptide, mode) {
    return Boolean(peptide && pendingGoalReview?.id === peptide.id &&
      ["maintain", "decrease", "stop"].includes(mode) &&
      (peptide.doseChanges.some((change) => change.date > h.todayString()) || peptide.stoppedDate > h.todayString()));
  }

  function showStep() {
    const wizard = !editor;
    el("protocolPageTitle").textContent = wizard
      ? "Add peptide"
      : "Update protocol";
    el("protocolDashboardButton").hidden = true;
    el("protocolWizard").hidden = false;
    el("protocolCancelButton").hidden = false;
    el("protocolWizardActions").hidden = false;
    document.querySelectorAll("[data-protocol-step]").forEach((fieldset) => {
      fieldset.hidden = Number(fieldset.dataset.protocolStep) !== step;
    });
    el("protocolStepLabel").textContent =
      `Step ${step + 1} of 5: ${stepNames[step]}`;
    el("protocolStepProgress").value = step + 1;
    el("protocolBackButton").disabled = step === 0;
    el("protocolNextButton").hidden = step === 4;
    el("savePeptideButton").hidden = step !== 4;
    el("savePeptideButton").querySelector("span").textContent = wizard
      ? "Add to my stack"
      : "Save changes";
    el("deletePeptideBtn").hidden = wizard;
    el("protocolEditTabs").hidden = wizard;
    el("protocolEditTabs").innerHTML = stepNames
      .map(
        (name, index) =>
          `<button type="button" data-protocol-edit-step="${index}" class="${index === step ? "active" : ""}">${esc(name)}</button>`,
      )
      .join("");
    el("initialWeightFields").hidden = false;
    if (step === 4) summary();
  }

  function validateStep(index) {
    if (index === 2 && window.PepsProtocolInventory) {
      try { window.PepsProtocolInventory.validate(); }
      catch (error) { el("protocolError").textContent = error.message; return false; }
    }
    if (index === 3) {
      try { window.PepsDosePlans?.validateEditor(); }
      catch (error) { el("protocolError").textContent = error.message; return false; }
      if (el("titrationEnabled").checked && el("titrationMode").value !== "maintain") {
        const cadence = Number(el("titrationCadence").value);
        if (!Number.isInteger(cadence) || cadence < 1 || cadence > 730) {
          el("protocolError").textContent = "Time between reviews must be a whole number from 1 to 730 days.";
          el("titrationCadence").focus();
          return false;
        }
      }
    }
    if (index === 4 && el("goalReviewChoice").value === "review" && !positive(el("setupGoalInput").value)) {
      el("protocolError").textContent = "Enter a goal weight for this milestone, or choose no weight milestone.";
      el("setupGoalInput").focus();
      return false;
    }
    if (index === 1 && !el("durationMode").value) {
      el("protocolError").textContent =
        "Choose ongoing, a fixed course, or a repeating cycle.";
      document.querySelector('[name="durationChoice"]')?.focus();
      return false;
    }
    const fieldset = document.querySelector(`[data-protocol-step="${index}"]`);
    for (const input of fieldset.querySelectorAll("input,select")) {
      if (!input.disabled && !input.checkValidity()) {
        input.reportValidity();
        return false;
      }
    }
    if (index === 0 && el("frequencyInput").value === "weekdays") {
      const valid =
        /^(sun(day)?|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|[0-6])$/i;
      if (
        !el("weekdaysInput")
          .value.split(/[,\s]+/)
          .filter(Boolean)
          .every((day) => valid.test(day))
      ) {
        el("protocolError").textContent = "Enter weekdays such as Mon, Thu.";
        return false;
      }
    }
    return true;
  }

  function goalInfo() {
    const goal = Number(core.state.goals?.weightGoal);
    if (!positive(goal)) return null;
    const rows = h.weightRows().filter((row) => row.date <= h.todayString());
    const latest = rows.at(-1);
    const first = rows[0];
    const reached = Boolean(latest && latest.weight <= goal);
    const percent =
      latest && first.weight > goal
        ? Math.max(
            0,
            Math.min(
              100,
              ((first.weight - latest.weight) / (first.weight - goal)) * 100,
            ),
          )
        : reached
          ? 100
          : 0;
    return {
      goal,
      latest,
      reached,
      percent,
      reviewDue: core.state.stack.some((peptide) => goalReviewStatus(peptide, { goal, reached }).due),
    };
  }

  function setGoal(value) {
    if (value !== "" && value != null && !positive(value))
      throw new Error("Enter a goal weight greater than zero.");
    const weightGoal = value === "" || value == null ? null : Number(value);
    if (core.state.goals?.weightGoal !== weightGoal) {
      core.state.stack.forEach((peptide) => {
        if (peptide.goalReview) {
          peptide.goalReview.reviewedGoal = null;
          peptide.goalReview.snoozedUntil = "";
        }
      });
    }
    core.state.goals = {
      weightGoal,
      reviewedGoal:
        core.state.goals?.weightGoal === weightGoal
          ? core.state.goals.reviewedGoal
          : null,
    };
    core.commit();
  }

  function goalReviewStatus(peptide, goal = goalInfo()) {
    const config = peptide.goalReview;
    const eligible = peptide.active && !["future", "stopped", "complete"].includes(cycleStatus(peptide).phase);
    const reviewed = Boolean(goal && config?.reviewedGoal === goal.goal);
    const snoozed = Boolean(config?.snoozedUntil > h.todayString());
    return {
      eligible,
      configured: Boolean(config),
      enabled: config?.enabled === true,
      reviewed,
      snoozed,
      due: Boolean(eligible && goal?.reached && config?.enabled && !reviewed && !snoozed),
    };
  }

  function recordGoalDecision(id, decision) {
    const peptide = core.findPeptide(id);
    const goal = goalInfo();
    if (!peptide || !goalReviewStatus(peptide, goal).due) return false;
    const config = peptide.goalReview;
    if (decision === "later") {
      config.snoozedUntil = add(h.todayString(), 7);
    } else {
      config.reviewedGoal = goal.goal;
      config.reviewedAt = h.todayString();
      config.decision = decision;
      config.snoozedUntil = "";
    }
    core.commit();
    return true;
  }

  function readGoalReview(peptide) {
    const enabled = el("goalReviewChoice").value === "review";
    return peptide?.goalReview?.enabled === enabled
      ? { ...peptide.goalReview }
      : { enabled, reviewedGoal: null, snoozedUntil: "" };
  }

  function saveEditorWeights(saved) {
    const goalValue = el("setupGoalInput").value;
    const goal = goalValue === "" ? null : Number(goalValue);
    if ((core.state.goals?.weightGoal ?? null) !== goal) setGoal(goal);
    const weight = el("setupWeightInput").value;
    // A prefilled historical reading is not a new check-in.
    if (positive(weight) && Number(weight) !== Number(initialWeight)) {
      const date = h.todayString();
      core.state.checkins[date] = { ...core.state.checkins[date], weight: Number(weight) };
      core.commit();
    }
    if (pendingGoalReview?.id === saved.id && pendingGoalReview.goal === goal) {
      recordGoalDecision(saved.id, el("protocolPlanChoice").value);
    }
    pendingGoalReview = null;
  }

  function saveEditorPeptide(peptide) {
    peptide = window.PepsDosePlans.prepare(peptide);
    if (replacesFuturePlan(peptide, peptide.titration?.mode)) {
      peptide.doseChanges = peptide.doseChanges.filter((change) => change.date <= h.todayString());
      if (peptide.stoppedDate > h.todayString()) peptide.stoppedDate = "";
      peptide.titration.plannedSteps = [];
    }
    return core.savePeptide(peptide);
  }

  function openGoalEditor(id, review) {
    const button = [...el("stackList").querySelectorAll("[data-edit-peptide]")]
      .find((entry) => entry.dataset.editPeptide === id);
    if (!button) return;
    window.PepsApp.navigate("settings");
    button.click();
    pendingGoalReview = review ? { id, goal: goalInfo()?.goal } : null;
    if (review) {
      el("dosePlanKind").value = "review";
      if (["steady", "preset"].includes(el("protocolPlanChoice").value)) {
        el("protocolPlanChoice").value = "review";
        el("protocolPlanChoice").dispatchEvent(new Event("change"));
      }
      window.PepsDosePlans.updateVisibility();
    }
    step = review ? 3 : 4;
    showStep();
    el("protocolDialog").scrollTop = 0;
    el(review ? "protocolPlanChoice" : "goalReviewChoice").focus();
  }

  function render() {
    const today = h.todayString();
    const rows = core.state.stack.filter(
      (peptide) => peptide.active && cycleStatus(peptide).phase === "pending",
    );
    el("cycleSection").hidden = rows.length === 0;
    el("cycleList").innerHTML = rows
      .map((peptide) => {
        const status = cycleStatus(peptide);
        const phase = peptide.titration?.mode;
        const mode =
          peptide.stoppedDate && peptide.stoppedDate > today
            ? `Stops ${h.shortDate(peptide.stoppedDate)}`
            : phase === "maintain" && peptide.titration.endpointDate > today
              ? `Maintenance starts ${h.shortDate(peptide.titration.endpointDate)}`
              : {
                  review: `Review every ${peptide.titration.cadenceDays} days`,
                  maintain: "Maintenance",
                  decrease: "Reducing to maintenance",
                  stop: "Reducing to a planned stop",
                }[phase];
        return `<article class="protocol-status"><div><strong>${esc(peptide.name)}</strong><span>${esc(status.label)}${status.phase === "on" && mode ? ` / ${mode}` : ""}</span>${status.nextDate ? `<span>${status.phase === "awaiting" ? "Restarts" : status.phase === "off" ? "Next cycle" : status.phase === "pending" ? "Ready since" : peptide.duration?.mode === "fixed" ? "Last day" : "Break starts"}: ${h.shortDate(status.nextDate)}</span>` : ""}</div>${status.phase === "pending" ? `<button type="button" class="primary-button" data-cycle-restart="${esc(peptide.id)}">Confirm restart</button>` : `<button type="button" class="secondary-button" data-nav="settings" data-edit-peptide="${esc(peptide.id)}">Edit plan</button>`}</article>`;
      })
      .join("");
    const goal = goalInfo();
    el("goalSection").hidden = !goal;
    if (goal) {
      el("goalTitle").textContent = goal.reached
        ? "Goal reached"
        : "Weight progress";
      el("goalProgress").innerHTML =
        `<div class="goal-numbers"><strong>${h.formatNumber(goal.goal)} lb goal</strong><span>${goal.latest ? `${h.formatNumber(goal.latest.weight)} lb latest / ${h.formatNumber(Math.max(0, goal.latest.weight - goal.goal))} lb to goal` : "Log a weight to see progress"}</span></div><progress max="100" value="${goal.percent}" aria-label="Progress toward goal weight"></progress>`;
      const peptides = core.state.stack.filter((peptide) => {
        const status = goalReviewStatus(peptide, goal);
        return status.eligible && (!status.configured || status.enabled);
      });
      el("goalReview").hidden = peptides.length === 0;
      el("goalReviewList").innerHTML = peptides.map((peptide) => {
        const status = goalReviewStatus(peptide, goal);
        const id = esc(peptide.id);
        const action = (value, label) => `<button type="button" class="secondary-button" data-goal-action="${value}" data-goal-peptide="${id}">${label}</button>`;
        const message = !status.configured ? "Choose whether this peptide needs a review at your goal weight."
          : status.due ? "Goal weight reached. Review maintenance or a gradual reduction with your clinician. Your plan stays unchanged until you save a change."
          : status.reviewed ? `Goal plan reviewed ${h.shortDate(peptide.goalReview.reviewedAt)}.`
          : status.snoozed ? `Next goal check-in ${h.shortDate(peptide.goalReview.snoozedUntil)}.`
          : `Goal review at ${h.formatNumber(goal.goal)} lb. Scheduled dose reviews continue separately.`;
        return `<article class="goal-review-row"><strong>${esc(peptide.name)}</strong><p>${esc(message)}</p><div class="titration-actions">${status.due
          ? action("review", "Review dose plan") + action("keep", "Keep existing plan") + action("later", "Remind in a week")
          : action("setup", status.configured ? "Edit goal review" : "Set up goal review")}</div></article>`;
      }).join("");
    }
    if (document.activeElement !== el("goalWeightInput"))
      el("goalWeightInput").value = core.state.goals?.weightGoal || "";
    const selected = core.state.selectedDate;
    if (!core.plan(selected).tasks.length) {
      const breaks = core.state.stack
        .filter((peptide) => peptide.active)
        .map((peptide) => ({ peptide, status: cycleStatus(peptide, selected) }))
        .filter((item) =>
          ["off", "pending", "stopped", "complete"].includes(item.status.phase),
        );
      if (breaks.length)
        el("selectedTasks").innerHTML = breaks
          .map(
            ({ peptide, status }) =>
              `<div class="empty-state"><strong>${esc(peptide.name)}</strong><p>${esc(status.label)}</p></div>`,
          )
          .join("");
    }
    // The current stack must not display a guessed pull for an unmixed vial.
    document.querySelectorAll("[data-dose-toggle]").forEach((button) => {
      const peptide = core.state.stack.find((item) =>
        button.dataset.taskId.startsWith(item.id + "-"),
      );
      if (peptide?.measurementPending) {
        button.disabled = true;
        button.setAttribute("title", "Complete vial measurement setup first");
      }
    });
  }

  const loadEditor = window.PepsTitration.loadEditor;
  window.PepsTitration.loadEditor = function (peptide) {
    loadEditor(peptide);
    editor = peptide || null;
    pendingGoalReview = null;
    step = 0;
    const duration = peptide?.duration;
    const legacyCycle = peptide?.cycleOnDays && peptide?.cycleOffDays;
    el("durationMode").value =
      duration?.mode ||
      (legacyCycle
        ? "cycle"
        : peptide?.endDate
          ? "fixed"
          : peptide
            ? "ongoing"
            : "");
    el("cycleOnWeeks").value = duration?.onDays
      ? duration.onDays / 7
      : legacyCycle
        ? peptide.cycleOnDays / 7
        : "";
    el("cycleOffWeeks").value = duration?.offDays
      ? duration.offDays / 7
      : legacyCycle
        ? peptide.cycleOffDays / 7
        : "";
    el("cycleRestartMode").value =
      duration?.restart || (legacyCycle ? "auto" : "confirm");
    el("courseWeeksInput").value = peptide?.endDate
      ? (h.daysBetween(peptide.startDate, peptide.endDate) + 1) / 7
      : "";
    el("measurementMode").value = peptide
      ? peptide.measurementPending
        ? "later"
        : "mixed"
      : "";
    if (peptide?.measurementPending) {
      el("powderMgInput").value = "";
      el("bacMlInput").value = "";
    }
    const latestWeight = h.weightRows().filter((row) => row.date <= h.todayString()).at(-1);
    initialWeight = latestWeight ? String(latestWeight.weight) : "";
    el("setupWeightInput").value = initialWeight;
    el("setupWeightStatus").textContent = latestWeight
      ? `Last logged ${h.shortDate(latestWeight.date)}. Changing this value records today's weight.`
      : "You can also log weight in your daily check-in.";
    el("setupGoalInput").value = core.state.goals?.weightGoal || "";
    el("goalReviewChoice").value = peptide?.goalReview ? peptide.goalReview.enabled ? "review" : "off" : "";
    el("protocolError").textContent = "";
    el("protocolPlanChoice").value = peptide
      ? peptide.titration?.enabled || peptide.titration?.mode === "maintain"
        ? peptide.titration.mode || "increase"
        : "steady"
      : "";
    window.PepsDosePlans?.loadEditor(peptide);
    window.PepsProtocolInventory?.loadEditor(peptide);
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
    return savePeptide.call(core, peptide);
  };

  const plan = core.plan;
  core.plan = function (date) {
    const result = plan.call(core, date);
    result.tasks.forEach((task) => {
      const peptide = core.findPeptide(task.peptideId);
      task.measurementPending = Boolean(peptide?.measurementPending);
      if (task.measurementPending) {
        task.units = null;
        task.warning = "Measurement setup needed";
      }
      const dose = window.PepsDosePlans?.doseForDate(peptide, date);
      if (dose && date !== peptide.startDate) {
        const previous = core.doseForDate(peptide, add(date, -1));
        if (dose.amount !== previous.amount || dose.unit !== previous.unit) {
          task.scheduledChange = "Scheduled dose changes today";
          if (!result.events.some((event) => event.label === `${peptide.name}: scheduled dose change`))
            result.events.push({ kind: "review", label: `${peptide.name}: scheduled dose change` });
        }
      }
    });
    core.state.stack
      .filter((peptide) => peptide.active && peptide.duration?.mode === "cycle")
      .forEach((peptide) => {
        const status = cycleStatus(peptide, date);
        if (status.phase === "pending" && date === h.todayString())
          result.events.push({
            kind: "review",
            label: `${peptide.name} restart check-in`,
          });
        if (
          status.phase === "off" &&
          cycleStatus(peptide, add(date, -1)).phase === "on"
        )
          result.events.push({
            kind: "review",
            label: `${peptide.name} break begins`,
          });
      });
    return result;
  };
  const unlock = core.unlock;
  core.unlock = async function (...args) {
    const result = await unlock.apply(core, args);
    if (result.ok) {
      editor = null;
      el("peptideIdInput").value = "";
      el("protocolWizard").hidden = true;
      el("goalSavedStatus").textContent = "";
    }
    if (result.ok && result.created) {
      core.state.stack = [];
      core.state.goals = {};
      core.commit();
    }
    if (result.ok && !result.created) {
      let changed = false;
      core.state.stack.forEach((peptide) => {
        if (!peptide.duration && peptide.cycleOnDays && peptide.cycleOffDays) {
          peptide.duration = {
            mode: "cycle",
            onDays: peptide.cycleOnDays,
            offDays: peptide.cycleOffDays,
            restart: "auto",
            starts: [],
          };
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
  window.PepsProtocol = {
    allowed,
    cycleStatus,
    restart,
    readDuration,
    render,
    goalInfo,
    setGoal,
    goalReviewStatus,
    recordGoalDecision,
    readGoalReview,
    saveEditorWeights,
    saveEditorPeptide,
    isCreating: () => !editor && el("protocolDialog").open,
  };

  document.addEventListener("DOMContentLoaded", () => {
    el("protocolDialog").addEventListener("close", () => { pendingGoalReview = null; });
    el("peptideForm").noValidate = true;
    el("peptideForm").addEventListener(
      "submit",
      (event) => {
        el("protocolError").textContent = "";
        for (let index = 0; index < 5; index += 1) {
          step = index;
          showStep();
          if (!validateStep(index)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
        }
      },
      true,
    );
    el("protocolNextButton").addEventListener("click", () => {
      el("protocolError").textContent = "";
      if (validateStep(step)) {
        step = Math.min(4, step + 1);
        showStep();
        el("protocolDialog").scrollTop = 0;
      }
    });
    el("protocolBackButton").addEventListener("click", () => {
      step = Math.max(0, step - 1);
      showStep();
      el("peptideForm").scrollIntoView({ block: "start" });
    });
    el("protocolCancelButton").addEventListener("click", () => {
      window.PepsExperience.closeEditor();
    });
    document.querySelectorAll('[name="durationChoice"]').forEach((input) =>
      input.addEventListener("change", () => {
        el("durationMode").value = input.value;
        el("protocolError").textContent = "";
        updateFields();
      }),
    );
    el("protocolPlanChoice").addEventListener("change", () => {
      const choice = el("protocolPlanChoice").value;
      el("titrationEnabled").checked = !["steady", "preset", ""].includes(choice);
      if (choice && !["steady", "preset"].includes(choice)) el("titrationMode").value = choice;
      el("titrationEnabled").dispatchEvent(new Event("input"));
      el("titrationMode").dispatchEvent(new Event("change"));
    });
    el("protocolEditTabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-protocol-edit-step]");
      if (button && validateStep(step)) {
        step = Number(button.dataset.protocolEditStep);
        showStep();
        el("protocolDialog").scrollTop = 0;
      }
    });
    [
      "durationMode",
      "cycleOnWeeks",
      "cycleOffWeeks",
      "cycleRestartMode",
      "measurementMode",
      "powderMgInput",
      "bacMlInput",
      "doseAmountInput",
      "doseUnitInput",
      "frequencyInput",
      "startDateInput",
    ].forEach((id) => el(id).addEventListener("input", updateFields));
    el("courseWeeksInput").addEventListener("input", () => {
      if (positive(el("courseWeeksInput").value) && el("startDateInput").value)
        el("endDateInput").value = add(
          el("startDateInput").value,
          Math.round(Number(el("courseWeeksInput").value) * 7) - 1,
        );
      updateFields();
    });
    el("endDateInput").addEventListener("input", () => {
      el("courseWeeksInput").value = el("endDateInput").value
        ? (h.daysBetween(el("startDateInput").value, el("endDateInput").value) +
            1) /
          7
        : "";
      updateFields();
    });
    el("goalForm").addEventListener("submit", (event) => {
      event.preventDefault();
      setGoal(el("goalWeightInput").value);
      window.PepsRender();
      el("goalSavedStatus").textContent = "Goal saved";
    });
    el("clearGoalButton").addEventListener("click", () => {
      setGoal(null);
      window.PepsRender();
      el("goalSavedStatus").textContent = "Goal removed";
    });
    document.addEventListener("click", (event) => {
      const goalButton = event.target.closest("[data-goal-action]");
      if (goalButton) {
        const id = goalButton.dataset.goalPeptide;
        const action = goalButton.dataset.goalAction;
        if (action === "review" || action === "setup") openGoalEditor(id, action === "review");
        else {
          recordGoalDecision(id, action);
          window.PepsRender();
        }
      }
      const editButton = event.target.closest("[data-edit-peptide]");
      if (editButton && !event.composedPath().includes(el("stackList"))) {
        const entry = [
          ...el("stackList").querySelectorAll("[data-edit-peptide]"),
        ].find(
          (button) =>
            button.dataset.editPeptide === editButton.dataset.editPeptide,
        );
        if (entry) entry.click();
      }
      const restartButton = event.target.closest("[data-cycle-restart]");
      if (restartButton) {
        restart(restartButton.dataset.cycleRestart);
        window.PepsRender();
      }
    });
  });
})();
