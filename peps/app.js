!(function () {
  "use strict";
  const e = window.PepsCore,
    t = e.helpers,
    a = (e) => document.getElementById(e),
    n = ["dashboard", "calendar", "calculator", "progress", "settings"];
  let s = "dashboard",
    o = "unlock",
    i = null;
  async function l() {
    const t = a("profileSelect").value;
    (a("usernameInput").value = t),
      (a("authError").textContent = ""),
      (a("authModeText").textContent = "Checking profile...");
    try {
      const n = await e.accountStatus(t);
      (o = n.exists ? "unlock" : "create"),
        (a("unlockButtonText").textContent =
          "create" === o ? "Create private password" : "Unlock"),
        (a("authModeText").textContent =
          "create" === o
            ? `${n.label} has not set a password yet. Create one to start a private profile.`
            : `${n.label} profile is ready.`);
    } catch (e) {
      console.warn(e),
        (a("authModeText").textContent =
          "Could not check sync. You can try unlocking anyway."),
        (o = "unlock");
    }
  }
  async function d(t) {
    t.preventDefault();
    const n = a("profileSelect").value,
      s = a("passwordInput").value;
    let i;
    (a("authError").textContent = ""),
      E("create" === o ? "Creating" : "Unlocking", "working");
    try {
      i = await e.unlock(n, s, { create: "create" === o });
    } catch (e) {
      return (
        console.warn(e),
        (a("authError").textContent =
          "Sync is unavailable right now. Check the Supabase project and try again."),
        void E("Sync failed", "error")
      );
    }
    if (!i.ok) {
      const e = {
        setup_required: "This profile needs first-time password setup.",
        short_password: "Use at least 6 characters.",
        bad_password: "Incorrect password.",
      };
      return (
        (a("authError").textContent = e[i.reason] || "Could not unlock."),
        E("Locked", "error"),
        void (
          "setup_required" === i.reason &&
          ((o = "create"),
          (a("unlockButtonText").textContent = "Create private password"))
        )
      );
    }
    document.body.classList.remove("locked"),
      (a("authScreen").hidden = !0),
      (a("passwordInput").value = ""),
      E("Synced", "synced"),
      p(),
      i.created && (r("dashboard"), y());
  }
  function c() {
    window.PepsExperience.closeEditor(),
      e.lock(),
      document.body.classList.add("locked"),
      (a("authScreen").hidden = !1),
      E("Locked"),
      l();
  }
  async function u() {
    try {
      E("Syncing", "working"),
        await e.syncNow(),
        p(),
        E("Synced", "synced"),
        H("Synced");
    } catch (e) {
      console.warn(e), E("Sync failed", "error"), H("Sync failed");
    }
  }
  function r(e, scroll = true) {
    (s = n.includes(e) ? e : "dashboard"),
      n.forEach((e) => a(`view-${e}`).classList.toggle("active", e === s)),
      document
        .querySelectorAll("[data-nav]")
        .forEach((e) => e.classList.toggle("active", e.dataset.nav === s)),
      scroll && window.scrollTo({ top: 0, behavior: "instant" });
  }
  function p() {
    a("profileEyebrow").textContent = `${e.state.profileName} profile`;
    (function () {
      const n = e.state,
        s = new Date(n.viewYear, n.viewMonth, 1),
        o = t.addDays(s, -s.getDay());
      (a("monthTitle").textContent = s.toLocaleDateString(void 0, {
        month: "long",
        year: "numeric",
      })),
        (a("jumpDate").value = n.selectedDate),
        (a("calendarGrid").innerHTML = Array.from({ length: 42 }, (a, s) => {
          const i = t.addDays(o, s),
            l = t.dateStr(i),
            d = e.plan(l),
            c = ["day-cell"];
          return (
            i.getMonth() !== n.viewMonth && c.push("muted"),
            l === n.selectedDate && c.push("selected"),
            l === t.todayString() && c.push("today"),
            n.checkins[l] && c.push("has-checkin"),
            `<button class="${c.join(" ")}" type="button" data-date="${l}" aria-label="${t.longDate(l)}">\n        <span class="day-number">${i.getDate()}</span>\n        <span class="event-stack">${d.events
              .slice(0, 4)
              .map(
                (e) =>
                  `<span class="event-pill ${e.kind}">${t.escapeHtml(e.label)}</span>`,
              )
              .join("")}</span>\n      </button>`
          );
        }).join(""));
    })(),
      (function () {
        const n = e.state,
          s = e.plan(n.selectedDate),
          o = n.checkins[n.selectedDate] || {};
        (a("selectedDateTitle").textContent = t.longDate(n.selectedDate)),
          (a("cycleBadge").textContent = `${s.tasks.length} scheduled`),
          (a("selectedTasks").innerHTML = s.tasks.length
            ? s.tasks.map(g).join("")
            : '<div class="empty-state">No pulls scheduled.</div>'),
          (a("dayActions").innerHTML = (function (a) {
            const n = e.reviewDue(a);
            return n.length
              ? n
                  .map(({ peptide: e, snapshot: n }) => {
                    const s = n.dose,
                      o = e.stepAmount || 0;
                    return `<div class="action-group"><h3>${t.escapeHtml(e.name)} review</h3><p>${t.escapeHtml(n.summary)}</p><div class="action-row"><button class="action-button" type="button" data-review-choice="hold" data-peptide-id="${e.id}" data-date="${a}">Hold ${t.escapeHtml(t.doseLabel(s.amount, s.unit))}</button>${o ? `<button class="action-button" type="button" data-review-choice="increase" data-peptide-id="${e.id}" data-date="${a}">Increase</button><button class="action-button" type="button" data-review-choice="decrease" data-peptide-id="${e.id}" data-date="${a}">Decrease</button>` : ""}</div></div>`;
                  })
                  .join("")
              : "";
          })(n.selectedDate)),
          (a("weightInput").value = o.weight ?? ""),
          (a("notesInput").value = o.notes ?? ""),
          (a("checkinSavedState").textContent = n.checkins[n.selectedDate]
            ? "Saved"
            : "");
      })(),
      m(),
      (function () {
        const n = e.state.stack
          .flatMap((e) =>
            (e.doseChanges || []).map((t) => ({ peptide: e, change: t })),
          )
          .sort((e, t) => t.change.date.localeCompare(e.change.date));
        a("changeHistory").innerHTML = n.length
          ? n
              .map(
                ({ peptide: e, change: a }) =>
                  `<article class="history-row"><div><strong>${t.escapeHtml(e.name)}</strong><span>${t.shortDate(a.date)}</span></div><p>${t.escapeHtml(t.doseLabel(a.amount, a.unit))}${a.note ? ` · ${t.escapeHtml(a.note)}` : ""}</p></article>`,
              )
              .join("")
          : '<div class="empty-state">No dose changes saved.</div>';
      })(),
      L(),
      x(),
      r(s, false),
      window.PepsTitration.render(),
      window.PepsProtocol.render(),
      window.PepsExperience.render();
  }
  function m() {
    const n = e.state.stack,
      s = a("peptideIdInput").value;
    (a("stackList").innerHTML = n.length
      ? n.map(h).join("")
      : '<div class="empty-state">No protocol configured.</div>'),
      n.length &&
        (!s || !e.findPeptide(s)) &&
        !window.PepsProtocol.isCreating() &&
        f(n[0].id),
      !n.length && !s && !window.PepsProtocol.isCreating() && y(),
      (function () {
        const n = a("changePeptideSelect"),
          s = n.value;
        (n.innerHTML = e.state.stack
          .map(
            (e) => `<option value="${e.id}">${t.escapeHtml(e.name)}</option>`,
          )
          .join("")),
          e.findPeptide(s) && (n.value = s),
          !n.value && e.state.stack[0] && (n.value = e.state.stack[0].id);
        const o = e.findPeptide(n.value);
        if (o && !a("changeAmountInput").value) {
          const t = e.doseForDate(o, e.state.selectedDate);
          (a("changeAmountInput").value = t.amount),
            (a("changeUnitInput").value = t.unit);
        }
        a("changeDateInput").value ||= e.state.selectedDate;
      })();
  }
  function g(a) {
    const n = e.state.selectedDate,
      s = Boolean(e.completedForDate(n)[a.taskId]);
    return `<article class="task-card ${s ? "done" : ""}"><h3>${t.escapeHtml(a.name)} <strong>${a.measurementPending ? "Setup needed" : t.unitsLabel(a.units)}</strong></h3><p>${t.escapeHtml(a.doseLabel)} · ${t.escapeHtml(a.detail)}</p><button class="done-inline" type="button" aria-pressed="${s}" data-dose-toggle data-date="${n}" data-task-id="${t.escapeHtml(a.taskId)}" data-done="${s}" data-name="${t.escapeHtml(a.name)}" data-dose-label="${t.escapeHtml(a.doseLabel)}" data-time="${t.escapeHtml(a.time)}"><svg aria-hidden="true"><use href="#icon-check"></use></svg><span>${s ? "Done" : "Mark done"}</span></button>${a.warning ? `<div class="warning">${t.escapeHtml(a.warning)}</div>` : ""}</article>`;
  }
  function h(peptide) {
    return window.PepsExperience.stackCard(peptide);
  }
  function f(t) {
    const n = e.findPeptide(t);
    if (!n) return;
    const s = e.doseForDate(n, e.helpers.todayString()),
      o = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    (a("peptideIdInput").value = n.id),
      (a("peptideFormTitle").textContent = n.name),
      (a("peptideFormMode").textContent = "Editing"),
      (a("peptideNameInput").value = n.name),
      (a("powderMgInput").value = n.powderMg),
      (a("bacMlInput").value = n.bacMl),
      (a("doseAmountInput").value = s.amount),
      (a("doseUnitInput").value = s.unit),
      (a("timeInput").value = n.times.length > 1 ? "AM,PM" : n.times[0]),
      (a("frequencyInput").value = n.frequency),
      (a("intervalDaysInput").value = n.intervalDays),
      (a("weekdaysInput").value = (n.weekdays || [])
        .map((e) => o[e])
        .filter(Boolean)
        .join(", ")),
      (a("startDateInput").value = n.startDate),
      (a("endDateInput").value = n.endDate),
      (a("cycleOnInput").value = n.cycleOnDays),
      (a("cycleOffInput").value = n.cycleOffDays),
      (a("activeInput").value = String(n.active)),
      (a("reviewEveryInput").value = n.reviewEveryDays),
      (a("stepAmountInput").value = n.stepAmount),
      (a("deletePeptideBtn").disabled = !1),
      window.PepsTitration.loadEditor(n);
  }
  function y() {
    const n = t.todayString();
    (a("peptideIdInput").value = ""),
      (a("peptideFormTitle").textContent = "New peptide"),
      (a("peptideFormMode").textContent = ""),
      (a("peptideNameInput").value = ""),
      (a("powderMgInput").value = ""),
      (a("bacMlInput").value = ""),
      (a("doseAmountInput").value = ""),
      (a("doseUnitInput").value = "mg"),
      (a("timeInput").value = "Any"),
      (a("frequencyInput").value = "daily"),
      (a("intervalDaysInput").value = "1"),
      (a("weekdaysInput").value = ""),
      (a("startDateInput").value = n),
      (a("endDateInput").value = ""),
      (a("cycleOnInput").value = ""),
      (a("cycleOffInput").value = ""),
      (a("activeInput").value = "true"),
      (a("reviewEveryInput").value = ""),
      (a("stepAmountInput").value = ""),
      (a("deletePeptideBtn").disabled = !0),
      window.PepsTitration.loadEditor(null);
  }
  function b() {
    const n = a("peptideIdInput").value,
      s = n ? e.findPeptide(n) : null,
      o = a("peptideNameInput").value.trim() || "Peptide",
      i =
        n ||
        (function (a) {
          const n = t.slug(a);
          let s = n,
            o = 2;
          for (; e.findPeptide(s); ) (s = `${n}-${o}`), (o += 1);
          return s;
        })(o),
      l = Number(a("doseAmountInput").value),
      d = a("doseUnitInput").value;
    let c = s
      ? [...(s.doseChanges || [])]
      : [
          {
            date: a("startDateInput").value,
            amount: l,
            unit: d,
            note: "Starting dose",
          },
        ];
    if (s) {
      const n = e.doseForDate(s, t.todayString());
      (Number(n.amount) === l && n.unit === d) ||
        c.push({
          date: t.todayString(),
          amount: l,
          unit: d,
          note: "Protocol edit",
        });
    }
    return {
      id: i,
      name: o,
      powderMg: Number(a("powderMgInput").value),
      bacMl: Number(a("bacMlInput").value),
      doseAmount: l,
      doseUnit: d,
      times: a("timeInput").value.split(","),
      frequency: a("frequencyInput").value,
      intervalDays: Number(
        a("intervalDaysInput").value ||
          ("weekly" === a("frequencyInput").value ? 7 : 1),
      ),
      weekdays: a("weekdaysInput").value,
      startDate: a("startDateInput").value,
      endDate: a("endDateInput").value,
      cycleOnDays: a("cycleOnInput").value,
      cycleOffDays: a("cycleOffInput").value,
      active: "true" === a("activeInput").value,
      reviewEveryDays: a("reviewEveryInput").value,
      stepAmount: Number(a("stepAmountInput").value || 0),
      duration: window.PepsProtocol.readDuration(s),
      measurementPending: a("measurementMode").value === "later",
      stoppedDate: s?.stoppedDate || "",
      titration: window.PepsTitration.readEditor(s),
      doseChanges: c,
    };
  }
  function I(event) {
    event.preventDefault();
    try {
      const saved = e.savePeptide(b());
      if (!saved) return;
      a("peptideIdInput").value = saved.id;
      f(saved.id);
      window.PepsExperience.closeEditor();
      p();
      r("settings");
      H("Protocol saved");
    } catch (error) {
      a("protocolError").textContent = error.message;
    }
  }
  function k() {
    const id = a("peptideIdInput").value;
    if (
      !id ||
      !confirm("Remove this peptide and its future schedule from your stack?")
    )
      return;
    e.deletePeptide(id);
    a("peptideIdInput").value = "";
    window.PepsExperience.closeEditor();
    p();
    H("Peptide removed");
  }
  function w(t) {
    t.preventDefault(),
      e.addDoseChange({
        peptideId: a("changePeptideSelect").value,
        date: a("changeDateInput").value || e.state.selectedDate,
        amount: Number(a("changeAmountInput").value),
        unit: a("changeUnitInput").value,
        note: a("changeNoteInput").value.trim(),
      }) && ((a("changeNoteInput").value = ""), p(), H("Dose change saved"));
  }
  function $(t) {
    t.preventDefault(),
      e.saveCheckin({
        weight:
          "" === a("weightInput").value ? null : Number(a("weightInput").value),
        notes: a("notesInput").value.trim(),
      }),
      p(),
      H("Check-in saved");
  }
  function D(n) {
    n.preventDefault(),
      e.setDate(t.todayString()),
      e.saveCheckin({
        weight:
          "" === a("quickWeightInput").value
            ? null
            : Number(a("quickWeightInput").value),
      }),
      p(),
      H("Check-in saved");
  }
  function N(t) {
    e.setDate(t), p();
  }
  function L() {
    const n = e.calculatorUnits({
      powderMg: Number(a("calcPowderInput").value),
      waterMl: Number(a("calcWaterInput").value),
      doseAmount: Number(a("calcDoseInput").value),
      doseUnit: a("calcDoseUnitInput").value,
      unitsPerMl: Number(a("calcUnitsPerMlInput").value),
    });
    a("unitsCalcResult").innerHTML = n
      ? `<strong>${t.unitsLabel(n.units)}</strong><span>${t.formatNumber(n.mgPerMl)} mg/ml · ${t.formatNumber(n.mgPerUnit)} mg/unit</span>`
      : "<span>Enter vial, water, dose, and syringe scale.</span>";
  }
  function x() {
    const n = e.calculatorWater({
      powderMg: Number(a("easyPowderInput").value),
      doseAmount: Number(a("easyDoseInput").value),
      doseUnit: a("easyDoseUnitInput").value,
      preferredUnits: Number(a("easyUnitsInput").value),
      unitsPerMl: Number(a("easyUnitsPerMlInput").value),
      maxVolume: Number(a("easyMaxVolumeInput").value),
    });
    a("waterCalcResult").innerHTML = n
      ? `<strong>Add ${t.formatNumber(n.waterMl)} ml BAC</strong><span>${t.formatNumber(n.mgPerMl)} mg/ml${n.warning ? ` · ${t.escapeHtml(n.warning)}` : ""}</span>`
      : "<span>Enter powder, dose, target units, and syringe scale.</span>";
  }
  function M() {
    const a = new Blob([JSON.stringify(e.state, null, 2)], {
        type: "application/json",
      }),
      n = document.createElement("a");
    (n.href = URL.createObjectURL(a)),
      (n.download = `peptide-${e.state.profileId}-${t.todayString()}.json`),
      n.click(),
      URL.revokeObjectURL(n.href);
  }
  function C(t) {
    const a = t.target.files[0];
    if (!a) return;
    const n = new FileReader();
    (n.onload = () => {
      e.replace(JSON.parse(n.result)), p(), H("Imported");
    }),
      n.readAsText(a),
      (t.target.value = "");
  }
  function E(e, t = "") {
    (a("syncStatus").textContent = e),
      (a("syncStatus").className = `sync-status ${t}`.trim());
  }
  function H(e) {
    clearTimeout(i),
      (a("toast").textContent = e),
      (a("toast").hidden = !1),
      (i = setTimeout(() => {
        a("toast").hidden = !0;
      }, 2200));
  }
  window.PepsRender = p;
  window.PepsApp = {
    navigate: r,
    newPeptide: y,
    editPeptide: f,
    toast: H,
    removePeptide: k,
  };
  document.addEventListener("DOMContentLoaded", () => {
    a("profileSelect").addEventListener("change", l),
      a("unlockForm").addEventListener("submit", d),
      a("syncBtn").addEventListener("click", u),
      a("lockBtn").addEventListener("click", c),
      document.addEventListener("click", (t) => {
        const a = t.target.closest("[data-nav]");
        a && r(a.dataset.nav);
        const n = t.target.closest("[data-dose-toggle]");
        n &&
          !n.disabled &&
          n.dataset.date <= e.helpers.todayString() &&
          (e.toggleDoseDone({
            date: n.dataset.date,
            taskId: n.dataset.taskId,
            done: "true" !== n.dataset.done,
            name: n.dataset.name,
            doseLabel: n.dataset.doseLabel,
            time: n.dataset.time,
          }),
          p(),
          H("true" === n.dataset.done ? "Marked open" : "Marked done"));
        const s = t.target.closest("[data-review-choice]");
        var o;
        s &&
          ((o = s),
          e.applyReviewChoice({
            peptideId: o.dataset.peptideId,
            date: o.dataset.date,
            choice: o.dataset.reviewChoice,
          }),
          p(),
          H("Review saved"));
      }),
      a("todayBtn").addEventListener("click", () => N(t.todayString())),
      a("prevMonthBtn").addEventListener("click", () => {
        e.shiftMonth(-1), p();
      }),
      a("nextMonthBtn").addEventListener("click", () => {
        e.shiftMonth(1), p();
      }),
      a("jumpDate").addEventListener(
        "change",
        (e) => e.target.value && N(e.target.value),
      ),
      a("calendarGrid").addEventListener("click", (e) => {
        const t = e.target.closest("[data-date]");
        t && N(t.dataset.date);
      }),
      a("checkinForm").addEventListener("submit", $),
      a("quickCheckinForm").addEventListener("submit", D),
      a("stackList").addEventListener("click", (e) => {
        const t = e.target.closest("[data-edit-peptide]");
        t && (f(t.dataset.editPeptide), m());
      }),
      a("newPeptideBtn").addEventListener("click", () => {
        m(), y();
      }),
      a("peptideForm").addEventListener("submit", I),
      a("deletePeptideBtn").addEventListener("click", k),
      a("doseChangeForm").addEventListener("submit", w),
      a("changePeptideSelect").addEventListener("change", () => {
        const t = e.findPeptide(a("changePeptideSelect").value);
        if (!t) return;
        const n = e.doseForDate(
          t,
          a("changeDateInput").value || e.state.selectedDate,
        );
        (a("changeAmountInput").value = n.amount),
          (a("changeUnitInput").value = n.unit);
      }),
      [
        "calcPowderInput",
        "calcWaterInput",
        "calcDoseInput",
        "calcDoseUnitInput",
        "calcUnitsPerMlInput",
      ].forEach((e) => a(e).addEventListener("input", L)),
      [
        "easyPowderInput",
        "easyDoseInput",
        "easyDoseUnitInput",
        "easyUnitsInput",
        "easyUnitsPerMlInput",
        "easyMaxVolumeInput",
      ].forEach((e) => a(e).addEventListener("input", x)),
      a("unitsCalcForm").addEventListener("submit", (e) => e.preventDefault()),
      a("waterCalcForm").addEventListener("submit", (e) => e.preventDefault()),
      a("exportBtn").addEventListener("click", M),
      a("importBtn").addEventListener("click", () =>
        a("importFileInput").click(),
      ),
      a("importFileInput").addEventListener("change", C),
      window.addEventListener("peps-status", (e) =>
        E(e.detail.text, e.detail.tone),
      ),
      E("Locked"),
      r("dashboard"),
      l();
  });
})();
