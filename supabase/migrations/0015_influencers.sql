-- JobFlow AI: influencer referrals + recurring Pro commissions.
--
--   1. influencers — admin-created affiliates with a shareable /r/{code} link
--   2. profiles.referred_by_influencer_id — first-touch attribution
--   3. referral_commissions — one row per Pro invoice.paid (idempotent on stripe_invoice_id)
--
-- Depends on: 0002 (profiles).

-- ---------- Influencers ----------

create table if not exists public.influencers (
  id              uuid          primary key default gen_random_uuid(),
  code            text          not null,
  name            text          not null,
  email           text          not null,
  commission_pct  numeric(5,2)  not null default 20
                    check (commission_pct >= 0 and commission_pct <= 100),
  active          boolean       not null default true,
  created_at      timestamptz   not null default now()
);

create unique index if not exists influencers_code_lower_idx
  on public.influencers (lower(code));

create unique index if not exists influencers_email_lower_idx
  on public.influencers (lower(email));

alter table public.influencers enable row level security;
-- No authenticated policies: all reads/writes go through the service-role API.

-- ---------- Profile attribution ----------

alter table public.profiles
  add column if not exists referred_by_influencer_id uuid
    references public.influencers(id) on delete set null;

create index if not exists profiles_referred_by_influencer_id_idx
  on public.profiles (referred_by_influencer_id)
  where referred_by_influencer_id is not null;

-- ---------- Commissions ----------

create table if not exists public.referral_commissions (
  id                   uuid          primary key default gen_random_uuid(),
  influencer_id        uuid          not null references public.influencers(id) on delete cascade,
  user_id              uuid          not null references auth.users(id) on delete cascade,
  stripe_invoice_id    text          not null,
  amount_cents         integer       not null check (amount_cents >= 0),
  invoice_amount_cents integer       not null check (invoice_amount_cents >= 0),
  currency             text          not null default 'usd',
  status               text          not null default 'pending'
                       check (status in ('pending', 'paid')),
  created_at           timestamptz   not null default now()
);

create unique index if not exists referral_commissions_stripe_invoice_id_idx
  on public.referral_commissions (stripe_invoice_id);

create index if not exists referral_commissions_influencer_id_created_at_idx
  on public.referral_commissions (influencer_id, created_at desc);

alter table public.referral_commissions enable row level security;
-- Service-role only.
