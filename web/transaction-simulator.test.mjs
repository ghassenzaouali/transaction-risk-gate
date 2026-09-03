import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCENARIOS,
  createSessionHistory,
  newIdempotencyKey,
  submitTransaction,
  userMessageForApiError,
  validateTransactionDraft,
} from "./transaction-simulator.mjs";

const valid = {
  transactionId: "txn_demo_1",
  cardId: "card_demo_1",
  amount: "42.50",
  currency: "eur",
  country: "fr",
  channel: "in_store",
  merchantCategory: "Grocery",
};

test("normalise une transaction valide avant envoi", () => {
  const result = validateTransactionDraft(valid);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    ...valid,
    amount: 42.5,
    currency: "EUR",
    country: "FR",
    merchantCategory: "grocery",
  });
});

test("retourne toutes les erreurs de formulaire sans envoi partiel", () => {
  const result = validateTransactionDraft({
    transactionId: "?",
    cardId: "",
    amount: "-1",
    currency: "USD",
    country: "France",
    channel: "phone",
    merchantCategory: "!",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors).sort(), [
    "amount",
    "cardId",
    "channel",
    "country",
    "currency",
    "merchantCategory",
    "transactionId",
  ]);
});

test("les trois scénarios couvrent les verdicts attendus", () => {
  assert.deepEqual(
    Object.values(SCENARIOS).map((scenario) => scenario.expected),
    ["APPROVED", "REVIEW", "REJECTED"],
  );
  for (const scenario of Object.values(SCENARIOS)) {
    const result = validateTransactionDraft({
      transactionId: "txn_scenario",
      ...scenario.transaction,
    });
    assert.equal(result.ok, true);
  }
});

test("historique de session garde les plus récentes et protège ses valeurs", () => {
  const history = createSessionHistory(2);
  const first = { decisionId: "dec_1" };
  history.add(first);
  first.decisionId = "mutated";
  history.add({ decisionId: "dec_2" });
  history.add({ decisionId: "dec_3" });
  const listed = history.list();
  assert.deepEqual(
    listed.map((entry) => entry.decisionId),
    ["dec_3", "dec_2"],
  );
  listed[0].decisionId = "changed";
  assert.equal(history.list()[0].decisionId, "dec_3");
});

test("soumission n envoie jamais la clé interservice depuis le navigateur", async () => {
  let captured;
  const fetcher = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "x-instance-id": "api-2" }),
      json: async () => ({ decisionId: "dec_1", decision: "APPROVED", degraded: false }),
    };
  };
  const result = await submitTransaction(fetcher, valid, "web:test-key-12345678");

  assert.equal(captured.url, "/api/decisions");
  assert.equal(captured.options.headers["x-api-key"], undefined);
  assert.equal(captured.options.headers["idempotency-key"], "web:test-key-12345678");
  assert.equal(result.instanceId, "api-2");
  assert.equal(result.degraded, false);
});

test("transforme les erreurs API en messages actionnables", async () => {
  const fetcher = async () => ({
    ok: false,
    status: 429,
    headers: new Headers(),
    json: async () => ({ error: "rate_limit_exceeded" }),
  });
  await assert.rejects(
    () => submitTransaction(fetcher, valid, "web:test-key-12345678"),
    /Trop de requêtes/,
  );
  assert.match(userMessageForApiError(409, "idempotency_conflict"), /idempotence/);
});

test("génère une clé d idempotence compatible avec le contrat", () => {
  assert.equal(
    newIdempotencyKey("123e4567-e89b-12d3-a456-426614174000"),
    "web:123e4567-e89b-12d3-a456-426614174000",
  );
});
