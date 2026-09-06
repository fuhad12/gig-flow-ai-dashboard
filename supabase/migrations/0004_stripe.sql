-- JobFlow AI: Stripe subscription state on profiles.
-- Premium is derived at read time: subscription_status IN ('active', 'trialing').

alter table public.profiles
  add column if not exists stripe_customer_id     text unique,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id        text,
  add column if not exists subscription_status    text,
  add column if not exists subscription_plan      text,   -- 'monthly' | 'yearly'
  add column if not exists current_period_end     timestamptz;

create index if not exists profiles_stripe_customer_id_idx
  on public.profiles (stripe_customer_id);

-- The legacy is_premium column is left in place for backward compatibility
-- but the app derives premium from subscription_status going forward.
