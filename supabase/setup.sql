-- =============================================================================
-- JobFlow AI — Complete Database Setup
-- =============================================================================
--
-- This single file creates EVERYTHING the app needs in the right order.
-- Copy/paste the whole thing into the Supabase SQL editor and run once.
--
-- Safe to re-run: every statement uses `if not exists` / `drop policy if
-- exists`, so running it twice on the same database is a no-op.
--
-- What this file builds:
--   1.  Extensions               — pgcrypto for gen_random_uuid().
--   2.  profiles                 — auth + Stripe billing + tier + niches + skill tags.
--   3.  gig_analyses             — every analyzed gig (history + public share).
--   4.  gig_generations          — every AI-generated gig draft (credit accounting).
--   5.  niche_gigs               — top gigs scraped per niche (competitor intel).
--   6.  niche_insights           — cached LLM insights, keyed by snapshot.
--   7.  tracked_gigs / snapshots — competitor monitoring time-series.
--   8.  tracked_keywords / serp_snapshots — real Fiverr SERP rank tracking.
--   9.  notifications            — activity feed (price changes, rank shifts).
--   10. credit_topups            — one-time credit pack purchases.
--   11. decrement_oldest_topup() — atomic RPC for charging topup credits.
--   12. reserve_credit_slot()    — atomic pre-LLM credit reservation.
--   13. handle_new_user()        — trigger: profile row per auth.users insert.
--   14. influencers + referral_commissions — affiliate links & Pro commissions.
--
-- Numbered migrations under supabase/migrations/ (0001…0015) match this file
-- for CLI / incremental upgrades. Fresh database: run THIS file once.
-- Existing database that already ran older setup: run only the missing
-- numbered files (typically 0012–0015, or just 0015 for influencers).
-- =============================================================================


-- =============================================================================
-- 1. Extensions
-- =============================================================================

create extension if not exists "pgcrypto";


-- =============================================================================
-- 2. profiles  (auth + billing + niches)
-- =============================================================================

create table if not exists public.profiles (
  id          uuid          primary key references auth.users(id) on delete cascade,
  email       text          not null,
  is_premium  boolean       not null default false,
  created_at  timestamptz   not null default now()
);

-- Stripe columns (set by /api/billing/webhook on subscription events).
alter table public.profiles
  add column if not exists stripe_customer_id     text unique,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id        text,
  add column if not exists subscription_status    text,
  add column if not exists subscription_plan      text,
  add column if not exists current_period_end     timestamptz;

create index if not exists profiles_stripe_customer_id_idx
  on public.profiles (stripe_customer_id);

-- Tier label — explicit replacement for the legacy `is_premium` boolean.
-- Read at runtime by lib/quota.ts.
alter table public.profiles
  add column if not exists subscription_tier text not null default 'free';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_subscription_tier_check'
  ) then
    alter table public.profiles
      add constraint profiles_subscription_tier_check
      check (subscription_tier in ('free', 'pro', 'agency'));
  end if;
end $$;

-- Niche personalization (Settings → My niches & skills).
--
-- `skill_tags` is the chip-based "what I sell" field. It supersedes the
-- earlier `primary_skill text` column — fresh installs only see the array
-- form; existing deployments are migrated by 0013_skill_tags.sql which
-- splits the old comma-separated string and drops the legacy column.
alter table public.profiles
  add column if not exists selected_niches text[]      not null default '{}',
  add column if not exists skill_tags      text[]      not null default '{}',
  add column if not exists onboarded_at    timestamptz null;

