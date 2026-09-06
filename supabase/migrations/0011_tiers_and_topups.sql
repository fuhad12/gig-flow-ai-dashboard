-- JobFlow AI: subscription tiers + one-time credit top-up packs.
--
-- This migration adds three things:
--
--   1. `profiles.subscription_tier`
--      Replaces the binary `is_premium` model with an explicit tier label
--      ("free", "pro", "agency") so monthly limits can be per-tier. The
--      column defaults to "free" and is updated by the Stripe webhook
--      based on which price the user is subscribed to.
--
--   2. `credit_topups`
--      One row per top-up PURCHASE (not per credit). Tracks both the
--      original amount (`credits_total` — never changes) and the live
--      balance (`credits_remaining` — decrements as the user burns
--      credits). Bookkeeping invariants the app relies on:
--          - `stripe_payment_intent_id` is UNIQUE → Stripe webhook
--            retries can never double-credit the user.
--          - `credits_remaining` has a >= 0 CHECK → no underflow even
--            under concurrent decrement attempts.
--          - Decrements always go through the atomic RPC below.
--
--   3. `decrement_oldest_topup(uid uuid)` RPC
--      Atomically decrements the OLDEST top-up row that still has
--      credits remaining, with `FOR UPDATE SKIP LOCKED` so concurrent
--      requests can't race past each other. Returns the topup id used,
--      or NULL if the user has no top-up balance.
--
-- Depends on: 0001 (gig_analyses), 0002 (profiles), 0004 (stripe cols),
--             0010 (gig_generations).

-- ---------- 1. Subscription tier ----------

alter table public.profiles
  add column if not exists subscription_tier text not null default 'free';

-- Constrain the allowed values. Keep the constraint creation idempotent —
-- check existence before adding so re-running the migration is safe.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_subscription_tier_check'
  ) then
    alter table public.profiles
      add constraint profiles_subscription_tier_check
      check (subscription_tier in ('free', 'pro', 'agency'));
  end if;
end $$;

-- ---------- 2. Top-up purchases ----------

create table if not exists public.credit_topups (
  id                          uuid          primary key default gen_random_uuid(),
  user_id                     uuid          not null references auth.users(id) on delete cascade,
  -- The Stripe PaymentIntent id from the one-time Checkout session. UNIQUE
  -- because webhook retries can deliver the same `checkout.session.completed`
  -- event multiple times — the unique constraint is what makes us safe.
  stripe_payment_intent_id    text          not null unique,
  -- The pack the user bought (e.g. "topup-10", "topup-25"). Free-form so we
  -- can add new packs without a migration.
  pack_id                     text          not null,
  credits_total               integer       not null check (credits_total > 0),
  credits_remaining           integer       not null check (credits_remaining >= 0),
  -- Original amount the user paid, in the smallest currency unit (cents).
  -- Stored for audit / receipts only — not used in any business logic.
  amount_paid_cents           integer       not null check (amount_paid_cents >= 0),
  currency                    text          not null default 'usd',
  created_at                  timestamptz   not null default now(),
  -- NULL means "no expiry". We default to no expiry so users get exactly
  -- what they paid for; expiry can be set per-row later if policy changes.
  expires_at                  timestamptz   null
);

create index if not exists credit_topups_user_id_created_at_idx
  on public.credit_topups (user_id, created_at asc);

-- Fast lookup of "does this user have any balance left right now?"
create index if not exists credit_topups_user_with_balance_idx
  on public.credit_topups (user_id)
  where credits_remaining > 0;

alter table public.credit_topups enable row level security;

drop policy if exists "credit_topups: users can read their own rows"
  on public.credit_topups;
create policy "credit_topups: users can read their own rows"
  on public.credit_topups for select
  using (auth.uid() = user_id);

-- Inserts/updates go through the service role only — the API enforces the
-- idempotency contract and the atomic decrement RPC.

-- ---------- 3. Atomic decrement RPC ----------
--
-- Why an RPC instead of a regular UPDATE through supabase-js?
--
-- We want "atomically pick the oldest row with credits_remaining > 0 and
-- decrement it by 1". Doing that as two queries (SELECT then UPDATE) opens a
-- race window where two concurrent API calls both pick the same row, both
-- decrement, and a credit can be "spent twice".
--
-- `FOR UPDATE SKIP LOCKED` in a single statement makes the choice + lock
-- atomic. If two calls happen at the exact same moment and both target the
-- same oldest row, one wins the lock; the other skips that row and either
-- picks the next available one or returns NULL.

create or replace function public.decrement_oldest_topup(uid uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  with picked as (
    select id
    from public.credit_topups
    where user_id = uid
      and credits_remaining > 0
      and (expires_at is null or expires_at > now())
    order by created_at asc
    limit 1
    for update skip locked
  )
  update public.credit_topups t
  set credits_remaining = credits_remaining - 1
  from picked
  where t.id = picked.id
  returning t.id into target_id;

  return target_id;
end;
$$;

-- Allow the service role to call it. Anon/auth roles should not — every
-- credit deduction must go through the API which audits + gates.
revoke all on function public.decrement_oldest_topup(uuid) from public;
grant execute on function public.decrement_oldest_topup(uuid) to service_role;
