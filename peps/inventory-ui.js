(function () {
  "use strict";
  const core = window.PepsCore, inv = window.PepsInventory, h = core.helpers;
  const el = id => document.getElementById(id), esc = h.escapeHtml, fmt = h.formatNumber;
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  let editing = null;
  const field = (id, label, value, type = "number", attributes = "") => `<label for="${id}">${label}<input id="${id}" type="${type}" value="${esc(value ?? "")}" ${type === "number" ? 'min="0" step="any" inputmode="decimal"' : ""} ${attributes}></label>`;
  const select = (id, label, value, options) => `<label for="${id}">${label}<select id="${id}">${options.map(([key, text]) => `<option value="${esc(key)}" ${key === value ? "selected" : ""}>${esc(text)}</option>`).join("")}</select></label>`;
  const button = (label, action, key, glyph = "plus") => `<button class="secondary-button" type="button" data-inventory-action="${action}" data-inventory-id="${esc(key)}">${icon(glyph)}${esc(label)}</button>`;
  function forecastText(result) {
    if (result.status === "unscheduled") return "No upcoming schedule";
    if (result.status === "covered") return "Covers the confirmed schedule";
    if (result.status === "horizon") return "100+ years at current dose";
    if (!result.days) return "Next dose not covered";
    return result.days < 14 ? `About ${result.days} days of supply` : `About ${fmt(result.days / 7)} weeks of supply`;
  }
  function card(item) {
    const result = inv.forecast(item), peptide = core.findPeptide(item.peptideId);
    const active = inv.activeVial(item), low = result.days !== null && result.days <= item.lowDays;
    const notes = [];
    if (result.unknown.length) notes.push(`${result.unknown.length} mixed vial${result.unknown.length === 1 ? "" : "s"} with unknown remaining amount; excluded from estimate.`);
    if (result.expired.length) notes.push("Stock past its recorded expiration/discard date is excluded.");
    if (result.unassignedMg) notes.push(`${fmt(result.unassignedMg)} mg logged without a vial. Assign below to reconcile.`);
    if (result.overdrawnMg) notes.push(`${fmt(result.overdrawnMg)} mg exceeds recorded vial contents. Correct the balance or dose assignment.`);
    if (peptide?.active && !active) notes.push("No active vial selected.");
    return `<article class="inventory-item ${item.archived ? "archived" : ""}">
      <div class="inventory-item-heading"><span class="compound-icon">${icon("package")}</span><div><h3>${esc(item.name)}</h3><p>${fmt(item.unopened)} unopened &times; ${fmt(item.powderMg)} mg${item.archived ? " / Archived" : ""}</p></div>
        <button type="button" class="icon-button" data-inventory-action="stock" data-inventory-id="${esc(item.id)}" aria-label="Edit ${esc(item.name)} inventory" title="Edit stock">${icon("pencil")}</button></div>
      <div class="inventory-numbers"><div><span>Known remaining</span><strong>${fmt(result.knownMg)} <small>mg</small></strong></div><div><span>${result.doses === null ? "Supply estimate" : `${fmt(result.doses)} full doses at current dose`}</span><strong class="supply-text ${low ? "inventory-low" : ""}">${forecastText(result)}</strong></div></div>
      ${result.dose ? `<p class="inventory-basis">${esc(h.doseLabel(result.dose.amount, result.dose.unit))} per pull / ${esc(h.cadenceLabel(peptide))} / ${esc(peptide.times.join(" + "))}${peptide.duration?.mode === "cycle" || peptide.cycleOffDays ? " / cycle breaks included" : ""}</p>` : '<p class="inventory-basis">Inventory only or paused protocol</p>'}
      ${result.nextShortfall ? `<p class="inventory-basis">First uncovered pull: ${h.shortDate(result.nextShortfall)}</p>` : ""}
      ${notes.map(note => `<p class="inventory-note">${icon("info")}${esc(note)}</p>`).join("")}
      <details data-inventory-detail="${esc(item.id)}"><summary>Vials &amp; usage <span>${item.vials.filter(v => !v.closed).length} mixed</span></summary>
      <div class="inventory-actions">${button("Start new vial", "new-vial", item.id, "flask-conical")}${button("Add existing mixed vial", "existing-vial", item.id)}</div>
      ${item.vials.map((vial, index) => {
        const balance = inv.remaining(item, vial);
        if (vial.openingUndoneAt) return `<div class="inventory-vial"><div><strong>Vial ${index + 1} / Opening undone</strong><p>Returned to unopened stock</p></div></div>`;
        const reason = inv.undoOpeningReason(item, vial);
        const undo = vial.fromStock !== false ? `<button type="button" class="icon-button" title="${esc(reason || "Undo opening")}" aria-label="Undo opening ${esc(item.name)} vial ${index + 1}" data-inventory-action="undo-opening" data-inventory-id="${esc(item.id)}" data-vial-id="${esc(vial.id)}" ${reason ? "disabled" : ""}>${icon("undo-2")}</button>` : "";
        return `<div class="inventory-vial"><div><strong>Vial ${index + 1}${vial.id === active?.id ? ' <span class="status-chip">Active</span>' : ""}${vial.closed ? " / Closed" : ""}</strong><p>${balance === null ? "Remaining unknown" : `${fmt(Math.max(0, balance))} mg remaining`} / ${fmt(vial.powderMg)} mg originally / ${vial.bacMl ? `${fmt(vial.bacMl)} ml BAC` : "BAC unknown"}</p><small>${vial.mixedDate ? `Mixed ${h.shortDate(vial.mixedDate)}` : "Mixed date unknown"}${vial.expiry ? ` / Discard ${h.shortDate(vial.expiry)}` : " / Discard date not provided"}</small></div><div class="inventory-vial-actions"><button type="button" class="icon-button" title="Edit vial" aria-label="Edit ${esc(item.name)} vial ${index + 1}" data-inventory-action="vial" data-inventory-id="${esc(item.id)}" data-vial-id="${esc(vial.id)}">${icon("pencil")}</button>${undo}</div></div>`;
      }).join("")}
      <h4>Recent usage</h4>${inv.entries(item).sort(([, a], [, b]) => b.date.localeCompare(a.date)).slice(0, 20).map(([key, row]) => `<div class="inventory-usage"><div><strong>${fmt(row.amountMg)} mg</strong><span>${h.shortDate(row.date)} / ${esc(row.time)} / ${row.vialId ? `Vial ${item.vials.findIndex(v => v.id === row.vialId) + 1}` : "Unassigned"}</span></div><button type="button" class="icon-button" data-inventory-action="assign" data-inventory-id="${esc(item.id)}" data-usage-key="${esc(key)}" title="Assign vial" aria-label="Assign vial for ${esc(item.name)} ${row.date} ${esc(row.time)}">${icon("arrow-right-left")}</button></div>`).join("") || '<p class="inventory-basis">No usage logged since inventory setup.</p>'}
      </details></article>`;
  }
  function render() {
    if (!el("inventoryList")) return;
    const items = core.state.inventory?.items || [];
    const opened = [...document.querySelectorAll("[data-inventory-detail][open]")].map(node => node.dataset.inventoryDetail);
    const archivedOpen = el("inventoryArchived")?.open;
    const live = items.filter(item => !item.archived), archived = items.filter(item => item.archived);
    el("inventorySummary").innerHTML = `<span><strong>${live.length}</strong> peptides</span><span><strong>${fmt(live.reduce((sum, item) => sum + item.unopened, 0))}</strong> unopened vials</span><span><strong>${live.reduce((sum, item) => sum + item.vials.filter(v => !v.closed).length, 0)}</strong> mixed vials</span>`;
    el("inventoryList").innerHTML = live.map(card).join("") || '<div class="empty-state"><strong>No inventory yet</strong><p>Your stock will appear here.</p></div>';
    if (archived.length) el("inventoryList").insertAdjacentHTML("beforeend", `<details id="inventoryArchived" ${archivedOpen ? "open" : ""}><summary>Archived (${archived.length})</summary>${archived.map(card).join("")}</details>`);
    document.querySelectorAll("[data-inventory-detail]").forEach(node => { node.open = opened.includes(node.dataset.inventoryDetail); });
    el("inventoryList").insertAdjacentHTML("beforeend", '<p class="inventory-footnote">Estimates hold the current dose constant and account for scheduled breaks and recorded expiry dates. Unknown amounts, waste, and future dose changes are not assumed. Supply coverage is not a shelf-life estimate.</p>');
    let alerts = el("inventoryAlerts");
    if (!alerts) {
      alerts = document.createElement("div"); alerts.id = "inventoryAlerts";
      el("todayCards").after(alerts);
    }
    alerts.innerHTML = live.filter(item => {
      const forecast = inv.forecast(item);
      return forecast.days !== null && forecast.days <= item.lowDays;
    }).map(item => `<button type="button" data-nav="inventory" class="inventory-alert">${icon("package-open")}<span>${esc(item.name)}: ${esc(forecastText(inv.forecast(item)).toLowerCase())}</span>${icon("chevron-right")}</button>`).join("");
    window.lucide?.createIcons();
  }
  function open(action, key, vialId, usageKey) {
    const item = inv.find(key), vial = item?.vials.find(v => v.id === vialId);
    editing = { action, key, vialId, usageKey, profileId: core.state.profileId };
    let title = "Add stock", fields = "", submit = "Save stock";
    if (action === "stock") {
      title = item ? `Edit ${item.name} stock` : "Add stock";
      fields = select("invProtocol", "Linked protocol", item?.peptideId || "", [["", "Inventory only"], ...core.state.stack.map(p => [p.id, p.name])]) +
        field("invName", "Peptide name", item?.name || "", "text", 'required maxlength="100"') +
        '<div class="inventory-field-grid">' + field("invPowder", "mg per unopened vial", item?.powderMg || "", "number", "required") +
        field("invCount", "Unopened vials on hand", item?.unopened ?? 0, "number", "required") + '</div>' +
        field("invExpiry", "Unopened expiry (if provided)", item?.expiry || "", "date") +
        field("invLowDays", "Low-stock reminder (days remaining)", item?.lowDays ?? 14, "number", "required") +
        (item ? `<label class="inventory-check"><input id="invArchived" type="checkbox" ${item.archived ? "checked" : ""}>Archive inventory item</label>` : "");
    } else if (action === "undo-opening") {
      title = `${item.name}: undo opening`; submit = "Return 1 vial to unopened";
      const reason = inv.undoOpeningReason(item, vial);
      fields = `<p class="inventory-basis">Unopened stock: ${fmt(item.unopened)} &rarr; ${fmt(item.unopened + 1)} vials. This opening will remain in the history as undone.</p>` +
        (reason ? `<p class="error-text">${esc(reason)}</p>` : "") +
        '<label class="inventory-check"><input id="invUndoUnopened" type="checkbox" required>The vial is still unopened and unused; its count has not already been restored.</label>' +
        (vial.fromStock == null ? '<label class="inventory-check"><input id="invUndoDeducted" type="checkbox" required>This older entry reduced my unopened count by one.</label>' : "");
    } else if (action === "link") {
      const peptide = core.findPeptide(key), candidates = linkCandidates();
      const matches = candidates.filter(candidate => comparable(candidate.name) === comparable(peptide.name));
      title = `Link inventory to ${peptide.name}`; submit = "Link existing stock";
      fields = select("invLink", "Existing inventory", matches.length === 1 ? matches[0].id : "", [["", "Choose stock"], ...candidates.map(candidate => [candidate.id, `${candidate.name} / ${candidate.unopened} unopened / ${candidate.vials.filter(v => !v.closed).length} mixed`])]) + '<p id="invLinkPreview" class="inventory-basis"></p>';
    } else if (action === "assign") {
      title = `Assign ${item.name} dose`; submit = "Assign vial";
      fields = select("invAssign", "Vial used for this dose", core.state.inventory.usage[usageKey]?.vialId || "", [["", "Choose vial"], ...item.vials.flatMap((v, index) => v.openingUndoneAt ? [] : [[v.id, `Vial ${index + 1} / ${v.powderMg} mg${v.closed ? " (closed)" : ""}`]])]);
    } else {
      const fromStock = action === "new-vial", editingVial = action === "vial";
      title = editingVial ? `${item.name}: vial details` : `${item.name}: ${fromStock ? "start new vial" : "existing mixed vial"}`;
      submit = editingVial ? "Save vial" : fromStock ? "Start vial" : "Add mixed vial";
      const peptide = core.findPeptide(item.peptideId);
      const powder = vial?.powderMg ?? item.powderMg;
      const balance = vial ? inv.remaining(item, vial) : fromStock ? powder : "";
      fields = `<p class="inventory-basis">${fromStock ? "One vial will move from unopened to mixed stock." : editingVial ? "Corrections apply to the remaining estimate; dose history stays intact." : "This vial is additional to your unopened count."}</p>` +
        '<div class="inventory-field-grid">' + field("invVialPowder", "Original vial amount (mg)", powder, "number", `required ${fromStock || editingVial ? "readonly" : ""}`) +
        field("invBac", "BAC added (ml, if known)", vial ? vial.bacMl : (!peptide?.measurementPending && peptide?.powderMg === powder ? peptide.bacMl : "")) + '</div>' +
        field("invRemaining", "Remaining mg (blank if unknown)", balance === null ? "" : Math.max(0, balance || 0)) +
        '<div class="inventory-field-grid">' + field("invMixed", "Date mixed (if known)", vial?.mixedDate || "", "date") +
        field("invDiscard", "Discard date (if provided)", vial?.expiry || (fromStock ? item.expiry : "") || "", "date") + '</div>' +
        (editingVial ? `<label class="inventory-check"><input id="invActive" type="checkbox" ${item.activeVialId === vialId ? "checked" : ""}>Use as active vial</label><label class="inventory-check"><input id="invClosed" type="checkbox" ${vial.closed ? "checked" : ""}>Vial finished or discarded</label>` : '<p class="inventory-basis">This becomes the active vial. Its concentration applies to upcoming pulls.</p>');
    }
    el("inventoryTitle").textContent = title;
    el("inventoryFields").innerHTML = fields;
    // An existing vial of unknown quantity must never default to a full or empty vial.
    if (action === "existing-vial") el("invRemaining").value = "";
    if (action === "link") linkPreview();
    el("inventorySave").textContent = submit;
    el("inventoryError").textContent = "";
    el("inventoryDialog").showModal();
    window.lucide.createIcons();
  }
  function submit(event) {
    event.preventDefault();
    if (!editing || editing.profileId !== core.state.profileId || document.body.classList.contains("locked")) return;
    const value = id => el(id)?.value ?? "";
    try {
      const { action, key, vialId, usageKey } = editing;
      if (action === "stock") inv.saveItem({ name: value("invName"), peptideId: value("invProtocol"), powderMg: value("invPowder"), unopened: value("invCount"), expiry: value("invExpiry"), lowDays: value("invLowDays"), archived: !!el("invArchived")?.checked }, key);
      else if (action === "undo-opening") inv.undoOpening(key, vialId, { unopened: !!el("invUndoUnopened")?.checked, deducted: !!el("invUndoDeducted")?.checked });
      else if (action === "link") inv.linkItem(value("invLink"), key);
      else if (action === "assign") inv.assignUsage(usageKey, value("invAssign"));
      else {
        const values = { powderMg: value("invVialPowder"), bacMl: value("invBac"), remainingMg: value("invRemaining"), mixedDate: value("invMixed"), expiry: value("invDiscard"), active: !!el("invActive")?.checked, closed: !!el("invClosed")?.checked };
        if (action === "vial") inv.updateVial(key, vialId, values);
        else inv.openVial(key, values, action === "new-vial");
      }
      el("inventoryDialog").close(); editing = null;
      window.PepsRender(); window.PepsApp.toast("Inventory saved");
    } catch (error) { el("inventoryError").textContent = error.message; }
  }
  const comparable = name => String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
  const linkCandidates = () => (core.state.inventory?.items || []).filter(item => !item.archived && (!item.peptideId || !core.findPeptide(item.peptideId)));
  function linkPreview() {
    const item = inv.find(el("invLink").value), vial = item && inv.activeVial(item);
    el("invLinkPreview").textContent = !item ? "No inventory selected." :
      `${item.unopened} unopened vials will remain unchanged. ${vial ? `Existing active vial: ${vial.powderMg} mg / ${vial.bacMl ? `${vial.bacMl} ml BAC` : "BAC unknown"}.` : "No active vial."} No new vial will be opened.`;
  }
  function offerLink(peptide) {
    if (!inv.linked(peptide.id) && linkCandidates().length) open("link", peptide.id);
  }
  window.PepsInventoryUI = { render, offerLink };
  document.addEventListener("DOMContentLoaded", () => {
    el("inventoryForm").addEventListener("submit", submit);
    el("inventoryAdd").addEventListener("click", () => open("stock"));
    document.addEventListener("click", event => {
      const node = event.target.closest("button");
      if (node?.hasAttribute("data-inventory-close")) { el("inventoryDialog").close(); editing = null; }
      if (node?.dataset.inventoryAction) open(node.dataset.inventoryAction, node.dataset.inventoryId, node.dataset.vialId, node.dataset.usageKey);
    });
    el("inventoryFields").addEventListener("change", event => {
      if (event.target.id === "invLink") { linkPreview(); return; }
      if (event.target.id !== "invProtocol" || editing?.key) return;
      const peptide = core.findPeptide(event.target.value);
      if (peptide) { el("invName").value = peptide.name; el("invPowder").value = peptide.powderMg; }
    });
  });
})();