-- Existing installs may still have the old singular column. Backfill
-- `skill_tags` from it and drop it. Both steps are conditional so a
-- fresh install is a no-op.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'primary_skill'
  ) then
    update public.profiles
       set skill_tags = coalesce(
         (
           select array_agg(t)
           from (
             select distinct lower(trim(both ' ' from x)) as t
             from unnest(regexp_split_to_array(primary_skill, '[,·]')) as x
             where trim(both ' ' from x) <> ''
           ) s
         ),
         '{}'::text[]
       )
     where primary_skill is not null
       and primary_skill <> ''
       and (skill_tags is null or skill_tags = '{}');
    alter table public.profiles drop column if exists primary_skill;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_selected_niches_size_check'
  ) then
    alter table public.profiles
      add constraint profiles_selected_niches_size_check
      check (array_length(selected_niches, 1) is null
             or array_length(selected_niches, 1) <= 20);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_skill_tags_size_check'
  ) then
    alter table public.profiles
      add constraint profiles_skill_tags_size_check
      check (array_length(skill_tags, 1) is null
             or array_length(skill_tags, 1) <= 20);
  end if;
end $$;

-- RLS — users can read & update their own profile only.
alter table public.profiles enable row level security;

drop policy if exists "profiles: users can read their own row" on public.profiles;
create policy "profiles: users can read their own row"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: users can update their own row" on public.profiles;
create policy "profiles: users can update their own row"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever a new auth.users row appears.
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- One-time backfill: every auth.users row that doesn't already have a
-- matching profiles row gets one. Without this, accounts that signed up
-- BEFORE the trigger was deployed end up orphaned — every UPDATE on
-- public.profiles silently affects 0 rows, so "Save niches" appears to
-- succeed but nothing persists. Safe to re-run; `on conflict do nothing`.
insert into public.profiles (id, email)
select u.id, coalesce(u.email, '')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;


-- =============================================================================
-- 3. gig_analyses  (scraped gig + AI audit history; also drives public shares)
-- =============================================================================

create table if not exists public.gig_analyses (
  id          uuid          primary key default gen_random_uuid(),
  url         text          not null,
  scraped     jsonb         not null,
  analysis    jsonb         not null,
  created_at  timestamptz   not null default now()
);

create index if not exists gig_analyses_url_created_at_idx
  on public.gig_analyses (url, created_at desc);

-- Per-user history (added in migration 0002).
alter table public.gig_analyses
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists gig_analyses_user_id_created_at_idx
  on public.gig_analyses (user_id, created_at desc);

-- Shareable public audit links (migration 0007).
alter table public.gig_analyses
  add column if not exists public_slug text unique,
  add column if not exists shared_at   timestamptz;

create index if not exists gig_analyses_public_slug_idx
  on public.gig_analyses (public_slug)
  where public_slug is not null;

alter table public.gig_analyses enable row level security;

drop policy if exists "gig_analyses: users can read their own rows" on public.gig_analyses;
create policy "gig_analyses: users can read their own rows"
  on public.gig_analyses for select
  using (auth.uid() = user_id);

-- Anonymous read for shared rows (powers /audit/[slug]).
drop policy if exists "gig_analyses: anyone can read shared rows" on public.gig_analyses;
create policy "gig_analyses: anyone can read shared rows"
  on public.gig_analyses for select
  using (public_slug is not null);


-- =============================================================================
-- 4. gig_generations  (AI generator history — counts against monthly credits)
-- =============================================================================

create table if not exists public.gig_generations (
  id          uuid          primary key default gen_random_uuid(),
  user_id     uuid          not null references auth.users(id) on delete cascade,
  niche       text          not null,
  generation  jsonb         not null,
  created_at  timestamptz   not null default now()
);

create index if not exists gig_generations_user_id_created_at_idx
  on public.gig_generations (user_id, created_at desc);

alter table public.gig_generations enable row level security;

drop policy if exists "gig_generations: users can read their own rows" on public.gig_generations;
create policy "gig_generations: users can read their own rows"
  on public.gig_generations for select
  using (auth.uid() = user_id);


-- =============================================================================
-- 5. niche_gigs  (top gigs scraped per niche, drives trends + keyword stats)
-- =============================================================================

create table if not exists public.niche_gigs (
  id            uuid          primary key default gen_random_uuid(),
  niche_slug    text          not null,
  url           text          not null,
  title         text          not null,
  price         numeric,
  rating        numeric,
  review_count  integer,
  seller_level  text,
  position      integer,
  scraped_at    timestamptz   not null default now()
);

