const services = {
  identity: {
    guest: "“Get my usual.”",
    guestDetail: "The guest chooses a favorite and a pickup location.",
    core: "Resolve the favorite",
    coreDetail:
      "Check the signed-in account and the permission granted to this channel. Return the selected bowl and eligible rewards.",
    result: "An editable starting point",
    resultDetail: "The guest can change the bowl, decline personalization, or build an order from scratch.",
  },
  menu: {
    guest: "“Pick it up near work.”",
    guestDetail: "A different restaurant can have a different menu, even for the same saved bowl.",
    core: "Check the local line",
    coreDetail:
      "Resolve ingredients to menu IDs at the chosen restaurant. Operations owns the availability signal. If it is stale, ask the guest to check again before quoting.",
    result: "A guest-chosen swap",
    resultDetail:
      "If the green salsa is sold out, offer the available choices or another store. The guest decides what goes in the bowl.",
  },
  quote: {
    guest: "“What’s the total?”",
    guestDetail: "A topping, reward, or location change can affect the amount due.",
    core: "Quote the exact basket",
    coreDetail:
      "Use store prices, tax, and eligible Rewards. Bind the quote to the basket and pickup slot. Requote after an edit or expiry.",
    result: "An informed confirmation",
    resultDetail:
      "Show the changed ingredients, pickup time, and total together. A Chipotle checkout surface collects approval and processes payment.",
  },
  ticket: {
    guest: "“Looks right. Confirm.”",
    guestDetail: "The guest commits to one order. A network interruption can leave the outcome unclear.",
    core: "Create one order",
    coreDetail:
      "Use an idempotency key to recognize a retry. Send one ticket to the restaurant and reconcile payment with its acknowledgment.",
    result: "One meal to make",
    resultDetail:
      "The crew sees the chosen ingredients and pickup time. The guest can look up the same order if their connection drops.",
  },
};

const serviceFields = {
  guest: "s-guest",
  guestDetail: "s-guest-detail",
  core: "s-core",
  coreDetail: "s-core-detail",
  result: "s-result",
  resultDetail: "s-result-detail",
};

function selectButton(group, button) {
  for (const item of group) item.setAttribute("aria-pressed", String(item === button));
}

const serviceButtons = document.querySelectorAll("[data-service]");
const route = document.querySelector(".service-route");
for (const button of serviceButtons) {
  button.addEventListener("click", () => {
    selectButton(serviceButtons, button);
    const service = services[button.dataset.service];
    for (const [field, id] of Object.entries(serviceFields)) {
      document.getElementById(id).textContent = service[field];
    }
    route.classList.remove("switched");
    requestAnimationFrame(() => requestAnimationFrame(() => route.classList.add("switched")));
  });
}

const studioButtons = document.querySelectorAll("[data-studio]");
const panels = document.querySelectorAll("[data-panel]");
for (const button of studioButtons) {
  button.addEventListener("click", () => {
    selectButton(studioButtons, button);
    for (const panel of panels) panel.hidden = panel.dataset.panel !== button.dataset.studio;
  });
}

const cohorts = {
  all: { sessions: 1000, kept: 80, changed: 180 },
  lunch: { sessions: 400, kept: 44, changed: 92 },
  other: { sessions: 600, kept: 36, changed: 88 },
};
const queryFilters = document.querySelectorAll("[data-scope]");
for (const filter of queryFilters) {
  filter.addEventListener("click", () => {
    selectButton(queryFilters, filter);
    const cohort = cohorts[filter.dataset.scope];
    for (const group of ["kept", "changed"]) {
      const percent = (100 * cohort[group]) / cohort.sessions;
      document.getElementById(group + "-rate").textContent = Number(percent.toFixed(1)) + "%";
      document.getElementById(group + "-bar").style.setProperty("--bar", percent * 4 + "%");
    }
    document.getElementById("cohorts").textContent =
      "Of " +
      cohort.sessions.toLocaleString("en-US") +
      " sessions in each group, " +
      cohort.kept +
      " and " +
      cohort.changed +
      " ended before checkout.";
  });
}

document.getElementById("try-store-change").addEventListener("click", () => {
  document.getElementById("order-lab").dispatchEvent(new Event("lab:store-change"));
});

const menuButton = document.querySelector(".menu-toggle");
const menu = document.getElementById("navigation");
function closeMenu() {
  menu.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
}
menuButton.addEventListener("click", () => {
  const open = menu.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(open));
});
menu.addEventListener("click", closeMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu.classList.contains("open")) {
    closeMenu();
    menuButton.focus();
  }
});

const navLinks = [...menu.querySelectorAll("a")];
const sections = navLinks.map((link) => document.getElementById(link.hash.slice(1)));
let scheduled = false;
function highlightSection() {
  scheduled = false;
  const current = sections
    .filter((section) => section.getBoundingClientRect().top <= window.innerHeight * 0.5)
    .at(-1);
  for (const link of navLinks) {
    if (current && link.hash === "#" + current.id) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}
window.addEventListener(
  "scroll",
  () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(highlightSection);
    }
  },
  { passive: true },
);
highlightSection();

const sources = document.getElementById("sources");
for (const link of document.querySelectorAll('a[href="#sources"]')) {
  link.addEventListener("click", () => {
    sources.open = true;
  });
}
if (location.hash === "#sources") sources.open = true;
const conceptButtons = document.querySelectorAll("[data-concept]");
const concepts = {
  inline: [
    "While editing ingredients",
    "Green salsa is out at Market Street.",
    "Choose another salsa, skip it, or keep it at another restaurant.",
  ],
  review: [
    "While reviewing the bag",
    "Your bowl needs one change.",
    "Market Street is out of green salsa. Review your options before confirming pickup.",
  ],
};
for (const button of conceptButtons) {
  button.addEventListener("click", () => {
    selectButton(conceptButtons, button);
    const [location, message, choice] = concepts[button.dataset.concept];
    document.getElementById("concept-location").textContent = location;
    document.getElementById("concept-message").textContent = message;
    document.getElementById("concept-choice").textContent = choice;
    document
      .querySelector(".concept-preview")
      .classList.toggle("review-card", button.dataset.concept === "review");
  });
}

const hero = document.querySelector(".hero");
const hoverMotion = matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)");
let heroFrame = 0;
hero.addEventListener("pointermove", (event) => {
  if (!hoverMotion.matches || heroFrame) return;
  heroFrame = requestAnimationFrame(() => {
    const rect = hero.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    hero.style.setProperty("--photo-x", (x * 7).toFixed(1) + "px");
    hero.style.setProperty("--photo-y", (y * 5).toFixed(1) + "px");
    heroFrame = 0;
  });
});
hero.addEventListener("pointerleave", () => {
  cancelAnimationFrame(heroFrame);
  heroFrame = 0;
  hero.style.removeProperty("--photo-x");
  hero.style.removeProperty("--photo-y");
});
