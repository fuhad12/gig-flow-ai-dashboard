-- =============================================================================
-- JobFlow AI — Catch-up / repair for an EXISTING database
-- Safe to re-run. Does NOT replace a fresh install — use setup.sql for that.
--
-- Fixes the usual gaps on older projects:
--   • profiles billing / niches / skill_tags / onboarded_at / referred_by
--   • influencers + referral_commissions (your screenshot: influencers missing)
--   • decrement_oldest_topup + reserve_credit_slot RPCs
--
-- After running, execute schema_health_check.sql — every `ok` should be true.
-- If core tables (gig_analyses, tracked_gigs, …) are missing, run setup.sql.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------- Profiles catch-up ----------

alter table public.profiles
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id        text,
  add column if not exists subscription_status    text,
  add column if not exists subscription_plan      text,
  add column if not exists current_period_end     timestamptz,
  add column if not exists subscription_tier      text,
  add column if not exists selected_niches        text[] not null default '{}',
  add column if not exists skill_tags             text[] not null default '{}',
  add column if not exists onboarded_at           timestamptz,
  add column if not exists referred_by_influencer_id uuid;

do $$
begin
  update public.profiles
     set subscription_tier = 'free'
   where subscription_tier is null;

  begin
    alter table public.profiles
      alter column subscription_tier set default 'free';
  exception when others then
    null;
  end;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_subscription_tier_check'
  ) then
    alter table public.profiles
      add constraint profiles_subscription_tier_check
      check (subscription_tier in ('free', 'pro', 'agency'));
  end if;

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

create unique index if not exists profiles_stripe_customer_id_idx
  on public.profiles (stripe_customer_id);

-- ---------- Influencers FIRST (required before commissions FK) ----------

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

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_referred_by_influencer_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_referred_by_influencer_id_fkey
      foreign key (referred_by_influencer_id)
      references public.influencers(id)
      on delete set null;
  end if;
end $$;

create index if not exists profiles_referred_by_influencer_id_idx
  on public.profiles (referred_by_influencer_id)
  where referred_by_influencer_id is not null;

-- ---------- Referral commissions ----------

create table if not exists public.referral_commissions (
  id                   uuid          primary key default gen_random_uuid(),
  influencer_id        uuid          not null,
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

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'referral_commissions_influencer_id_fkey'
  ) then
    -- Only attach FK if orphan rows won't block it
    if not exists (
      select 1
      from public.referral_commissions c
      left join public.influencers i on i.id = c.influencer_id
      where i.id is null
    ) then
      alter table public.referral_commissions
        add constraint referral_commissions_influencer_id_fkey
        foreign key (influencer_id)
        references public.influencers(id)
        on delete cascade;
    end if;
  end if;
end $$;

alter table public.referral_commissions enable row level security;

-- ---------- Credit RPCs ----------

create or replace function public.decrement_oldest_topup(uid uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  topup_id uuid;
begin
  select id into topup_id
    from public.credit_topups
   where user_id = uid
     and credits_remaining > 0
     and (expires_at is null or expires_at > now())
   order by created_at asc
   for update skip locked
   limit 1;

  if topup_id is null then
    return null;
  end if;

  update public.credit_topups
     set credits_remaining = credits_remaining - 1
   where id = topup_id
     and credits_remaining > 0;

  if not found then
    return null;
  end if;

  return topup_id;
end;
$$;

revoke all on function public.decrement_oldest_topup(uuid) from public;
grant execute on function public.decrement_oldest_topup(uuid) to service_role;

create or replace function public.reserve_credit_slot(
  uid           uuid,
  kind          text,
  monthly_limit integer,
  meta          jsonb
) returns uuid
language plpgsql
security definer
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