create index if not exists niche_gigs_slug_scraped_at_idx
  on public.niche_gigs (niche_slug, scraped_at desc);

alter table public.niche_gigs enable row level security;

drop policy if exists "niche_gigs: signed-in users can read" on public.niche_gigs;
create policy "niche_gigs: signed-in users can read"
  on public.niche_gigs for select
  to authenticated
  using (true);


-- =============================================================================
-- 5b. trend_scrapes  (meters Firecrawl/Apify niche scrapes per user/month)
-- =============================================================================

create table if not exists public.trend_scrapes (
  id          uuid          primary key default gen_random_uuid(),
  user_id     uuid          not null references auth.users(id) on delete cascade,
  niche_slug  text          not null,
  created_at  timestamptz   not null default now()
);

create index if not exists trend_scrapes_user_id_created_at_idx
  on public.trend_scrapes (user_id, created_at desc);

alter table public.trend_scrapes enable row level security;

drop policy if exists "trend_scrapes: users can read their own rows" on public.trend_scrapes;
create policy "trend_scrapes: users can read their own rows"
  on public.trend_scrapes for select
  using (auth.uid() = user_id);


-- =============================================================================
-- 6. niche_insights  (cached LLM market-intel per (niche_slug, scraped_at))
-- =============================================================================

create table if not exists public.niche_insights (
  niche_slug   text          not null,
  scraped_at   timestamptz   not null,
  insights     jsonb         not null,
  created_at   timestamptz   not null default now(),
  primary key (niche_slug, scraped_at)
);

create index if not exists niche_insights_slug_created_at_idx
  on public.niche_insights (niche_slug, created_at desc);

alter table public.niche_insights enable row level security;

drop policy if exists "niche_insights: signed-in users can read" on public.niche_insights;
create policy "niche_insights: signed-in users can read"
  on public.niche_insights for select
  to authenticated
  using (true);


-- =============================================================================
-- 7. tracked_gigs + tracked_gig_snapshots  (competitor monitoring time-series)
-- =============================================================================

create table if not exists public.tracked_gigs (
  id          uuid          primary key default gen_random_uuid(),
  user_id     uuid          not null references auth.users(id) on delete cascade,
  url         text          not null,
  nickname    text,
  created_at  timestamptz   not null default now(),
  unique (user_id, url)
);

create index if not exists tracked_gigs_user_id_idx
  on public.tracked_gigs (user_id);

alter table public.tracked_gigs enable row level security;

drop policy if exists "tracked_gigs: users select own" on public.tracked_gigs;
create policy "tracked_gigs: users select own"
  on public.tracked_gigs for select
  using (auth.uid() = user_id);

drop policy if exists "tracked_gigs: users insert own" on public.tracked_gigs;
create policy "tracked_gigs: users insert own"
  on public.tracked_gigs for insert
  with check (auth.uid() = user_id);

drop policy if exists "tracked_gigs: users update own" on public.tracked_gigs;
create policy "tracked_gigs: users update own"
  on public.tracked_gigs for update
  using (auth.uid() = user_id);

drop policy if exists "tracked_gigs: users delete own" on public.tracked_gigs;
create policy "tracked_gigs: users delete own"
  on public.tracked_gigs for delete
  using (auth.uid() = user_id);

create table if not exists public.tracked_gig_snapshots (
  id              uuid          primary key default gen_random_uuid(),
  tracked_gig_id  uuid          not null references public.tracked_gigs(id) on delete cascade,
  scraped_at      timestamptz   not null default now(),
  title           text          not null,
  description     text          not null,
  thumbnail_url   text,
  tags            jsonb         not null,
  packages        jsonb         not null,
  min_price       numeric,
  max_price       numeric,
  search_keyword  text,
  search_position integer
);

create index if not exists tracked_gig_snapshots_gig_time_idx
  on public.tracked_gig_snapshots (tracked_gig_id, scraped_at desc);

alter table public.tracked_gig_snapshots enable row level security;

