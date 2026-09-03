import { createReplicaTracker } from "./replica-tracker.mjs";
import {
  SCENARIOS,
  createSessionHistory,
  newIdempotencyKey,
  newTransactionId,
  submitTransaction,
  validateTransactionDraft,
} from "./transaction-simulator.mjs";

const STATUS_POLL_MS = 5_000;
const tracker = createReplicaTracker();
const history = createSessionHistory(20);
const el = (id) => document.getElementById(id);
const form = el("transaction-form");

const decisionMessages = {
  APPROVED: "La transaction ne franchit aucun seuil nécessitant une action supplémentaire.",
  REVIEW: "Un contrôle humain ou un signal complémentaire est nécessaire avant décision finale.",
  REJECTED: "Le cumul des signaux atteint le seuil de rejet de cette politique heuristique.",
};

async function fetchJSON(path) {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  tracker.observe(response.headers.get("x-instance-id"));
  updateReplicaCount();
  if (!response.ok) throw new Error(`${response.status}`);
  return { payload: await response.json(), response };
}

function textCell(row, value, className) {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (className) cell.className = className;
  row.append(cell);
  return cell;
}

function updateReplicaCount() {
  el("replica-count").textContent = String(tracker.count());
}

function setServiceStatus(mode, label) {
  const status = el("status");
  status.className = `status status-${mode}`;
  el("status-label").textContent = label;
}

async function refreshServiceStatus() {
  try {
    const { payload } = await fetchJSON("/ready");
    if (payload.mode === "degraded") {
      setServiceStatus("degraded", "Service dégradé · revue forcée");
    } else {
      setServiceStatus("normal", "Service opérationnel");
    }
  } catch {
    setServiceStatus("offline", "API indisponible");
  }
  updateReplicaCount();
}

function formatParameters(parameters) {
  return Object.entries(parameters)
    .map(([key, value]) => `${key} = ${Array.isArray(value) ? value.join(", ") : value}`)
    .join(" · ");
}

async function loadRules() {
  try {
    const { payload: view } = await fetchJSON("/api/rules");
    el("score-bands").textContent =
      `APPROVED 0–${view.scoreBands.approved.max} · ` +
      `REVIEW ${view.scoreBands.review.min}–${view.scoreBands.review.max} · ` +
      `REJECTED ${view.scoreBands.rejected.min}–${view.scoreBands.rejected.max}`;
    const rows = view.rules.map((rule) => {
      const row = document.createElement("tr");
      textCell(row, rule.rule, "rule-name");
      textCell(row, `+${rule.weight}`, "weight");
      textCell(row, formatParameters(rule.parameters));
      return row;
    });
    el("rules-body").replaceChildren(...rows);
  } catch {
    el("score-bands").textContent = "Politique momentanément indisponible";
  }
}

function clearFieldErrors() {
  for (const field of form.elements) {
    if (!field.name) continue;
    field.removeAttribute("aria-invalid");
    const error = el(`${field.name}-error`);
    if (error) error.textContent = "";
  }
  el("form-message").textContent = "";
}

function showFieldErrors(errors) {
  clearFieldErrors();
  for (const [name, message] of Object.entries(errors)) {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLElement) field.setAttribute("aria-invalid", "true");
    const error = el(`${name}-error`);
    if (error) error.textContent = message;
  }
  el("form-message").textContent = "Corrigez les champs signalés avant l’évaluation.";
  const firstInvalid = form.querySelector('[aria-invalid="true"]');
  firstInvalid?.focus();
}

function draftFromForm() {
  return Object.fromEntries(new FormData(form).entries());
}

function setFormValues(transaction) {
  for (const [name, value] of Object.entries(transaction)) {
    const field = form.elements.namedItem(name);
    if (field && "value" in field) field.value = String(value);
  }
  clearFieldErrors();
}

function loadScenario(name) {
  const scenario = SCENARIOS[name];
  if (!scenario) return;
  setFormValues({ transactionId: newTransactionId(), ...scenario.transaction });
  for (const button of document.querySelectorAll("[data-scenario]")) {
    button.setAttribute("aria-pressed", String(button.dataset.scenario === name));
  }
}

