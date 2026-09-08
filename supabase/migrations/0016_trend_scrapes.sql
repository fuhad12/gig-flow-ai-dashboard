-- JobFlow AI: meter niche trend scrapes (Firecrawl / Apify) per user.
--
-- Shared niche_gigs cache stays global; this table only counts when a
-- signed-in user's request actually triggers a fresh scrape. Monthly
-- caps live in lib/quota.ts (Free 2 / Pro 7 / Agency 15).
--
-- Depends on: 0002 (auth.users / profiles).

create table if not exists public.trend_scrapes (
  id          uuid          primary key default gen_random_uuid(),
  user_id     uuid          not null references auth.users(id) on delete cascade,
  niche_slug  text          not null,
  created_at  timestamptz   not null default now()
);

create index if not exists trend_scrapes_user_id_created_at_idx
  on public.trend_scrapes (user_id, created_at desc);

alter table public.trend_scrapes enable row level security;

drop policy if exists "trend_scrapes: users can read their own rows"
  on public.trend_scrapes;
create policy "trend_scrapes: users can read their own rows"
  on public.trend_scrapes for select
  using (auth.uid() = user_id);

-- Inserts are service-role-only so the API can enforce the monthly cap.