drop policy if exists "tracked_gig_snapshots: users select own" on public.tracked_gig_snapshots;
create policy "tracked_gig_snapshots: users select own"
  on public.tracked_gig_snapshots for select
  using (
    exists (
      select 1 from public.tracked_gigs tg
      where tg.id = tracked_gig_id and tg.user_id = auth.uid()
    )
  );


-- =============================================================================
-- 8. tracked_keywords + serp_snapshots  (Fiverr SERP rank tracking)
-- =============================================================================

create table if not exists public.tracked_keywords (
  id              uuid          primary key default gen_random_uuid(),
  tracked_gig_id  uuid          not null references public.tracked_gigs(id) on delete cascade,
  keyword         text          not null,
  search_url      text          not null,
  created_at      timestamptz   not null default now(),
  unique (tracked_gig_id, keyword)
);

create index if not exists tracked_keywords_tracked_gig_idx
  on public.tracked_keywords (tracked_gig_id);

alter table public.tracked_keywords enable row level security;

drop policy if exists "tracked_keywords: users select own" on public.tracked_keywords;
create policy "tracked_keywords: users select own"
  on public.tracked_keywords for select
  using (
    exists (
      select 1 from public.tracked_gigs tg
      where tg.id = tracked_gig_id and tg.user_id = auth.uid()
    )
  );

create table if not exists public.serp_snapshots (
  id                  uuid          primary key default gen_random_uuid(),
  tracked_keyword_id  uuid          not null references public.tracked_keywords(id) on delete cascade,
  checked_at          timestamptz   not null default now(),
  position            integer,
  not_found           boolean       not null default false,
  results_scanned     integer       not null default 0,
  competitors         jsonb         not null default '[]'::jsonb
);

create index if not exists serp_snapshots_kw_time_idx
  on public.serp_snapshots (tracked_keyword_id, checked_at desc);

alter table public.serp_snapshots enable row level security;

drop policy if exists "serp_snapshots: users select own" on public.serp_snapshots;
create policy "serp_snapshots: users select own"
  on public.serp_snapshots for select
  using (
    exists (
      select 1
      from public.tracked_keywords tk
      join public.tracked_gigs tg on tg.id = tk.tracked_gig_id
      where tk.id = tracked_keyword_id and tg.user_id = auth.uid()
    )
  );


-- =============================================================================
-- 9. notifications  (in-app activity feed + email-trigger source)
-- =============================================================================

create table if not exists public.notifications (
  id           uuid          primary key default gen_random_uuid(),
  user_id      uuid          not null references auth.users(id) on delete cascade,
  kind         text          not null,
  title        text          not null,
  body         text          not null,
  payload      jsonb         not null default '{}'::jsonb,
  created_at   timestamptz   not null default now(),
  read_at      timestamptz
);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

create index if not exists notifications_user_recent_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications: users select own" on public.notifications;
create policy "notifications: users select own"
  on public.notifications for select
  using (auth.uid() = user_id);

drop policy if exists "notifications: users update own" on public.notifications;
create policy "notifications: users update own"
  on public.notifications for update
  using (auth.uid() = user_id);

drop policy if exists "notifications: users delete own" on public.notifications;
create policy "notifications: users delete own"
  on public.notifications for delete
  using (auth.uid() = user_id);


-- =============================================================================
-- 10. credit_topups  (one-time pack purchases, idempotent via PI id)
-- =============================================================================

create table if not exists public.credit_topups (
  id                          uuid          primary key default gen_random_uuid(),
  user_id                     uuid          not null references auth.users(id) on delete cascade,
  -- UNIQUE — Stripe webhook retries can never double-credit the user.
  stripe_payment_intent_id    text          not null unique,
  pack_id                     text          not null,
  credits_total               integer       not null check (credits_total > 0),
  credits_remaining           integer       not null check (credits_remaining >= 0),
  amount_paid_cents           integer       not null check (amount_paid_cents >= 0),
  currency                    text          not null default 'usd',
  created_at                  timestamptz   not null default now(),
  expires_at                  timestamptz   null
);