function verdictChip(verdict) {
  const chip = document.createElement("span");
  chip.className = `verdict-chip verdict-${verdict.toLowerCase()}`;
  chip.textContent = verdict;
  return chip;
}

function renderDecision(decision, degraded) {
  el("result-empty").classList.add("hidden");
  const article = el("decision");
  article.classList.remove("hidden");
  article.dataset.verdict = decision.decision;
  el("decision-verdict").textContent = decision.decision;
  el("decision-score").textContent = String(decision.score);
  el("decision-copy").textContent = decisionMessages[decision.decision] ?? "Décision calculée.";
  el("decision-id").textContent = decision.decisionId;
  el("decision-time").textContent = new Date(decision.evaluatedAt).toLocaleString("fr-FR");

  const mode = el("decision-mode");
  mode.textContent = degraded ? "Mode dégradé" : "Mode normal";
  mode.className = `mode-badge mode-${degraded ? "degraded" : "normal"}`;

  const reasons = decision.reasons.map((reason) => {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = reason.rule;
    const weight = document.createElement("span");
    weight.textContent = reason.weight > 0 ? `+${reason.weight}` : "contexte";
    const detail = document.createElement("small");
    detail.textContent = reason.detail;
    item.append(name, weight, detail);
    return item;
  });
  if (reasons.length === 0) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = "Aucune règle déclenchée";
    item.append(name);
    reasons.push(item);
  }
  el("decision-reasons").replaceChildren(...reasons);
}

function renderHistory() {
  const entries = history.list();
  const rows = entries.map((entry) => {
    const row = document.createElement("tr");
    textCell(row, new Date(entry.evaluatedAt).toLocaleTimeString("fr-FR"));
    const verdict = document.createElement("td");
    verdict.append(verdictChip(entry.decision));
    row.append(verdict);
    textCell(row, String(entry.score));
    textCell(row, entry.reasons.map((reason) => reason.rule).join(", ") || "—");
    textCell(row, entry.instanceId ?? "—", "rule-name");
    return row;
  });
  el("history-body").replaceChildren(...rows);
  el("history-empty").classList.toggle("hidden", entries.length > 0);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFieldErrors();
  const parsed = validateTransactionDraft(draftFromForm());
  if (!parsed.ok) {
    showFieldErrors(parsed.errors);
    return;
  }

  const submitButton = el("submit-button");
  submitButton.disabled = true;
  submitButton.firstChild.textContent = "Évaluation en cours… ";
  try {
    const result = await submitTransaction(fetch, parsed.value, newIdempotencyKey());
    tracker.observe(result.instanceId);
    history.add({ ...result.decision, instanceId: result.instanceId });
    renderDecision(result.decision, result.degraded);
    renderHistory();
    updateReplicaCount();
    setServiceStatus(
      result.degraded ? "degraded" : "normal",
      result.degraded ? "Service dégradé · revue forcée" : "Service opérationnel",
    );
  } catch (error) {
    el("form-message").textContent = error.message;
    setServiceStatus("offline", "Évaluation indisponible");
  } finally {
    submitButton.disabled = false;
    submitButton.firstChild.textContent = "Évaluer la transaction ";
  }
});

for (const button of document.querySelectorAll("[data-scenario]")) {
  button.addEventListener("click", () => loadScenario(button.dataset.scenario));
}

el("new-transaction").addEventListener("click", () => {
  form.reset();
  setFormValues({ transactionId: newTransactionId(), country: "FR", merchantCategory: "grocery" });
  for (const button of document.querySelectorAll("[data-scenario]")) {
    button.setAttribute("aria-pressed", "false");
  }
});

el("clear-history").addEventListener("click", () => {
  history.clear();
  renderHistory();
});

loadScenario("approved");
renderHistory();
void loadRules();
void refreshServiceStatus();
setInterval(() => void refreshServiceStatus(), STATUS_POLL_MS);
