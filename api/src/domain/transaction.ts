import { z } from "zod";

export const SUPPORTED_CURRENCY = "EUR" as const;

const normalizedCurrency = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(z.literal(SUPPORTED_CURRENCY));

/**
 * Transaction synthétique évaluée par le domaine.
 *
 * La normalisation est effectuée à la frontière HTTP. La première version ne
 * traite que l'euro afin de ne pas appliquer un seuil unique à des devises qui
 * n'ont pas la même valeur.
 */
export const TransactionSchema = z
  .object({
    transactionId: z.string().trim().min(1).max(64),
    cardId: z.string().trim().min(1).max(128),
    amount: z.number().finite().positive().max(1_000_000_000),
    currency: normalizedCurrency,
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((value) => value.toUpperCase()),
    channel: z.enum(["online", "in_store"]),
    merchantCategory: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .transform((value) => value.toLowerCase())
      .pipe(z.string().regex(/^[a-z][a-z0-9_]*$/)),
  })
  .strict();

export type Transaction = z.infer<typeof TransactionSchema>;
