(function () {
  "use strict";
  const core = window.PepsCore;
  const h = core.helpers;
  const el = (id) => document.getElementById(id);
  const esc = h.escapeHtml;
  const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const add = (day, count) => h.dateStr(h.addDays(h.parseDate(day), count));
  let chartPeriod = "all";
  let settingsTab = "protocol";
  const icons = () => window.lucide.createIcons();
  const doseLabel = (peptide) => {
    const dose = core.doseForDate(peptide, h.todayString());
    return h.doseLabel(dose.amount, dose.unit);
  };

  function durationLabel(peptide) {
    const config = peptide.duration;
    if (config?.mode === "cycle")
      return `${h.formatNumber(config.onDays / 7)} weeks on / ${h.formatNumber(config.offDays / 7)} weeks off`;
    if (config?.mode === "fixed" || peptide.endDate)
      return `Through ${h.shortDate(peptide.endDate)}`;
    return "Ongoing";
  }

  function stackCard(peptide) {
    const status = window.PepsProtocol.cycleStatus(peptide);
    const detail = !peptide.active
      ? "Paused"
      : ["off", "pending", "complete", "stopped", "awaiting"].includes(
            status.phase,
          )
        ? status.label
        : durationLabel(peptide);
    return `<article class="stack-card"><span class="compound-icon">${icon("syringe")}</span><div class="stack-description"><strong>${esc(peptide.name)}</strong><p>${esc(doseLabel(peptide))} · ${esc(h.cadenceLabel(peptide))} · ${esc(peptide.times.join(" + "))}</p><span class="status-chip">${esc(detail)}</span>${peptide.measurementPending ? '<small class="setup-needed">Vial setup needed</small>' : ""}</div><div class="stack-actions"><button class="icon-button" type="button" data-edit-peptide="${esc(peptide.id)}" title="Edit ${esc(peptide.name)}" aria-label="Edit ${esc(peptide.name)}">${icon("pencil")}</button><button class="icon-button" type="button" data-remove-peptide="${esc(peptide.id)}" title="Remove ${esc(peptide.name)}" aria-label="Remove ${esc(peptide.name)}">${icon("trash-2")}</button></div></article>`;
  }

  function completionRows(tasks, day) {
    const completed = core.completedForDate(day);
    if (!tasks.length)
      return '<div class="empty-state"><strong>No pulls scheduled</strong><p>Nothing to take on this date.</p></div>';
    return ["AM", "PM", "Any"]
      .map((time) => {
        const session = tasks.filter((task) => task.time === time);
        if (!session.length) return "";
        return (
          `<div class="session-label">${icon(time === "AM" ? "sun" : time === "PM" ? "moon" : "clock-3")}${time === "AM" ? "Morning" : time === "PM" ? "Evening" : "Any time"}</div>` +
          session
            .map((task) => {
              const done = Boolean(completed[task.taskId]);
              const label = `${done ? "Undo" : "Mark"} ${task.name} ${time} ${done ? "completion" : "as taken"}`;
              const setup = task.inventoryVial
                ? '<button class="link-button" type="button" data-nav="inventory">Set up active vial</button>'
                : `<button class="link-button" type="button" data-nav="settings" data-edit-peptide="${esc(task.peptideId)}">Set up vial</button>`;
              return `<article class="today-dose ${done ? "done" : ""}"><span class="compound-icon">${icon("syringe")}</span><div class="today-dose-main"><strong>${esc(task.name)}</strong><p>${esc(task.doseLabel)} · <span>${task.measurementPending ? "Vial setup needed" : h.unitsLabel(task.units)}</span></p>${task.scheduledChange ? `<small class="scheduled-change">${esc(task.scheduledChange)}</small>` : ""}${task.warning && !task.measurementPending ? `<small class="warning">${esc(task.warning)}</small>` : ""}${task.measurementPending ? setup : ""}</div><div class="completion-action">${done ? '<span class="taken-label">Taken</span>' : ""}<button class="done-toggle" type="button" aria-pressed="${done}" aria-label="${esc(label)}" title="${esc(label)}" data-dose-toggle data-date="${day}" data-task-id="${esc(task.taskId)}" data-done="${done}" data-name="${esc(task.name)}" data-dose-label="${esc(task.doseLabel)}" data-time="${esc(time)}" ${(task.measurementPending && !done) || day > h.todayString() ? "disabled" : ""}>${icon("check")}</button></div></article>`;
            })
            .join("")
        );
      })
      .join("");
  }

  function renderToday() {
    const today = h.todayString();
    const tasks = core.plan(today).tasks;
    const done = tasks.filter(
      (task) => core.completedForDate(today)[task.taskId],
    ).length;
    const latest = h.weightRows().at(-1);
    el("profileAvatar").textContent = (core.state.profileName || "P")
      .slice(0, 1)
      .toUpperCase();
    el("currentDatePill").textContent = h.longDate(today);
    el("dashboardMetrics").innerHTML = [
      {
        label: "Pulls today",
        value: tasks.length,
        detail: `${tasks.length - done} remaining`,
      },
      {
        label: "Taken",
        value: `${done} / ${tasks.length}`,
        detail:
          done === tasks.length && tasks.length
            ? "All done for today"
            : "Completed today",
      },
      {
        label: "Latest weight",
        value: latest
          ? `${h.formatNumber(latest.weight)} <small>lb</small>`
          : "--",
        detail: latest ? h.shortDate(latest.date) : "No weight logged",
      },
    ]
      .map(
        (stat) =>
          `<article><span>${stat.label}</span><strong>${stat.value}</strong><small>${stat.detail}</small></article>`,
      )
      .join("");
    const monday = add(today, -((h.parseDate(today).getDay() + 6) % 7));
    el("weekRibbon").innerHTML = Array.from({ length: 7 }, (_, offset) => {
      const day = add(monday, offset),
        when = h.parseDate(day),
        count = core.plan(day).tasks.length;
      return `<button type="button" data-ribbon-date="${day}" class="${day === today ? "active" : ""}" ${day === today ? 'aria-current="date"' : ""} aria-label="${esc(h.longDate(day))}, ${count} scheduled pulls"><small>${when.toLocaleDateString(undefined, { weekday: "short" })}</small><strong>${when.getDate()}</strong><span class="schedule-dot" ${count ? "" : 'style="visibility:hidden"'}></span></button>`;
    }).join("");
    el("todayCompletionSummary").textContent =
      `${done} of ${tasks.length} taken`;
    el("todayProgress").max = Math.max(1, tasks.length);
    el("todayProgress").value = done;
    el("todayCards").innerHTML = completionRows(tasks, today);
    const empty = core.state.stack.length === 0;
    el("firstVisitWelcome").hidden = !empty;
    el("todayWorkspace").hidden = empty && !h.weightRows().length;
    const checkin = core.state.checkins[today];
    if (document.activeElement !== el("quickWeightInput"))
      el("quickWeightInput").value = checkin?.weight ?? "";
    el("quickCheckinState").textContent = checkin?.weight
      ? "Logged today"
      : "Today";
    const next = [];
    for (let offset = 1; offset <= 60 && next.length < 3; offset++) {
      const day = add(today, offset),
        scheduled = core.plan(day).tasks;
      if (scheduled.length) next.push({ day, tasks: scheduled });
    }
    el("nextUpList").innerHTML = next.length
      ? next
          .map(
            (item) =>
              `<article class="upcoming-item"><span class="date-square"><small>${h.parseDate(item.day).toLocaleDateString(undefined, { weekday: "short" })}</small><strong>${h.parseDate(item.day).getDate()}</strong></span><div><strong>${item.tasks.length} scheduled pulls</strong><p>${[...new Set(item.tasks.map((task) => task.name))].map(esc).join(", ")}</p></div></article>`,
          )
          .join("")
      : '<p class="empty-state">No upcoming pulls scheduled.</p>';
    const selected = core.state.selectedDate;
    const selectedTasks = core.plan(selected).tasks;
    // Protocol.render supplies cycle and stopped-state explanations for empty days.
    if (selectedTasks.length)
      el("selectedTasks").innerHTML = completionRows(selectedTasks, selected);
    el("cycleBadge").textContent =
      `${selectedTasks.filter((task) => core.completedForDate(selected)[task.taskId]).length} / ${selectedTasks.length} taken`;
    document.querySelectorAll("#calendarGrid [data-date]").forEach((button) => {
      const day = button.dataset.date,
        plan = core.plan(day);
      const count = plan.tasks.length;
      button.querySelector(".event-stack").innerHTML =
        `<span class="calendar-count">${count ? `${count} pulls` : ""}</span>${count ? '<span class="schedule-dot"></span>' : ""}${plan.events.some((event) => event.kind === "review") ? '<span class="review-dot" title="Protocol review"></span>' : ""}`;
      button.setAttribute(
        "aria-label",
        `${h.longDate(day)}, ${count} scheduled pulls${core.state.checkins[day]?.weight ? `, weight ${core.state.checkins[day].weight} lb` : ""}`,
      );
      button.setAttribute("aria-pressed", String(day === selected));
    });
  }

  function metricMarkup() {
    const rows = h.weightRows(),
      first = rows[0],
      latest = rows.at(-1);
    const previous = rows.at(-2);
    const daily =
      previous && h.daysBetween(previous.date, latest.date) === 1
        ? latest.weight - previous.weight
        : null;
    const baseline =
      latest && rows.filter((row) => row.date <= add(latest.date, -7)).at(-1);
    const change = baseline ? latest.weight - baseline.weight : null;
    const loss = latest ? first.weight - latest.weight : null;
    const signed = (value) =>
      `${value > 0 ? "+" : ""}${h.formatNumber(value)} lb`;
    const stats = [
      [
        "latest",
        "Latest weight",
        latest ? `${h.formatNumber(latest.weight)} lb` : "--",
        latest ? h.shortDate(latest.date) : "Log your first weight",
      ],
      [
        "total-loss",
        loss !== null && loss < 0 ? "Total weight gained" : "Total weight loss",
        loss === null ? "--" : `${h.formatNumber(Math.abs(loss))} lb`,
        first
          ? `Since ${h.shortDate(first.date)} · ${h.formatNumber(first.weight)} lb`
          : "From your first check-in",
      ],
      [
        "weekly-change",
        baseline && h.daysBetween(baseline.date, latest.date) !== 7
          ? "Recent change"
          : "Weekly change",
        change === null ? "--" : signed(change),
        baseline
          ? `${h.shortDate(baseline.date)} to ${h.shortDate(latest.date)}`
          : "Needs an earlier check-in",
      ],
      [
        "daily-change",
        "Daily change",
        daily === null ? "--" : signed(daily),
        daily === null
          ? "No consecutive-day readings"
          : `${h.shortDate(previous.date)} to ${h.shortDate(latest.date)}`,
      ],
    ];
    return stats
      .map(
        ([type, label, value, detail]) =>
          `<article class="metric-card metric-${type}"><p>${label}</p><strong>${value}</strong><span>${detail}</span></article>`,
      )
      .join("");
  }

  function chart(container, rows) {
    if (!rows.length) {
      container.innerHTML =
        '<div class="empty-state"><strong>Your progress starts here</strong><p>Log a weight to see your trend.</p></div>';
      return;
    }
    const width = Math.max(260, container.clientWidth || 600),
      height = 240,
      pad = 26;
    const min = Math.min(...rows.map((row) => row.weight)) - 1,
      max = Math.max(...rows.map((row) => row.weight)) + 1;
    const elapsed = h.daysBetween(rows[0].date, rows.at(-1).date);
    const points = rows.map((row) => ({
      ...row,
      x:
        pad +
        (elapsed
          ? (h.daysBetween(rows[0].date, row.date) / elapsed) *
            (width - pad * 2)
          : (width - pad * 2) / 2),
      y: 30 + ((max - row.weight) / (max - min)) * 170,
    }));
    const line = points.map((point) => `${point.x},${point.y}`).join(" ");
    const labels = [];
    const stride = Math.max(
      1,
      Math.ceil(points.length / Math.max(3, Math.floor(width / 55))),
    );
    const marks = points
      .map((point, index) => {
        let label = "";
        if (index % stride === 0 || index === points.length - 1) {
          let y = point.y - 12;
          while (
            labels.some(
              (previous) =>
                Math.abs(previous.x - point.x) < 43 &&
                Math.abs(previous.y - y) < 14,
            )
          )
            y -= 16;
          if (y >= 12) {
            labels.push({ x: point.x, y });
            label = `<text x="${point.x}" y="${y}" text-anchor="middle">${h.formatNumber(point.weight)}</text>`;
          }
        }
        return `<g><title>${h.shortDate(point.date)}: ${h.formatNumber(point.weight)} lb</title><circle cx="${point.x}" cy="${point.y}" r="3.5"></circle>${label}</g>`;
      })
      .join("");
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Weight readings from ${h.shortDate(rows[0].date)} to ${h.shortDate(rows.at(-1).date)}"><desc>${rows.map((row) => `${h.shortDate(row.date)}: ${row.weight} lb`).join("; ")}</desc>${[30, 85, 140, 200].map((y) => `<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}"></line>`).join("")}<polygon points="${points[0].x},205 ${line} ${points.at(-1).x},205"></polygon><polyline points="${line}"></polyline>${marks}<text x="${pad}" y="235" class="axis-label">${h.shortDate(rows[0].date)}</text><text x="${width - pad}" y="235" text-anchor="end" class="axis-label">${h.shortDate(rows.at(-1).date)}</text></svg>`;
  }

  function drawCharts() {
    const rows = h.weightRows();
    const visible =
      chartPeriod === "all"
        ? rows
        : rows.filter((row) => row.date >= add(h.todayString(), -28));
    chart(el("dashboardWeightChart"), visible);
    chart(el("weightChart"), rows);
  }

  function renderProgress() {
    const rows = h.weightRows(),
      latest = rows.at(-1);
    el("dashboardAnalyticsGrid").innerHTML = metricMarkup();
    el("metricsGrid").innerHTML = metricMarkup();
    el("dashboardWeightHeadline").innerHTML = latest
      ? `<strong>${h.formatNumber(latest.weight)} <small>lb</small></strong><span>Last check-in · ${h.shortDate(latest.date)}</span>`
      : "";
    el("dashboardChartCaption").textContent = "";
    el("chartCaption").textContent = `${rows.length} weigh-ins`;
    document.querySelectorAll("[data-chart-period]").forEach((button) => {
      const selected = button.dataset.chartPeriod === chartPeriod;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    el("checkinHistory").innerHTML =
      Object.entries(core.state.checkins)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(
          ([day, entry]) =>
            `<article class="checkin-history-row"><div><strong>${h.shortDate(day)}</strong><p>${entry.weight ? `${h.formatNumber(entry.weight)} lb` : "No weight"}${entry.notes ? ` · ${esc(entry.notes)}` : ""}</p></div><button class="icon-button" type="button" data-checkin-date="${day}" aria-label="Edit check-in ${h.shortDate(day)}" title="Edit check-in">${icon("pencil")}</button></article>`,
        )
        .join("") || '<div class="empty-state">No check-ins yet.</div>';
    drawCharts();
  }

  function setSettings(tab) {
    settingsTab = tab;
    el("preferencesPanel").hidden = tab !== "preferences";
    el("protocolPanel").hidden = tab !== "protocol";
    document.querySelectorAll("[data-settings-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.settingsTab === tab);
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.settingsTab === tab),
      );
    });
  }

  function openEditor() {
    if (!el("protocolDialog").open) el("protocolDialog").showModal();
    el("protocolDialog").scrollTop = 0;
    icons();
  }
  function closeEditor() {
    el("protocolDialog").close();
  }
  function render() {
    renderToday();
    renderProgress();
    el("stackCount").textContent = `${core.state.stack.length} peptides`;
    if (!core.state.stack.length)
      el("stackList").innerHTML =
        '<div class="empty-state"><strong>Your stack is empty</strong><p>Add a peptide to start your schedule.</p></div>';
    setSettings(settingsTab);
    window.PepsInventoryUI?.render();
    icons();
  }
  window.PepsExperience = { render, stackCard, closeEditor, drawCharts };

  document.addEventListener("DOMContentLoaded", () => {
    icons();
    document.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.hasAttribute("data-new-protocol")) {
        setSettings("protocol");
        window.PepsApp.navigate("settings");
        el("newPeptideBtn").click();
      }
      if (button.id === "newPeptideBtn") openEditor();
      if (
        button.hasAttribute("data-edit-peptide") &&
        event.composedPath().includes(el("stackList"))
      ) {
        setSettings("protocol");
        openEditor();
      }
      if (button.hasAttribute("data-remove-peptide")) {
        window.PepsApp.editPeptide(button.dataset.removePeptide);
        window.PepsApp.removePeptide();
      }
      if (button.hasAttribute("data-close-protocol")) closeEditor();
      if (button.dataset.settingsTab) setSettings(button.dataset.settingsTab);
      if (button.hasAttribute("data-preferences")) setSettings("preferences");
      if (
        button.dataset.nav === "settings" &&
        !button.hasAttribute("data-preferences")
      )
        setSettings("protocol");
      if (button.dataset.ribbonDate || button.dataset.checkinDate) {
        core.setDate(button.dataset.ribbonDate || button.dataset.checkinDate);
        window.PepsRender();
        window.PepsApp.navigate("calendar");
      }
      if (button.dataset.chartPeriod) {
        chartPeriod = button.dataset.chartPeriod;
        renderProgress();
        icons();
      }
      if (button.dataset.nav) requestAnimationFrame(drawCharts);
    });
    window.addEventListener("resize", drawCharts);
    el("protocolDialog").addEventListener("cancel", () => {
      setSettings("protocol");
    });
  });
})();
