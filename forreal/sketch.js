const interaction = document.getElementById("interaction");
const promptTitle = document.getElementById("prompt");
const hint = document.getElementById("hint");
const actions = document.getElementById("actions");
const bowlTitle = document.getElementById("bowl-title");
const ingredients = document.getElementById("ingredients");
const original = "White rice, black beans, chicken, cheese";

const initialChoices = [
  ["cheese", "“Hold the cheese.”"],
  ["half", "“Make it half and half.”"],
];
const followUpChoices = [
  ["steak", "Steak"],
  ["sofritas", "Sofritas"],
  ["reset", "Go back"],
];
let changeSummary = "";

function showStep(title, detail, choices) {
  promptTitle.textContent = title;
  hint.textContent = detail;
  actions.replaceChildren();
  for (const [key, label] of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.choice = key;
    button.textContent = label;
    if (key === "confirm") button.className = "confirm";
    actions.append(button);
  }
  promptTitle.focus({ preventScroll: true });
}

function review(title, items, detail) {
  bowlTitle.textContent = title;
  ingredients.textContent = items;
  changeSummary = detail;
  showStep("Review your change", detail, [
    ["confirm", "Confirm change"],
    ["reset", "Undo"],
  ]);
}

interaction.hidden = false;
actions.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const choice = button.dataset.choice;
  if (choice === "cheese") {
    review("Chicken bowl", "White rice, black beans, chicken", "Cheese removed from your bowl.");
  } else if (choice === "half") {
    showStep("Half chicken, half what?", "Choose the second filling for your bowl.", followUpChoices);
  } else if (choice === "steak" || choice === "sofritas") {
    review(
      "Half chicken, half " + choice,
      "White rice, black beans, half chicken, half " + choice + ", cheese",
      "The full serving of chicken is now half chicken and half " + choice + ".",
    );
  } else if (choice === "confirm") {
    showStep("Change confirmed", changeSummary, [["reset", "Try another request"]]);
  } else if (choice === "reset") {
    bowlTitle.textContent = "Chicken bowl";
    ingredients.textContent = original;
    showStep("What would you change?", "Choose a sample request.", initialChoices);
  }
});
