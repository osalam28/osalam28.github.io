(function () {
  "use strict";
  const core = window.PepsCore;
  const h = core.helpers;
  const el = (id) => document.getElementById(id);
  const esc = h.escapeHtml;
  const addDays = (date, days) => h.dateStr(h.addDays(h.parseDate(date), days));
  const positive = (value) =>
    Number.isFinite(Number(value)) && Number(value) > 0;
  const rounded = (value) => Math.round(value * 1000000) / 1000000;
  let editorId = null;

  function nextDoseDate(peptide, from) {
    for (let day = 0; day < 730; day += 1) {
      const date = addDays(from, day);
      const tasks = core
        .plan(date)
        .tasks.filter((task) => task.peptideId === peptide.id);
      const done = core.completedForDate(date);
      if (tasks.length && !tasks.some((task) => done[task.taskId])) return date;
    }
    return null;
  }

  function details(peptide, date = h.todayString()) {
    const config = peptide.titration;
    if (!peptide.active || !config?.enabled || !config.nextReviewDate)
      return null;
    if (peptide.stoppedDate && date >= peptide.stoppedDate) return null;
    if (peptide.endDate && date > peptide.endDate) return null;
    const effectiveDate = nextDoseDate(
      peptide,
      date < config.nextReviewDate ? config.nextReviewDate : date,
    );
    if (!effectiveDate) return null;
    const current = core.doseForDate(peptide, date);
    // An already confirmed future change must take effect before another review.
    if (peptide.doseChanges.some((change) => change.date > date)) return null;
    const planned = (config.plannedSteps || [])[0];
    const reducing = ["decrease", "stop"].includes(config.mode);
    let suggested =
      config.mode === "review"
        ? current.amount
        : reducing
          ? Math.max(
              Number(config.targetDose) || 0,
              rounded(current.amount - Number(config.increment)),
            )
          : planned
            ? planned.amount
            : rounded(current.amount + Number(config.increment));
    if (!reducing && positive(config.maxDose))
      suggested = Math.max(
        current.amount,
        Math.min(suggested, Number(config.maxDose)),
      );
    return {
      config,
      current,
      suggested,
      effectiveDate,
      due: date >= config.nextReviewDate,
    };
  }

  function migratePlans() {
    let changed = false;
    const today = h.todayString();
    core.state.stack.forEach((peptide) => {
      if (
        peptide.titration ||
        !positive(peptide.reviewEveryDays) ||
        !positive(peptide.stepAmount)
      )
        return;
      const future = peptide.doseChanges.filter(
        (change) => change.date > today,
      );
      if (!future.length) return;
      const current = core.doseForDate(peptide, today);
      if (future.some((change) => change.unit !== current.unit)) return;
      peptide.titration = {
        enabled: true,
        cadenceDays: Number(peptide.reviewEveryDays),
        increment: Number(peptide.stepAmount),
        maxDose: Math.max(
          current.amount,
          ...future.map((change) => change.amount),
        ),
        nextReviewDate: future[0].date,
        plannedSteps: future,
        decisions: [],
      };
      peptide.doseChanges = peptide.doseChanges.filter(
        (change) => change.date <= today,
      );
      changed = true;
    });
    if (changed) core.commit();
  }

  function loadEditor(peptide) {
    editorId = peptide?.id || null;
    const config = peptide?.titration;
    el("titrationEnabled").checked = Boolean(
      config?.enabled || config?.mode === "maintain",
    );
    el("titrationMode").value =
      config?.mode && config.mode !== "stopped" ? config.mode : "increase";
    el("titrationTarget").value =
      config?.mode === "decrease" ? (config.targetDose ?? "") : "";
    el("titrationCadence").value = config?.cadenceDays || 28;
    el("titrationIncrement").value =
      config?.increment ?? peptide?.stepAmount ?? "";
    el("titrationMax").value = config?.maxDose || "";
    el("titrationNextDate").value =
      config?.nextReviewDate ||
      addDays(
        peptide
          ? h.todayString()
          : el("startDateInput").value || h.todayString(),
        28,
      );
    updateEditor();
  }

  function updateEditor() {
    const enabled = el("titrationEnabled").checked;
    const mode = el("titrationMode").value;
    const weekly = mode === "review";
    const scheduled = enabled && mode !== "maintain";
    const reducing = mode === "decrease" || mode === "stop";
    el("titrationFields").hidden = !enabled;
    ["titrationCadence", "titrationIncrement", "titrationNextDate"].forEach(
      (id) => {
        const needed = scheduled && !(weekly && id === "titrationIncrement");
        el(id).required = needed;
        el(id).disabled = !needed;
        el(id).closest("label").hidden =
          mode === "maintain" || (weekly && id === "titrationIncrement");
      },
    );
    el("titrationCadence").readOnly = weekly;
    if (weekly) el("titrationCadence").value = 7;
    const amount = Number(el("doseAmountInput").value);
    const increment = Number(el("titrationIncrement").value);
    const max = Number(el("titrationMax").value);
    const target = mode === "stop" ? 0 : Number(el("titrationTarget").value);
    const suggested = reducing
      ? Math.max(target, rounded(amount - increment))
      : positive(max)
        ? Math.min(amount + increment, max)
        : amount + increment;
    const unit = el("doseUnitInput").value;
    el("titrationUnitLabel").textContent =
      `${reducing ? "Decrease" : "Increase"} (${unit})`;
    el("titrationTargetLabel").textContent = `Maintenance dose (${unit})`;
    el("titrationTargetField").hidden = mode !== "decrease";
    el("titrationTarget").disabled = !enabled || mode !== "decrease";
    el("titrationTarget").required = enabled && mode === "decrease";
    el("titrationTarget").setCustomValidity(
      enabled && mode === "decrease" && target >= amount
        ? "Maintenance dose must be below the current dose."
        : "",
    );
    el("titrationMaxField").hidden = mode !== "increase";
    el("titrationMax").disabled = !enabled || mode !== "increase";
    el("titrationMaxLabel").textContent =
      `Stop increasing at (${unit}, optional)`;
    el("titrationPreview").textContent = weekly
      ? `Weekly review / ${h.doseLabel(amount, unit)} current dose / no planned increase`
      : mode === "maintain"
        ? `Maintain ${h.doseLabel(amount, unit)}. No scheduled increases or decreases.`
        : positive(amount) && positive(increment)
          ? `${h.doseLabel(amount, unit)} now · ${h.doseLabel(rounded(suggested), unit)} planned next · every ${el("titrationCadence").value} days`
          : "";
  }

  function readEditor(peptide) {
    if (!el("titrationEnabled").checked)
      return peptide?.titration
        ? { ...peptide.titration, enabled: false }
        : null;
    const previous = peptide?.titration;
    const mode = el("titrationMode").value;
    const config = {
      enabled: mode !== "maintain",
      mode,
      targetDose:
        mode === "stop"
          ? 0
          : mode === "decrease"
            ? Number(el("titrationTarget").value)
            : null,
      cadenceDays: mode === "review" ? 7 : Number(el("titrationCadence").value),
      increment: mode === "review" ? 0 : Number(el("titrationIncrement").value),
      maxDose:
        mode === "increase" && positive(el("titrationMax").value)
          ? Number(el("titrationMax").value)
          : null,
      nextReviewDate: el("titrationNextDate").value,
      decisions: previous?.decisions || [],
      plannedSteps: [],
    };
    if (
      previous &&
      mode === (previous.mode || "increase") &&
      ["cadenceDays", "increment", "maxDose", "nextReviewDate"].every(
        (key) => config[key] === previous[key],
      ) &&
      el("doseUnitInput").value === peptide.doseUnit
    ) {
      config.plannedSteps = previous.plannedSteps || [];
    }
    return config;
  }

  function card(peptide, info, actionable) {
    const { config, current, suggested, effectiveDate, due } = info;
    const prefix = actionable ? "today" : "calendar";
    const id = `${prefix}-${peptide.id}`;
    const atLimit = suggested === current.amount;
    const units = (amount) =>
      peptide.measurementPending
        ? "Measurement setup needed"
        : amount === 0
          ? "No injection / protocol ends"
          : h.unitsLabel(core.unitsForDose(peptide, amount, current.unit));
    const snapshot = core.snapshotForPeptide(peptide, h.todayString());
    const lastDecision = (config.decisions || []).at(-1);
    return `<article class="titration-item">
      <div class="titration-heading"><h3>${esc(peptide.name)}</h3><span class="status-chip">${due ? "Check-in due" : h.shortDate(config.nextReviewDate)}</span></div>
      <p>Current: <strong>${esc(h.doseLabel(current.amount, current.unit))}</strong> · ${units(current.amount)}</p>
      <p>${config.mode === "review" ? "Weekly protocol review" : atLimit ? "At your plan's dose limit." : `Your plan: <strong>${suggested === 0 ? "End protocol" : esc(h.doseLabel(suggested, current.unit))}</strong> next · ${units(suggested)}`}</p>
      ${lastDecision ? `<p>Last check-in ${h.shortDate(lastDecision.date)}: ${lastDecision.choice === "hold" ? "stayed at" : "changed to"} ${esc(h.doseLabel(lastDecision.amount, lastDecision.unit))}</p>` : ""}
      ${due && !actionable ? '<button type="button" class="secondary-button" data-nav="dashboard">Review on Today</button>' : ""}
      ${
        due && actionable
          ? `<p>${esc(snapshot.summary)}</p>
        <p>Effective ${h.shortDate(effectiveDate)} · next review ${h.shortDate(addDays(effectiveDate, config.cadenceDays))}</p>
        <form class="titration-decision" data-titration-form="${esc(peptide.id)}">
          <label for="amount-${esc(id)}">Next dose (${esc(current.unit)})</label>
          <div class="titration-input"><input id="amount-${esc(id)}" name="amount" type="number" inputmode="decimal" min="${config.mode === "stop" ? 0 : 0.001}" step="0.001" value="${suggested}" required><output>${units(suggested)}</output></div>
          <div class="titration-actions"><button class="secondary-button" type="button" data-titration-hold="${esc(peptide.id)}">Stay at ${esc(h.doseLabel(current.amount, current.unit))}</button><button class="primary-button" type="submit">${suggested === 0 ? "Confirm planned stop" : "Confirm dose"}</button></div>
          <p class="titration-error" role="alert"></p>
        </form>`
          : ""
      }
    </article>`;
  }

  function render() {
    const items = core.state.stack
      .map((peptide) => ({ peptide, info: details(peptide) }))
      .filter((item) => item.info);
    const due = items.filter((item) => item.info.due);
    el("titrationSection").hidden = due.length === 0;
    el("titrationStatus").textContent = due.length
      ? `${due.length} due`
      : "On schedule";
    el("titrationList").innerHTML = due
      .map(
        ({ peptide, info }) =>
          `<details class="dose-review"><summary><span><strong>${esc(peptide.name)}</strong><small>Your scheduled dose review is due</small></span><span>Review</span></summary>${card(peptide, info, true)}</details>`,
      )
      .join("");
    const selected = core.state.selectedDate;
    el("calendarTitration").innerHTML =
      selected === h.todayString()
        ? due.map(({ peptide, info }) => card(peptide, info, false)).join("")
        : "";
    if (editorId && !core.findPeptide(editorId)) loadEditor(null);
  }

  function decide(id, choice, amount) {
    const peptide = core.findPeptide(id);
    const info = peptide && details(peptide);
    if (!info?.due)
      throw new Error("This review is no longer due. Refresh your dashboard.");
    const reducing = ["decrease", "stop"].includes(info.config.mode);
    const plannedStop = info.config.mode === "stop" && Number(amount) === 0;
    if (choice !== "hold" && !positive(amount) && !plannedStop)
      throw new Error("Enter a dose greater than zero.");
    if (
      choice !== "hold" &&
      reducing &&
      (Number(amount) < Number(info.config.targetDose || 0) ||
        Number(amount) > info.current.amount)
    )
      throw new Error(
        "Enter a dose between your plan's endpoint and the current dose.",
      );
    if (
      choice !== "hold" &&
      positive(info.config.maxDose) &&
      amount > info.config.maxDose
    )
      throw new Error(
        `Your plan stops at ${h.doseLabel(info.config.maxDose, info.current.unit)}. Update your protocol to change that limit.`,
      );
    const target = choice === "hold" ? info.current.amount : Number(amount);
    const held = target === info.current.amount;
    if (!held && target > 0)
      addDoseChange.call(core, {
        peptideId: id,
        date: info.effectiveDate,
        amount: target,
        unit: info.current.unit,
        note: "Confirmed titration check-in",
      });
    if (!held && target === 0) peptide.stoppedDate = info.effectiveDate;
    const planned = info.config.plannedSteps || [];
    const followsPlan = !held && target === info.suggested && planned.length;
    info.config.plannedSteps = followsPlan ? planned.slice(1) : [];
    info.config.nextReviewDate = addDays(
      info.effectiveDate,
      info.config.cadenceDays,
    );
    if (!held && reducing && target === Number(info.config.targetDose || 0)) {
      info.config.enabled = false;
      info.config.mode = target === 0 ? "stopped" : "maintain";
      info.config.endpointDate = info.effectiveDate;
      info.config.nextReviewDate = "";
      peptide.reviewEveryDays = "";
      peptide.stepAmount = 0;
    }
    info.config.decisions = [
      ...(info.config.decisions || []),
      {
        date: h.todayString(),
        effectiveDate: info.effectiveDate,
        choice: held ? "hold" : "change",
        from: info.current.amount,
        amount: target,
        unit: info.current.unit,
      },
    ];
    core.commit();
    if (editorId === id) loadEditor(peptide);
    window.PepsRender();
  }

  const unlock = core.unlock;
  core.unlock = async function (...args) {
    const result = await unlock.apply(core, args);
    if (result.ok) migratePlans();
    return result;
  };
  const syncNow = core.syncNow;
  core.syncNow = async function (...args) {
    await syncNow.apply(core, args);
    migratePlans();
  };
  const plan = core.plan;
  core.plan = function (date) {
    const result = plan.call(core, date);
    core.state.stack.forEach((peptide) => {
      const config = peptide.titration;
      if (
        peptide.active &&
        config?.enabled &&
        config.nextReviewDate &&
        (!peptide.endDate || date <= peptide.endDate) &&
        (date === config.nextReviewDate ||
          (date === h.todayString() && config.nextReviewDate < date))
      ) {
        result.events.push({
          kind: "review",
          label: `${peptide.name} dose check-in`,
        });
      }
    });
    return result;
  };
  const savePeptide = core.savePeptide;
  core.savePeptide = function (peptide) {
    const previous = core.findPeptide(peptide.id);
    if (peptide.titration?.enabled) {
      peptide.reviewEveryDays = peptide.titration.cadenceDays;
      peptide.stepAmount = peptide.titration.increment;
      if (previous && !previous.titration?.enabled) {
        peptide.titration.plannedSteps = peptide.doseChanges.filter(
          (change) =>
            change.date > h.todayString() && change.date > peptide.startDate,
        );
        peptide.doseChanges = peptide.doseChanges.filter(
          (change) =>
            change.date <= h.todayString() || change.date <= peptide.startDate,
        );
      }
      if (previous?.titration?.enabled) {
        const oldDose = core.doseForDate(previous, h.todayString());
        const latest = peptide.doseChanges
          .filter((change) => change.date <= h.todayString())
          .at(-1);
        if (
          latest &&
          (latest.amount !== oldDose.amount || latest.unit !== oldDose.unit)
        ) {
          peptide.titration.nextReviewDate = addDays(
            h.todayString(),
            peptide.titration.cadenceDays,
          );
          peptide.titration.plannedSteps = [];
        }
      }
    } else if (peptide.titration) {
      peptide.reviewEveryDays = "";
      peptide.stepAmount = 0;
    }
    return savePeptide.call(core, peptide);
  };
  const addDoseChange = core.addDoseChange;
  core.addDoseChange = function (input) {
    const result = addDoseChange.call(core, input);
    const config = core.findPeptide(input.peptideId)?.titration;
    if (result && config?.enabled) {
      config.nextReviewDate = addDays(result.date, config.cadenceDays);
      config.plannedSteps = [];
      core.commit();
    }
    return result;
  };
  window.PepsTitration = {
    loadEditor,
    readEditor,
    render,
    details,
    decide,
    migratePlans,
  };
  document.addEventListener("DOMContentLoaded", () => {
    window.addEventListener("focus", () => {
      if (core.account) window.PepsRender();
    });
    [
      "titrationEnabled",
      "titrationMode",
      "titrationTarget",
      "titrationCadence",
      "titrationIncrement",
      "titrationMax",
      "titrationNextDate",
      "doseAmountInput",
      "doseUnitInput",
    ].forEach((id) => el(id).addEventListener("input", updateEditor));
    el("titrationMode").addEventListener("change", () => {
      if (el("titrationMode").value === "review")
        el("titrationNextDate").value = addDays(
          editorId
            ? h.todayString()
            : el("startDateInput").value || h.todayString(),
          7,
        );
    });
    el("titrationCadence").addEventListener("change", () => {
      if (!editorId && el("startDateInput").value)
        el("titrationNextDate").value = addDays(
          el("startDateInput").value,
          Number(el("titrationCadence").value) || 28,
        );
    });
    el("startDateInput").addEventListener("change", () => {
      if (!editorId && el("startDateInput").value)
        el("titrationNextDate").value = addDays(
          el("startDateInput").value,
          Number(el("titrationCadence").value) || 28,
        );
    });
    document.addEventListener("click", (event) => {
      const hold = event.target.closest("[data-titration-hold]");
      if (hold) {
        try {
          decide(hold.dataset.titrationHold, "hold");
        } catch (error) {
          hold.closest("form").querySelector(".titration-error").textContent =
            error.message;
        }
      }
    });
    document.addEventListener("input", (event) => {
      const form = event.target.closest("[data-titration-form]");
      if (!form) return;
      const peptide = core.findPeptide(form.dataset.titrationForm);
      const current = core.doseForDate(peptide, h.todayString());
      const amount = Number(event.target.value);
      form.querySelector("output").textContent = peptide.measurementPending
        ? "Measurement setup needed"
        : amount === 0 && peptide.titration.mode === "stop"
          ? "No injection / protocol ends"
          : positive(amount)
            ? h.unitsLabel(core.unitsForDose(peptide, amount, current.unit))
            : "";
      form.querySelector('button[type="submit"]').textContent =
        amount === 0 && peptide.titration.mode === "stop"
          ? "Confirm planned stop"
          : "Confirm dose";
    });
    document.addEventListener("submit", (event) => {
      const form = event.target.closest("[data-titration-form]");
      if (!form) return;
      event.preventDefault();
      try {
        decide(
          form.dataset.titrationForm,
          "change",
          Number(new FormData(form).get("amount")),
        );
      } catch (error) {
        form.querySelector(".titration-error").textContent = error.message;
      }
    });
  });
})();
