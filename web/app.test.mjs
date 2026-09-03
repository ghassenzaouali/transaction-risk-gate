import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");

const rules = {
  scoreBands: {
    approved: { max: 29 },
    review: { min: 30, max: 59 },
    rejected: { min: 60, max: 100 },
  },
  rules: [
    {
      rule: "HIGH_AMOUNT",
      weight: 20,
      parameters: { threshold: 1_000, countries: ["FR", "DE"] },
    },
  ],
};

const decision = {
  decisionId: "dec_web_1",
  decision: "APPROVED",
  score: 0,
  reasons: [],
  evaluatedAt: "2026-09-01T10:00:00.000Z",
  degraded: false,
};

function response(payload, { status = 200, instanceId = "api-1", degraded = false } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "x-instance-id": instanceId,
      "x-degraded-mode": String(degraded),
    },
  });
}

async function createPage(fetcher) {
  const window = new Window({ url: "http://localhost/" });
  window.document.write(html);
  window.document.close();

  const previous = new Map();
  const globals = {
    document: window.document,
    HTMLElement: window.HTMLElement,
    FormData: window.FormData,
    fetch: fetcher,
    setInterval: () => 1,
  };
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, globalThis[name]);
    globalThis[name] = value;
  }

  await import(`./app.mjs?test=${crypto.randomUUID()}`);
  await window.happyDOM.waitUntilComplete();
  await new Promise((resolve) => setImmediate(resolve));

  return {
    window,
    restore() {
      for (const [name, value] of previous) globalThis[name] = value;
      window.close();
    },
  };
}

test("initialise le simulateur, charge les règles et soumet sans secret interservice", async (t) => {
  const requests = [];
  const page = await createPage(async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/ready") return response({ mode: "normal" }, { instanceId: "api-1" });
    if (url === "/api/rules") return response(rules, { instanceId: "api-2" });
    if (url === "/api/decisions") return response(decision, { instanceId: "api-2" });
    return response({ error: "not_found" }, { status: 404 });
  });
  t.after(() => page.restore());

  const { document, Event } = page.window;
  assert.equal(document.querySelector("#status-label").textContent, "Service opérationnel");
  assert.match(document.querySelector("#score-bands").textContent, /APPROVED 0–29/);
  assert.equal(document.querySelectorAll("#rules-body tr").length, 1);
  assert.equal(document.querySelector("#replica-count").textContent, "2");

  document
    .querySelector("#transaction-form")
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await page.window.happyDOM.waitUntilComplete();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(document.querySelector("#decision-verdict").textContent, "APPROVED");
  assert.equal(document.querySelector("#decision-score").textContent, "0");
  assert.equal(document.querySelectorAll("#decision-reasons li").length, 1);
  assert.equal(document.querySelectorAll("#history-body tr").length, 1);
  const submission = requests.find((entry) => entry.url === "/api/decisions");
  assert.equal(submission.options.headers["x-api-key"], undefined);

  document.querySelector('[data-scenario="review"]').click();
  assert.equal(document.querySelector("#country").value, "US");
  document.querySelector("#new-transaction").click();
  assert.equal(document.querySelector("#country").value, "FR");
  document.querySelector("#clear-history").click();
  assert.equal(document.querySelectorAll("#history-body tr").length, 0);
});

test("affiche les validations locales et le mode dégradé sans approuver", async (t) => {
  const degradedDecision = {
    ...decision,
    decisionId: "dec_web_degraded",
    decision: "REVIEW",
    score: 30,
    degraded: true,
    reasons: [
      {
        rule: "RISK_CONTEXT_UNAVAILABLE",
        weight: 0,
        detail: "Shared risk state is temporarily unavailable",
      },
    ],
  };
  const page = await createPage(async (url) => {
    if (url === "/ready") return response({ mode: "degraded" }, { degraded: true });
    if (url === "/api/rules") return response(rules);
    return response(degradedDecision, { degraded: true });
  });
  t.after(() => page.restore());

  const { document, Event } = page.window;
  assert.match(document.querySelector("#status-label").textContent, /dégradé/);
  document.querySelector("#transactionId").value = "?";
  document
    .querySelector("#transaction-form")
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(document.querySelector("#transactionId").getAttribute("aria-invalid"), "true");

  document.querySelector('[data-scenario="approved"]').click();
  document
    .querySelector("#transaction-form")
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await page.window.happyDOM.waitUntilComplete();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(document.querySelector("#decision-verdict").textContent, "REVIEW");
  assert.equal(document.querySelector("#decision-mode").textContent, "Mode dégradé");
  assert.equal(
    document.querySelector("#decision-reasons strong").textContent,
    "RISK_CONTEXT_UNAVAILABLE",
  );
});

test("rend explicites les pannes de lecture et d’évaluation", async (t) => {
  const page = await createPage(async (url) => {
    if (url === "/api/decisions") {
      return response({ error: "service_unavailable" }, { status: 503, instanceId: "api-3" });
    }
    throw new Error("network unavailable");
  });
  t.after(() => page.restore());

  const { document, Event } = page.window;
  assert.equal(document.querySelector("#status-label").textContent, "API indisponible");
  assert.equal(
    document.querySelector("#score-bands").textContent,
    "Politique momentanément indisponible",
  );

  document
    .querySelector("#transaction-form")
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await page.window.happyDOM.waitUntilComplete();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(document.querySelector("#form-message").textContent, /momentanément indisponible/);
  assert.equal(document.querySelector("#status-label").textContent, "Évaluation indisponible");
});
