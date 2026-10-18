(function () {
  "use strict";
  const core = window.PepsCore, h = core.helpers;
  const el = (id) => document.getElementById(id);
  const add = (date, days) => h.dateStr(h.addDays(h.parseDate(date), days));
  let editing = null;
  let stages = [];

  function planAt(peptide, date) {
    return (peptide.dosePlans || []).filter((plan) => plan.effectiveDate <= date)
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)).at(-1);
  }

  function doseForDate(peptide, date) {
    const plan = planAt(peptide, date);
    if (!plan || plan.disabled || date < plan.startDate) return null;
    const manual = peptide.doseChanges.filter((change) => change.date <= date).at(-1);
    if (manual?.date > plan.effectiveDate) return null;
    let anchor = plan.startDate;
    const duration = peptide.duration;
    if (duration?.mode === "cycle") {
      const starts = [plan.startDate, ...(duration.starts || [])].filter((start) => start <= date).sort();
      anchor = starts.at(-1);
      const length = Number(duration.onDays) + Number(duration.offDays);
      if (duration.restart === "auto" && length > 0)
        anchor = add(anchor, Math.floor(h.daysBetween(anchor, date) / length) * length);
    }
    const day = h.daysBetween(anchor, date) + 1;
    const stage = plan.repeat === "final" && anchor > plan.startDate
      ? plan.stages.at(-1)
      : plan.stages.filter((item) => item.day <= day).at(-1);
    if (!stage) return null;
    return { amount: stage.amount, unit: plan.unit, date: add(anchor, stage.day - 1), note: "Preset schedule" };
  }

  function validatePlan(plan, peptide) {
    if (!plan || plan.disabled) return;
    const total = peptide.duration?.mode === "cycle" ? peptide.duration.onDays
      : peptide.endDate ? h.daysBetween(peptide.startDate, peptide.endDate) + 1 : Infinity;
    if (!Array.isArray(plan.stages) || plan.stages.length < 2 || plan.stages[0].day !== 1)
      throw new Error("Add at least two stages, starting on day 1.");
    let previous = 0;
    for (const stage of plan.stages) {
      if (!Number.isInteger(stage.day) || stage.day <= previous || stage.day > total)
        throw new Error("Stage days must increase in order and fit within the course or on-cycle length.");
      if (!Number.isFinite(stage.amount) || stage.amount <= 0)
        throw new Error("Enter a dose greater than zero for every stage. The duration setting controls when dosing ends.");
      previous = stage.day;
    }
  }

  function readStages() {
    stages = [...el("presetStageList").querySelectorAll(".preset-stage")].map((row) => ({
      day: Number(row.querySelector("[data-stage-day]").value),
      amount: Number(row.querySelector("[data-stage-dose]").value),
    }));
    return stages.map((stage) => ({ ...stage }));
  }

  function editorPlan() {
    return {
      effectiveDate: editing ? el("planEffectiveDate").value : el("startDateInput").value,
      startDate: el("startDateInput").value,
      unit: el("doseUnitInput").value,
      repeat: el("presetRepeat").value,
      stages: readStages(),
    };
  }

  function draft() {
    return { startDate: el("startDateInput").value, endDate: el("durationMode").value === "fixed" ? el("endDateInput").value : "",
      duration: { mode: el("durationMode").value, onDays: Number(el("cycleOnWeeks").value) * 7 } };
  }

  function summary(plan = editorPlan(), peptide = draft()) {
    const total = peptide.duration?.mode === "cycle" ? peptide.duration.onDays
      : peptide.endDate ? h.daysBetween(peptide.startDate, peptide.endDate) + 1 : null;
    return plan.stages.map((stage, index) => {
      const end = plan.stages[index + 1]?.day - 1 || total;
      return `Day ${stage.day}${end && end !== stage.day ? `-${end}` : !end ? " onward" : ""}: ${h.doseLabel(stage.amount, plan.unit)}`;
    }).join(" / ") + (peptide.duration?.mode === "cycle" ? ` / After break: ${plan.repeat === "restart" ? "repeat stages" : "resume final dose"}` : "") + ". No dose check-in required.";
  }

  function preview() {
    if (el("dosePlanKind").value !== "preset") return;
    try {
      const plan = editorPlan();
      validatePlan(plan, draft());
      el("presetPreview").textContent = summary(plan);
    } catch (error) { el("presetPreview").textContent = error.message; }
  }

  function renderStages() {
    el("presetStageList").innerHTML = stages.map((stage, index) => `<div class="preset-stage">
      <label><span>Stage ${index + 1}: from day</span><input type="number" data-stage-day min="1" step="1" value="${h.escapeHtml(stage.day)}" ${index === 0 ? "readonly" : ""} required></label>
      <label><span>Dose (${h.escapeHtml(el("doseUnitInput").value)})</span><input type="number" data-stage-dose min="0.001" step="0.001" value="${h.escapeHtml(stage.amount || "")}" required inputmode="decimal"></label>
      <button type="button" class="icon-button" data-remove-stage="${index}" ${index === 0 ? "disabled" : ""} title="Remove stage ${index + 1}" aria-label="Remove stage ${index + 1}"><i data-lucide="trash-2"></i></button>
    </div>`).join("");
    window.lucide?.createIcons();
    updateVisibility();
  }

  function updateVisibility() {
    const kind = el("dosePlanKind").value;
    el("doseAmountInput").readOnly = kind === "preset";
    el("doseAmountInput").title = kind === "preset" ? "Edit stage doses in Dose plan" : "";
    el("presetPlanFields").hidden = kind !== "preset";
    el("reviewPlanChoiceField").hidden = kind !== "review";
    el("protocolPlanChoice").required = kind === "review";
    el("presetRepeatField").hidden = el("durationMode").value !== "cycle";
    el("presetAnchorNote").textContent = el("durationMode").value === "cycle"
      ? `Day 1 is the start of each cycle. First cycle: ${h.shortDate(el("startDateInput").value)}.`
      : `Day 1 is your protocol start: ${h.shortDate(el("startDateInput").value)}.`;
    el("presetStageList").querySelectorAll("input").forEach((input) => { input.disabled = kind !== "preset"; });
    const hasPreset = (editing?.dosePlans || []).at(-1)?.stages;
    const effective = Boolean(editing && (kind === "preset" || hasPreset));
    el("planEffectiveField").hidden = !effective;
    el("planEffectiveNote").hidden = !effective;
    el("planEffectiveDate").disabled = !effective;
    el("planEffectiveDate").required = effective;
    preview();
  }

  function loadEditor(peptide) {
    editing = peptide || null;
    const plan = (peptide?.dosePlans || []).at(-1);
    const preset = plan && !plan.disabled;
    el("dosePlanKind").value = preset ? "preset" : peptide
      ? peptide.titration?.enabled || peptide.titration?.mode === "maintain" ? "review" : "steady" : "";
    if (preset) el("protocolPlanChoice").value = "preset";
    stages = preset ? plan.stages.map((item) => ({ ...item })) : [
      { day: 1, amount: Number(el("doseAmountInput").value) }, { day: 8, amount: 0 },
    ];
    el("presetRepeat").value = plan?.repeat || "restart";
    const today = h.todayString();
    const completed = peptide && Object.keys(core.completedForDate(today)).some((id) => id.startsWith(peptide.id + "-"));
    const minimum = [el("startDateInput").value, completed ? add(today, 1) : today].sort().at(-1);
    el("planEffectiveDate").min = minimum;
    el("planEffectiveDate").value = minimum;
    renderStages();
  }

  function validateEditor() {
    if (el("dosePlanKind").value === "preset") validatePlan(editorPlan(), draft());
  }

  function prepare(peptide) {
    const previous = core.findPeptide(peptide.id);
    const previousPlan = (previous?.dosePlans || []).at(-1);
    const preset = el("dosePlanKind").value === "preset";
    const next = preset ? editorPlan() : { disabled: true, effectiveDate: el("planEffectiveDate").value };
    if (preset) validatePlan(next, peptide);
    if (!preset && (!previousPlan || previousPlan.disabled)) return peptide;
    const signature = (plan) => JSON.stringify(plan && { startDate: plan.startDate, stages: plan.stages, unit: plan.unit, repeat: plan.repeat, disabled: plan.disabled });
    if (signature(next) === signature(previousPlan)) return peptide;
    const date = next.effectiveDate;
    if (!date || (previous && date < el("planEffectiveDate").min)) throw new Error("Choose an effective date that preserves completed doses.");
    peptide.dosePlans = [...(previous?.dosePlans || []).filter((plan) => plan.effectiveDate < date), next];
    const boundary = preset ? next.stages[0] : { amount: peptide.doseAmount };
    peptide.doseChanges = [...(previous?.doseChanges || peptide.doseChanges).filter((change) => change.date < date),
      { date, amount: boundary.amount, unit: peptide.doseUnit, note: preset ? "Preset schedule starts" : "Preset schedule replaced" }];
    if (peptide.stoppedDate > date) peptide.stoppedDate = "";
    if (preset) {
      peptide.titration = null;
      peptide.reviewEveryDays = "";
      peptide.stepAmount = 0;
    } else if (peptide.titration?.enabled && peptide.titration.nextReviewDate < date) {
      peptide.titration.nextReviewDate = date;
    }
    return peptide;
  }

  window.PepsDosePlans = { planAt, doseForDate, validatePlan, loadEditor, validateEditor, prepare, summary, updateVisibility };
  const addDoseChange = core.addDoseChange;
  core.addDoseChange = function (input) {
    const result = addDoseChange.call(core, input);
    const peptide = core.findPeptide(input.peptideId);
    const plan = result && planAt(peptide, result.date);
    if (plan && !plan.disabled) {
      peptide.dosePlans = [...peptide.dosePlans.filter((plan) => plan.effectiveDate < result.date), { effectiveDate: result.date, disabled: true }];
      core.commit();
    }
    return result;
  };
  document.addEventListener("DOMContentLoaded", () => {
    el("dosePlanKind").addEventListener("change", () => {
      el("protocolError").textContent = "";
      const kind = el("dosePlanKind").value;
      el("protocolPlanChoice").value = kind === "review" ? "review" : kind;
      el("protocolPlanChoice").dispatchEvent(new Event("change"));
      if (kind === "preset" && !editing?.dosePlans?.length) {
        stages[0].amount = Number(el("doseAmountInput").value);
        renderStages();
      }
      updateVisibility();
    });
    el("addPresetStage").addEventListener("click", () => {
      readStages(); stages.push({ day: stages.at(-1).day + 7, amount: 0 }); renderStages();
    });
    el("presetStageList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-stage]");
      if (!button) return;
      readStages(); stages.splice(Number(button.dataset.removeStage), 1); renderStages();
    });
    el("presetStageList").addEventListener("input", () => { el("protocolError").textContent = ""; preview(); });
    el("presetRepeat").addEventListener("change", preview);
    el("doseUnitInput").addEventListener("change", () => { readStages(); renderStages(); });
  });
})();
