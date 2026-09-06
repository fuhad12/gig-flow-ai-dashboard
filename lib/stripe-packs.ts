/**
 * Client-safe export of the top-up pack catalog.
 *
 * Amounts charge via Flutterwave Standard (no Payment Plan ids).
 * Optional server overrides: FLUTTERWAVE_TOPUP_{5|15|30}_AMOUNT_CENTS
 * Keep UI `amountCents` in sync with those env values.
 *
 * Keep this module dependency-free (safe for client bundles).
 */

export interface TopupPack {
  /** Stable id stored in checkout metadata + the `credit_topups.pack_id` column. */
  id: string
  /** Human label shown in the UI. */
  label: string
  /** How many credits this pack adds to the user's balance. */
  credits: number
  /** Display / default price in cents (USD). */
  amountCents: number
  /**
   * Env var for optional server-side amount override (cents).
   * Example: FLUTTERWAVE_TOPUP_5_AMOUNT_CENTS=399
   */
  amountEnv: string
}

export const TOPUP_PACKS: readonly TopupPack[] = [
  {
    id: "topup-5",
    label: "5 credits",
    credits: 5,
    amountCents: 399, // $3.99
    amountEnv: "FLUTTERWAVE_TOPUP_5_AMOUNT_CENTS",
  },
  {
    id: "topup-15",
    label: "15 credits",
    credits: 15,
    amountCents: 999, // $9.99
    amountEnv: "FLUTTERWAVE_TOPUP_15_AMOUNT_CENTS",
  },
  {
    id: "topup-30",
    label: "30 credits",
    credits: 30,
    amountCents: 1799, // $17.99
    amountEnv: "FLUTTERWAVE_TOPUP_30_AMOUNT_CENTS",
  },
] as const

export function getTopupPack(id: string): TopupPack | null {
  return TOPUP_PACKS.find((p) => p.id === id) ?? null
}

/** Server-only: resolve charge amount (env override or catalog default). */
export function resolveTopupAmountCents(pack: TopupPack): number {
  const raw = process.env[pack.amountEnv]?.trim()
  if (raw) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return pack.amountCents
}
