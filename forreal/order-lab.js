/* A local, illustrative ordering flow. The demo makes no service requests. */
(() => {
  const root = document.getElementById("order-lab");
  if (!root) return;

  const channels = {
    Web: {
      surface: "Signed-in website",
      request: "Reorder my bowl, hold the cheese, and pick it up near work.",
      trigger: "Open my favorite",
      review: "Review your pickup order",
      bridge: "The website calls the shared basket service with the guest’s signed-in identity.",
      delivery: "Show the confirmation and pickup details on the order page.",
    },
    Mobile: {
      surface: "App favorites",
      request: "My usual bowl, hold the cheese. Pickup near work.",
      trigger: "Customize favorite",
      review: "Review your bag",
      bridge: "The app retrieves the same saved order and carries its guest-approved changes into checkout.",
      delivery: "Show the confirmation in the app’s pickup view.",
    },
    Voice: {
      surface: "Voice assistant",
      request: "My usual bowl, hold the cheese. Pickup near work.",
      trigger: "Use the voice request",
      review: "Review your pickup order",
      bridge:
        "The voice service maps spoken ingredients to menu items and reads the change back before commitment.",
      delivery: "Read back the pickup location, time, and confirmation.",
    },
    Text: {
      surface: "SMS conversation",
      request: "Usual bowl, no cheese. Pickup near work?",
      trigger: "Use the text request",
      review: "Review your pickup order",
      bridge:
        "A verified session links the request to the guest’s basket. A secure review link handles approval and payment.",
      delivery: "Text the confirmed pickup details using the guest’s messaging preferences.",
    },
    Chat: {
      surface: "Chipotle chat",
      request: "Can I get my usual bowl without cheese near work?",
      trigger: "Start my draft",
      review: "Review the order card",
      bridge:
        "The chat service turns the request into a draft and renders menu options from the shared catalog.",
      delivery: "Return the pickup confirmation in the conversation.",
    },
    "Personal AI": {
      surface: "Guest’s AI assistant",
      request: "Get my usual bowl, skip the cheese, and pick it up near work.",
      trigger: "Allow for this order",
      review: "Review your pickup order",
      bridge:
        "Through an MCP connection, the assistant asks to read one favorite and prepare a draft. Checkout requires a separate guest confirmation.",
      delivery: "Return the order reference and pickup details to the authorized assistant.",
    },
  };

  const stores = {
    market: { name: "Market Street", area: "Near work", time: "12:25 PM", base: 1000, tax: 80 },
    harbor: { name: "Harbor Avenue", area: "Nearby alternative", time: "12:35 PM", base: 1050, tax: 84 },
  };
  const names = Object.keys(channels);
  const money = (cents) => "$" + (cents / 100).toFixed(2);
  const initial = () => ({
    channel: "Personal AI",
    stage: "start",
    consent: false,
    cheese: false,
    store: "market",
    salsa: "green",
    resolution: "",
    movedStore: false,
  });
  let state = initial();

  root.classList.add("lab-root");
  root.innerHTML = `
    <div class="lab-channel-head">
      <span id="lab-channel-label">Choose a channel</span>
      <span class="lab-demo-label">Simulated order</span>
    </div>
    <div class="lab-tabs" role="tablist" aria-labelledby="lab-channel-label"></div>
    <div class="lab-panel" role="tabpanel" id="lab-panel"></div>
    <p class="lab-demo-note">Illustrative menu, prices, locations, and pickup times.</p>
  `;
  const tabbar = root.querySelector(".lab-tabs");
  const panel = root.querySelector(".lab-panel");

  function tabs() {
    tabbar.innerHTML = names
      .map(
        (name, index) => `
      <button type="button" role="tab" aria-controls="lab-panel" id="lab-tab-${index}"
        data-channel="${index}" aria-selected="${state.channel === name}"
        tabindex="${state.channel === name ? "0" : "-1"}">${name}</button>
    `,
      )
      .join("");
    panel.setAttribute("aria-labelledby", "lab-tab-" + names.indexOf(state.channel));
  }

  function action(id, label, secondary = false, disabled = false) {
    return `<button type="button" class="lab-action${secondary ? " lab-secondary" : ""}" data-act="${id}"${disabled ? " disabled" : ""}>${label}${secondary ? "" : '<span aria-hidden="true">→</span>'}</button>`;
  }

  function buttonGroup(...items) {
    return `<div class="lab-actions">${items.join("")}</div>`;
  }

  function radio(name, value, label, detail, checked) {
    return `<label class="lab-choice">
      <input type="radio" name="lab-${name}" value="${value}"${checked ? " checked" : ""}>
      <span>${label}${detail ? `<small>${detail}</small>` : ""}</span>
    </label>`;
  }

  function ingredients() {
    const salsa = { green: "tomatillo-green salsa", tomato: "fresh tomato salsa", none: "" }[state.salsa];
    return ["Chicken", "white rice", "black beans", salsa, state.cheese ? "cheese" : ""]
      .filter(Boolean)
      .join(", ");
  }

  function render(focus = false) {
    const channel = channels[state.channel];
    const store = stores[state.store];
    const needsGrant = state.channel === "Personal AI" && !state.consent;
    const stage = needsGrant ? "permission" : state.stage;
    let title, guest, system, capability, step, next;
    let surface = channel.surface;

    if (stage === "start" || stage === "permission") {
      title = "Start with a familiar order";
      step = "Request";
      guest = `<blockquote class="lab-quote">“${channel.request}”</blockquote>`;
      if (needsGrant) {
        guest += `<div class="lab-permission"><b>Share your saved favorite?</b><p>Give this assistant access for this order. You’ll approve the final basket and price yourself.</p></div>`;
        next = buttonGroup(action("allow", channel.trigger), action("app", "Use the app instead", true));
        capability = "Identity & permission";
        system = channel.bridge;
      } else {
        next = buttonGroup(
          action("start", state.channel === "Personal AI" ? "Open my favorite" : channel.trigger),
        );
        capability = "Guest context";
        system = channel.bridge;
      }
    } else if (stage === "edit") {
      title = "Customize the favorite";
      step = "Draft";
      guest = `<p class="lab-item">Chicken bowl</p><p class="lab-desc">Your favorite comes with white rice, black beans, tomatillo-green salsa, and cheese.</p>
        <fieldset class="lab-field"><legend>Cheese</legend><div class="lab-options">
          ${radio("cheese", "off", "Hold the cheese", "", !state.cheese)}
          ${radio("cheese", "on", "Keep the cheese", "", state.cheese)}
        </div></fieldset>
        <label class="lab-select-label" for="lab-salsa">Salsa</label>
        <select class="lab-select" id="lab-salsa" name="lab-salsa">
          ${[
            ["green", "Tomatillo-green salsa"],
            ["tomato", "Fresh tomato salsa"],
            ["none", "No salsa"],
          ]
            .map(
              ([key, label]) =>
                `<option value="${key}"${state.salsa === key ? " selected" : ""}>${label}</option>`,
            )
            .join("")}
        </select>
        <fieldset class="lab-field"><legend>Pickup restaurant</legend><div class="lab-options">
          ${Object.entries(stores)
            .map(([key, s]) => radio("store", key, s.name, s.area, key === state.store))
            .join("")}
        </div></fieldset>`;
      next = buttonGroup(action("check", "Check this restaurant"));
      capability = "Shared menu & basket";
      system =
        "Resolve the favorite into menu item and modifier IDs. Changes made in any channel update the same draft. Check the chosen restaurant before quoting.";
    } else if (stage === "resolve") {
      title = "Choose a salsa change";
      step = "Availability";
      guest = `${state.movedStore ? '<p class="lab-store-context">You moved pickup from Harbor Avenue to Market Street.</p>' : ""}
        <p class="lab-alert"><span class="lab-alert-dot" aria-hidden="true"></span>Market Street is out of tomatillo-green salsa.</p>
        <fieldset class="lab-field"><legend>What would you like?</legend><div class="lab-options lab-vertical">
        ${radio("resolution", "tomato", "Use fresh tomato salsa", "", state.resolution === "tomato")}
        ${radio("resolution", "none", "Skip the salsa", "", state.resolution === "none")}
        ${radio("resolution", "harbor", "Keep green salsa", "Pick up at Harbor Avenue", state.resolution === "harbor")}</div></fieldset>`;
      next = buttonGroup(
        action("resolve", "Review this choice", false, !state.resolution),
        action("edit", "Back", true),
      );
      capability = "Restaurant availability";
      system =
        "The local menu flags the sold-out ingredient. Offer only choices the restaurant can fulfill. Switching restaurants triggers a fresh price and pickup quote.";
    } else if (stage === "review") {
      title = channel.review;
      surface = "Chipotle secure checkout";
      step = "Approval";
      guest = `<p class="lab-item">1 × Chicken bowl</p><p class="lab-desc">${ingredients()}.</p>
        <dl class="lab-lines"><div><dt>Pickup</dt><dd>${store.name} · ${store.time}</dd></div>
        <div><dt>Subtotal</dt><dd>${money(store.base)}</dd></div>
        <div><dt>Tax</dt><dd>${money(store.tax)}</dd></div>
        <div class="lab-total"><dt>Total</dt><dd>${money(store.base + store.tax)}</dd></div></dl>`;
      next = buttonGroup(action("confirm", "Confirm sample order"), action("edit", "Edit order", true));
      capability = "Quote & guest approval";
      system =
        "Chipotle shows the local price, tax, and pickup promise in its own checkout. The guest approves the final quote there. If it changes, Chipotle asks for approval again.";
    } else {
      title = "Ready for the crew";
      step = "Fulfillment";
      guest = `<div class="lab-ticket"><div class="lab-ticket-top"><b>Pickup ticket</b><span>DEMO · 042</span></div>
        <div class="lab-ticket-time">${store.time}</div><div>${store.name}</div>
        <hr><strong>1 × Chicken bowl</strong><p>${ingredients()}.</p>${state.cheese ? "" : '<p class="lab-ticket-change">Hold cheese</p>'}</div>`;
      next = buttonGroup(action("reset", "Start a new order", true));
      capability = "Kitchen handoff";
      system =
        "Submit the approved order once, route its modifiers to the restaurant ticket, and wait for an acknowledgment. " +
        channel.delivery;
    }

    const steps = ["Request", "Draft", "Availability", "Approval", "Fulfillment"];
    const progress = steps.map((s) => `<span class="${s === step ? "is-current" : ""}"></span>`).join("");
    panel.innerHTML = `<div class="lab-guest">
      <div class="lab-status"><span class="lab-surface">${surface}</span><span>${step}</span></div>
      <h3 class="lab-title" tabindex="-1">${title}</h3>${guest}${next}
    </div>
    <aside class="lab-inside" aria-label="Company capabilities">
      <div class="lab-inside-label"><span class="lab-node" aria-hidden="true"></span>Inside Chipotle</div>
      <div class="lab-progress" aria-hidden="true">${progress}</div>
      <h4>${capability}</h4><p>${system}</p>
    </aside>`;
    if (focus) panel.querySelector(".lab-title").focus({ preventScroll: true });
  }

  function selectChannel(index) {
    const selected = names[index];
    if (selected === "Personal AI" && !state.consent && state.stage === "ticket") state = initial();
    state.channel = selected;
    tabs();
    render();
    tabbar.querySelector('[aria-selected="true"]').focus();
  }

  tabbar.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-channel]");
    if (tab) selectChannel(Number(tab.dataset.channel));
  });

  tabbar.addEventListener("keydown", (event) => {
    let index = names.indexOf(state.channel);
    switch (event.key) {
      case "ArrowLeft":
        index = (index + names.length - 1) % names.length;
        break;
      case "ArrowRight":
        index = (index + 1) % names.length;
        break;
      case "Home":
        index = 0;
        break;
      case "End":
        index = names.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectChannel(index);
  });

  panel.addEventListener("change", (event) => {
    const field = event.target;
    if (field.name === "lab-cheese") state.cheese = field.value === "on";
    if (field.name === "lab-store") state.store = field.value;
    if (field.name === "lab-salsa") state.salsa = field.value;
    if (field.name === "lab-resolution") {
      state.resolution = field.value;
      panel.querySelector('[data-act="resolve"]').disabled = false;
    }
  });

  panel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button) return;
    switch (button.dataset.act) {
      case "allow":
        state.consent = true;
        if (state.stage === "start") state.stage = "edit";
        break;
      case "app":
        state.channel = "Mobile";
        if (state.stage === "start") state.stage = "edit";
        tabs();
        break;
      case "start":
      case "edit":
        state.stage = "edit";
        break;
      case "check":
        state.resolution = "";
        state.movedStore = false;
        state.stage = state.store === "market" && state.salsa === "green" ? "resolve" : "review";
        break;
      case "resolve":
        if (!state.resolution) return;
        if (state.resolution === "harbor") {
          state.store = "harbor";
          state.salsa = "green";
        } else {
          state.salsa = state.resolution;
        }
        state.stage = "review";
        break;
      case "confirm":
        state.stage = "ticket";
        break;
      case "reset":
        state = { ...initial(), channel: state.channel };
        break;
    }
    render(true);
  });

  // The studio links its tested sold-out component to the same guest flow.
  root.addEventListener("lab:store-change", () => {
    state = { ...initial(), channel: "Mobile", stage: "resolve", movedStore: true };
    tabs();
    render(true);
  });

  tabs();
  render();
})();
