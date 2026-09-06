/**
 * Flutterwave billing client (replaces Stripe Checkout).
 * Docs: https://developer.flutterwave.com — Standard payments + payment plans.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin"
import {
  TOPUP_PACKS as TOPUP_PACKS_DATA,
  getTopupPack as getTopupPackInternal,
  resolveTopupAmountCents as resolveTopupAmountCentsInternal,
  type TopupPack,
} from "@/lib/stripe-packs"

// ---------- Plan + tier types (unchanged product model) ----------

export type Tier = "free" | "pro" | "agency"
export type Cadence = "monthly" | "yearly"
export type Plan =
  | "pro-monthly"
  | "pro-yearly"
  | "agency-monthly"
  | "agency-yearly"

export interface PlanMeta {
  tier: Tier
  cadence: Cadence
}

const PLAN_META: Record<Plan, PlanMeta> = {
  "pro-monthly": { tier: "pro", cadence: "monthly" },
  "pro-yearly": { tier: "pro", cadence: "yearly" },
  "agency-monthly": { tier: "agency", cadence: "monthly" },
  "agency-yearly": { tier: "agency", cadence: "yearly" },
}

/** USD amounts — must match Flutterwave Payment Plan amounts. */
export const PLAN_AMOUNTS_USD: Record<Plan, number> = {
  "pro-monthly": 12,
  "pro-yearly": 108,
  "agency-monthly": 29.99,
  "agency-yearly": 269.99,
}

export function tierOf(plan: Plan): Tier {
  return PLAN_META[plan].tier
}

export function cadenceOf(plan: Plan): Cadence {
  return PLAN_META[plan].cadence
}

export {
  TOPUP_PACKS_DATA as TOPUP_PACKS,
  getTopupPackInternal as getTopupPack,
  resolveTopupAmountCentsInternal as resolveTopupAmountCents,
}
export type { TopupPack }

export function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_VERCEL_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "")
}

export function getFlutterwaveCurrency(): string {
  return (process.env.FLUTTERWAVE_CURRENCY ?? "USD").toUpperCase()
}

const PLAN_ID_ENV: Record<Plan, readonly string[]> = {
  "pro-monthly": [
    "FLUTTERWAVE_PLAN_PRO_MONTHLY",
    "FLW_PLAN_PRO_MONTHLY",
  ],
  "pro-yearly": ["FLUTTERWAVE_PLAN_PRO_YEARLY", "FLW_PLAN_PRO_YEARLY"],
  "agency-monthly": [
    "FLUTTERWAVE_PLAN_AGENCY_MONTHLY",
    "FLW_PLAN_AGENCY_MONTHLY",
  ],
  "agency-yearly": [
    "FLUTTERWAVE_PLAN_AGENCY_YEARLY",
    "FLW_PLAN_AGENCY_YEARLY",
  ],
}

export function getFlutterwaveSecretKey(): string {
  const key =
    process.env.FLUTTERWAVE_SECRET_KEY?.trim() ||
    process.env.FLW_SECRET_KEY?.trim()
  if (!key) {
    throw new Error(
      "FLUTTERWAVE_SECRET_KEY is not configured on the server",
    )
  }
  return key
}

export function getFlutterwaveSecretHash(): string | null {
  return (
    process.env.FLUTTERWAVE_SECRET_HASH?.trim() ||
    process.env.FLW_SECRET_HASH?.trim() ||
    null
  )
}

/** Flutterwave Payment Plan numeric id for a JobFlow plan. */
export function getFlutterwavePlanId(plan: Plan): string {
  for (const envName of PLAN_ID_ENV[plan]) {
    const value = process.env[envName]?.trim()
    if (value) return value
  }
  throw new Error(
    `No Flutterwave plan id for "${plan}". Set one of: ${PLAN_ID_ENV[plan].join(", ")}.`,
  )
}

/**
 * Map a Flutterwave payment_plan id back to our Plan.
 * Alias kept as planForPrice for existing tests / call sites.
 */
