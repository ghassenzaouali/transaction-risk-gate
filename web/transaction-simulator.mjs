export const SCENARIOS = Object.freeze({
  approved: Object.freeze({
    label: "Transaction habituelle",
    expected: "APPROVED",
    transaction: Object.freeze({
      cardId: "card_demo_safe",
      amount: 42.5,
      currency: "EUR",
      country: "FR",
      channel: "in_store",
      merchantCategory: "grocery",
    }),
  }),
  review: Object.freeze({
    label: "Contexte à vérifier",
    expected: "REVIEW",
    transaction: Object.freeze({
      cardId: "card_demo_review",
      amount: 180,
      currency: "EUR",
      country: "US",
      channel: "online",
      merchantCategory: "travel",
    }),
  }),
  rejected: Object.freeze({
    label: "Cumul de signaux risqués",
    expected: "REJECTED",
    transaction: Object.freeze({
      cardId: "card_demo_rejected",
      amount: 2500,
      currency: "EUR",
      country: "US",
      channel: "online",
      merchantCategory: "crypto",
    }),
  }),
});

const IDENTIFIER = /^[A-Za-z0-9_-]{3,64}$/;
const COUNTRY = /^[A-Z]{2}$/;
const CHANNELS = new Set(["in_store", "online"]);

export function validateTransactionDraft(draft) {
  const errors = {};
  const transactionId = String(draft.transactionId ?? "").trim();
  const cardId = String(draft.cardId ?? "").trim();
  const amount = Number(draft.amount);
  const currency = String(draft.currency ?? "").toUpperCase();
  const country = String(draft.country ?? "")
    .trim()
    .toUpperCase();
  const channel = String(draft.channel ?? "");
  const merchantCategory = String(draft.merchantCategory ?? "")
    .trim()
    .toLowerCase();

  if (!IDENTIFIER.test(transactionId)) errors.transactionId = "3 à 64 caractères sûrs requis";
  if (!IDENTIFIER.test(cardId)) errors.cardId = "3 à 64 caractères sûrs requis";
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
    errors.amount = "Montant EUR positif requis";
  }
  if (currency !== "EUR") errors.currency = "La version v1 accepte uniquement EUR";
  if (!COUNTRY.test(country)) errors.country = "Code pays ISO sur deux lettres requis";
  if (!CHANNELS.has(channel)) errors.channel = "Canal inconnu";
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(merchantCategory)) {
    errors.merchantCategory = "Catégorie en minuscules requise";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      transactionId,
      cardId,
      amount,
      currency,
      country,
      channel,
      merchantCategory,
    },
  };
}

export function createSessionHistory(maxEntries = 20) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError("maxEntries doit être un entier positif");
  }
  let entries = [];
  return {
    add(decision) {
      entries = [structuredClone(decision), ...entries].slice(0, maxEntries);
    },
    list() {
      return structuredClone(entries);
    },
    clear() {
      entries = [];
    },
  };
}

export function newTransactionId(now = Date.now()) {
  return `txn_${now.toString(36)}`;
}

export function newIdempotencyKey(randomId = crypto.randomUUID()) {
  return `web:${randomId}`;
}

export async function submitTransaction(fetcher, transaction, idempotencyKey) {
  const response = await fetcher("/api/decisions", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(transaction),
  });
  const payload = await response.json().catch(() => ({ error: "invalid_api_response" }));
  if (!response.ok) {
    const error = new Error(userMessageForApiError(response.status, payload?.error));
    error.status = response.status;
    error.code = payload?.error;
    throw error;
  }
  return {
    decision: payload,
    instanceId: response.headers.get("x-instance-id"),
    degraded: response.headers.get("x-degraded-mode") === "true" || payload.degraded === true,
  };
}

export function userMessageForApiError(status, code) {
  if (status === 400) return "Les données envoyées ne respectent pas le contrat de l’API.";
  if (status === 401) return "La passerelle web n’est pas correctement authentifiée.";
  if (status === 409 || code === "idempotency_conflict") {
    return "Cette clé d’idempotence appartient déjà à une autre transaction.";
  }
  if (status === 413) return "La requête dépasse la taille autorisée.";
  if (status === 429) return "Trop de requêtes. Réessayez après quelques instants.";
  return "Le service de décision est momentanément indisponible.";
}