create index if not exists credit_topups_user_id_created_at_idx
  on public.credit_topups (user_id, created_at asc);

create index if not exists credit_topups_user_with_balance_idx
  on public.credit_topups (user_id)
  where credits_remaining > 0;

alter table public.credit_topups enable row level security;

drop policy if exists "credit_topups: users can read their own rows" on public.credit_topups;
create policy "credit_topups: users can read their own rows"
  on public.credit_topups for select
  using (auth.uid() = user_id);


-- =============================================================================
-- 11. decrement_oldest_topup(uid)  (atomic credit charge — single-statement
--     "pick oldest non-empty topup row and decrement by 1", with FOR UPDATE
--     SKIP LOCKED so concurrent calls can't double-spend a credit)
-- =============================================================================

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

revoke all on function public.decrement_oldest_topup(uuid) from public;
grant execute on function public.decrement_oldest_topup(uuid) to service_role;


-- =============================================================================
-- 12. reserve_credit_slot(uid, kind, monthly_limit, meta)
--     (atomic credit reservation — closes the TOCTOU race where two
--     concurrent /api/generate or /api/analyze calls could each pass the
--     pre-check and both run the LLM, only one of them being metered.
--     Inserts a placeholder row BEFORE the LLM call, under a per-user
--     advisory lock. The caller UPDATEs the row with the real LLM
--     output afterward — or DELETEs it on failure to roll back.)
-- =============================================================================

create or replace function public.reserve_credit_slot(
  uid           uuid,
  kind          text,
  monthly_limit integer,
  meta          jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  used_count    integer;
  topup_total   integer;
  reservation   uuid;
begin
  perform pg_advisory_xact_lock(hashtext('credit_gate:' || uid::text));

  select (
      (select count(*) from public.gig_analyses
         where user_id = uid
           and created_at >= date_trunc('month', now() at time zone 'utc'))
      +
      (select count(*) from public.gig_generations
         where user_id = uid
           and created_at >= date_trunc('month', now() at time zone 'utc'))
    ) into used_count;

  select coalesce(sum(credits_remaining), 0)
    from public.credit_topups
   where user_id = uid
     and credits_remaining > 0
     and (expires_at is null or expires_at > now())
   into topup_total;

  if used_count >= (monthly_limit + topup_total) then
    return null;
  end if;

  if kind = 'analysis' then
    insert into public.gig_analyses (user_id, url, scraped, analysis)
    values (
      uid,
      meta ->> 'url',
      coalesce(meta -> 'scraped',  '{}'::jsonb),
      coalesce(meta -> 'analysis', '{}'::jsonb)
    )
    returning id into reservation;
  elsif kind = 'generation' then
    insert into public.gig_generations (user_id, niche, generation)
    values (
      uid,
      meta ->> 'niche',
      coalesce(meta -> 'generation', '{}'::jsonb)
    )
    returning id into reservation;
  else
    raise exception 'reserve_credit_slot: unknown kind %', kind;
  end if;

  return reservation;
end;
$$;

revoke all on function public.reserve_credit_slot(uuid, text, integer, jsonb)
  from public;
grant execute on function public.reserve_credit_slot(uuid, text, integer, jsonb)
  to authenticated, service_role;


-- =============================================================================
-- 13. Influencers + referral commissions
-- =============================================================================

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

alter table public.profiles
  add column if not exists referred_by_influencer_id uuid
    references public.influencers(id) on delete set null;

create index if not exists profiles_referred_by_influencer_id_idx
  on public.profiles (referred_by_influencer_id)
  where referred_by_influencer_id is not null;

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


-- =============================================================================
-- Done. Verify with:
--   select table_name from information_schema.tables
--   where table_schema = 'public' order by table_name;
--
-- You should see (in any order):
--   credit_topups, gig_analyses, gig_generations, influencers, niche_gigs,
--   niche_insights, notifications, profiles, referral_commissions,
--   serp_snapshots, tracked_gig_snapshots, tracked_gigs, tracked_keywords,
--   trend_scrapes
-- =============================================================================