export function planForPrice(
  planId: string | number | null | undefined,
): Plan | null {
  if (planId == null || planId === "") return null
  const needle = String(planId)
  for (const [plan, envNames] of Object.entries(PLAN_ID_ENV) as [
    Plan,
    readonly string[],
  ][]) {
    for (const envName of envNames) {
      if (process.env[envName]?.trim() === needle) return plan
    }
  }
  return null
}

const FLW_API = "https://api.flutterwave.com/v3"

export interface FlutterwavePaymentResult {
  link: string
  txRef: string
}

interface CreatePaymentInput {
  txRef: string
  amount: number
  currency: string
  redirectUrl: string
  customerEmail: string
  customerName?: string
  title: string
  description: string
  /** Flutterwave payment plan id — omit for one-time top-ups. */
  paymentPlanId?: string | number
  meta: Record<string, string>
}

export async function createFlutterwavePayment(
  input: CreatePaymentInput,
): Promise<FlutterwavePaymentResult> {
  const body: Record<string, unknown> = {
    tx_ref: input.txRef,
    amount: input.amount,
    currency: input.currency,
    redirect_url: input.redirectUrl,
    customer: {
      email: input.customerEmail,
      name: input.customerName || input.customerEmail.split("@")[0],
    },
    customizations: {
      title: input.title,
      description: input.description,
    },
    meta: input.meta,
  }
  if (input.paymentPlanId != null && input.paymentPlanId !== "") {
    body.payment_plan = Number(input.paymentPlanId)
  }

  const res = await fetch(`${FLW_API}/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getFlutterwaveSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json()) as {
    status?: string
    message?: string
    data?: { link?: string }
  }

  if (!res.ok || json.status !== "success" || !json.data?.link) {
    throw new Error(
      json.message || `Flutterwave payment init failed (${res.status})`,
    )
  }

  return { link: json.data.link, txRef: input.txRef }
}

/** Cancel all active Flutterwave subscriptions for an email (best-effort). */
export async function cancelFlutterwaveSubscriptionsForEmail(
  email: string,
): Promise<number> {
  const key = getFlutterwaveSecretKey()
  const listRes = await fetch(
    `${FLW_API}/subscriptions?email=${encodeURIComponent(email)}`,
    {
      headers: { Authorization: `Bearer ${key}` },
    },
  )
  const listJson = (await listRes.json()) as {
    status?: string
    data?: Array<{ id?: number; status?: string }>
  }

  if (!listRes.ok || listJson.status !== "success") {
    // Fallback: some accounts use a different list shape — try unfiltered
    // and filter client-side when possible.
    console.warn(
      "[flutterwave] could not list subscriptions by email:",
      listJson,
    )
    return 0
  }

  let canceled = 0
  for (const sub of listJson.data ?? []) {
    if (!sub.id) continue
    if (sub.status && sub.status !== "active") continue
    const cancelRes = await fetch(
      `${FLW_API}/subscriptions/${sub.id}/cancel`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${key}` },
      },
    )
    if (cancelRes.ok) canceled += 1
  }
  return canceled
}

/**
 * Persist Flutterwave customer email on the profile (reuses stripe_customer_id
 * column to avoid a migration).
 */
export async function rememberBillingEmail(
  userId: string,
  email: string,
): Promise<void> {
  const admin = getSupabaseAdmin()
  if (!admin) return
  await admin
    .from("profiles")
    .update({ stripe_customer_id: email.toLowerCase() })
    .eq("id", userId)
}

/** @deprecated Stripe removed — throws if called. */
export function getStripe(): never {
  throw new Error(
    "Stripe has been replaced by Flutterwave. Use createFlutterwavePayment().",
  )
}

/** @deprecated */
export function getPriceId(plan: Plan): string {
  return getFlutterwavePlanId(plan)
}

/** @deprecated Top-ups use pack.amountCents directly. */
export function getTopupPriceId(_pack: TopupPack): string {
  throw new Error(
    "Stripe top-up price ids are unused. Amount comes from TOPUP_PACKS.",
  )
}

/** @deprecated */
export async function getOrCreateCustomerId(
  userId: string,
  email: string,
): Promise<string> {
  await rememberBillingEmail(userId, email)
  return email.toLowerCase()
}
