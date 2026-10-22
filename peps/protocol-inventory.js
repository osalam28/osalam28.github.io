(function () {
  "use strict";
  const core = window.PepsCore, inv = window.PepsInventory, h = core.helpers;
  const el = id => document.getElementById(id), esc = h.escapeHtml;
  const value = id => el(id)?.value ?? "";
  let peptideId = "", profileId = "", signature = "";
  const comparable = name => String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
  const field = (id, label, type = "number", attributes = "") => `<label>${label}<input id="${id}" type="${type}" ${type === "number" ? 'min="0" step="any" inputmode="decimal"' : ""} ${attributes}></label>`;
  function candidates() {
    return core.state.inventory.items.filter(item => !item.archived && (!item.peptideId || item.peptideId === peptideId || !core.findPeptide(item.peptideId)));
  }
  const managed = () => value("setupStockSource") !== "later";
  const selected = () => inv.find(value("setupStockItem"));
  function loadEditor(peptide) {
    if (!el("protocolInventoryFields")) return;
    peptideId = peptide?.id || ""; profileId = core.state.profileId; signature = "";
    const linked = peptideId && inv.linked(peptideId);
    el("protocolInventoryFields").innerHTML = `
      <label>Inventory<select id="setupStockSource" required>
        <option value="">Choose stock setup</option>
        <option value="new" ${linked ? "disabled" : ""}>Add stock on hand</option>
        <option value="existing" ${!candidates().length ? "disabled" : ""}>Use existing inventory</option>
        <option value="later" ${linked ? "disabled" : ""}>Set up inventory later</option>
      </select></label>
      <label id="setupStockItemLabel">Existing stock<select id="setupStockItem"><option value="">Choose inventory</option>${candidates().map(item => `<option value="${esc(item.id)}">${esc(item.name)} / ${item.unopened} unopened</option>`).join("")}</select></label>
      <div id="setupNewStock" class="form-grid">
        ${field("setupStockPowder", "mg per unopened vial", "number", 'max="100000"')}
        ${field("setupStockCount", "Unopened vials on hand", "number", 'max="100000"')}
        ${field("setupStockExpiry", "Unopened expiry (if provided)", "date")}
      </div>
      <label id="setupVialActionLabel">Vial for this protocol<select id="setupVialAction"></select></label>
      <p id="setupExistingVial" class="inventory-basis"></p>
      <div id="setupVialFields" class="form-grid">
        ${field("setupVialPowder", "Original amount in mixed vial (mg)")}
        ${field("setupVialBac", "BAC added (ml, if known)")}
        ${field("setupVialRemaining", "Remaining mg (blank if unknown)")}
        ${field("setupVialMixed", "Date mixed (if known)", "date")}
        ${field("setupVialExpiry", "Discard date (if provided)", "date")}
      </div>
      <p id="setupStockPreview" class="titration-preview" aria-live="polite"></p>`;
    el("setupStockCount").step = "1";
    el("setupStockSource").value = linked ? "existing" : peptide ? "later" : "";
    if (linked) el("setupStockItem").value = linked.id;
    if (peptide) {
      el("setupStockPowder").value = peptide.powderMg || "";
      el("setupVialPowder").value = peptide.powderMg || "";
      el("setupVialBac").value = peptide.measurementPending ? "" : peptide.bacMl || "";
    }
    update();
  }
  function section(id, shown) {
    const node = el(id); node.hidden = !shown;
    node.querySelectorAll("input,select").forEach(input => { input.disabled = !shown; });
  }
  function update() {
    if (!el("setupStockSource")) return;
    const source = value("setupStockSource"), item = source === "existing" ? selected() : null;
    section("setupStockItemLabel", source === "existing");
    section("setupNewStock", source === "new");
    section("setupVialActionLabel", ["new", "existing"].includes(source));
    el("setupStockItem").required = source === "existing";
    el("setupStockItem").disabled ||= !!inv.linked(peptideId);
    el("setupStockPowder").required = el("setupStockCount").required = source === "new";
    el("setupStockPowder").min = "0.001";
    const next = `${source}:${item?.id || ""}`;
    if (signature !== next) {
      signature = next;
      el("setupVialAction").innerHTML = (item && source === "existing" ? `<option value="keep">${inv.activeVial(item) ? "Keep current vial selection" : "Keep stock only (no active vial)"}</option>` : '<option value="">Choose a vial option</option>') +
        (source === "existing" ? (item?.vials || []).flatMap((vial, index) => vial.closed ? [] : [`<option value="vial:${esc(vial.id)}">Use mixed vial ${index + 1} / ${vial.powderMg} mg</option>`]).join("") : "") +
        '<option value="new">Open one from unopened stock</option><option value="opened">Record an already-open vial</option>' +
        (!item || !inv.activeVial(item) ? '<option value="none">No active vial yet</option>' : "");
      el("setupVialRemaining").value = "";
    }
    const action = value("setupVialAction"), creating = managed() && ["new", "opened"].includes(action);
    section("setupVialFields", creating);
    el("setupVialAction").required = ["new", "existing"].includes(source);
    el("setupVialPowder").required = creating;
    el("setupVialPowder").min = "0.001";
    el("setupVialPowder").readOnly = action === "new";
    if (action === "new") {
      el("setupVialPowder").value = source === "existing" ? item?.powderMg || "" : value("setupStockPowder");
      el("setupVialRemaining").value = value("setupVialPowder");
    }
    el("setupVialRemaining").closest("label").hidden = action === "new";
    el("setupVialRemaining").disabled = !creating || action === "new";
    section("legacyMeasurementFields", source === "later");
    el("measurementMode").required = source === "later";
    let vial = source === "existing" && item ? (action === "keep" ? inv.activeVial(item) : item.vials.find(v => `vial:${v.id}` === action)) : null;
    el("setupExistingVial").hidden = !vial;
    el("setupExistingVial").textContent = vial ? `${vial.powderMg} mg / ${vial.bacMl ? `${vial.bacMl} ml BAC` : "BAC unknown"} / ${inv.remaining(item, vial) === null ? "remaining unknown" : `${h.formatNumber(inv.remaining(item, vial))} mg remaining`}` : "";
    if (managed()) {
      if (creating) vial = { powderMg: value("setupVialPowder"), bacMl: value("setupVialBac") };
      el("measurementMode").value = vial?.bacMl > 0 ? "mixed" : "later";
      el("powderMgInput").value = vial?.powderMg || "";
      el("bacMlInput").value = vial?.bacMl || "";
      el("powderMgInput").disabled = el("bacMlInput").disabled = true;
    }
    el("setupStockPreview").textContent = summary();
  }
  function read() {
    return { source: value("setupStockSource"), itemId: value("setupStockItem"), action: value("setupVialAction"),
      powderMg: value("setupStockPowder"), unopened: value("setupStockCount"), expiry: value("setupStockExpiry"),
      vial: { powderMg: value("setupVialPowder"), bacMl: value("setupVialBac"), remainingMg: value("setupVialRemaining"), mixedDate: value("setupVialMixed"), expiry: value("setupVialExpiry") } };
  }
  function validate() {
    if (profileId !== core.state.profileId) throw new Error("Account changed. Reopen peptide setup.");
    inv.validateSetup(read(), peptideId);
  }
  function summary() {
    const setup = read(), item = selected();
    if (!setup.source) return "";
    if (setup.source === "later") return "Inventory setup deferred. No stock changes.";
    if (setup.source === "existing" && !item) return "Choose inventory to link.";
    if (setup.source === "new" && setup.unopened === "") return "Unopened count excludes any vial already open.";
    const count = Number(setup.source === "existing" ? item.unopened : setup.unopened);
    const prefix = setup.source === "existing" ? `${item.name}: ` : "New inventory: ";
    if (setup.action === "new") return `${prefix}${count} unopened to ${Math.max(0, count - 1)} unopened + 1 newly opened vial.`;
    if (setup.action === "opened") return `${prefix}${count} unopened unchanged + 1 already-open vial. ${setup.vial.remainingMg === "" ? "Remaining amount unknown." : `${setup.vial.remainingMg} mg remaining.`}`;
    return `${prefix}${count} unopened${setup.source === "existing" ? " unchanged" : ""}. ${(setup.action === "keep" && item && inv.activeVial(item)) || setup.action.startsWith("vial:") ? "Existing vial selection; no new vial opened." : "No active vial yet."}`;
  }
  function refresh() {
    update();
    el("measurementMode").dispatchEvent(new Event("input", { bubbles: true }));
  }
  window.PepsProtocolInventory = { loadEditor, update, read, validate, summary, managed };
  document.addEventListener("DOMContentLoaded", () => {
    el("protocolInventoryFields").addEventListener("input", event => {
      if (event.target.id === "setupVialAction" && value("setupVialAction") === "opened") el("setupVialRemaining").value = "";
      if (event.target.id === "setupStockSource" && value("setupStockSource") === "existing" && !selected()) {
        const matches = candidates().filter(item => comparable(item.name) === comparable(value("peptideNameInput")));
        if (matches.length === 1) el("setupStockItem").value = matches[0].id;
      }
      refresh();
    });
    document.addEventListener("click", event => {
      const button = event.target.closest("[data-inventory-protocol]");
      if (!button) return;
      const item = inv.find(button.dataset.inventoryProtocol);
      if (!item || item.archived) return;
      if (item.peptideId && core.findPeptide(item.peptideId)) return;
      window.PepsApp.navigate("settings");
      el("newPeptideBtn").click();
      el("peptideNameInput").value = item.name;
      el("setupStockSource").value = "existing";
      el("setupStockItem").value = item.id;
      refresh();
    });
  });
})();
