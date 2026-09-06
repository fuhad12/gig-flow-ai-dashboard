-- ---------- Gig tracking ----------
-- Lets a user pin a gig URL (their own or a competitor's) and accumulate
-- a time-series of scrape snapshots they can chart and diff.

create extension if not exists "pgcrypto";

-- A gig the user is tracking. (user, url) is unique so one gig per user.
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

drop policy if exists "tracked_gigs: users select own"
  on public.tracked_gigs;
create policy "tracked_gigs: users select own"
  on public.tracked_gigs
  for select
  using (auth.uid() = user_id);

drop policy if exists "tracked_gigs: users insert own"
  on public.tracked_gigs;
create policy "tracked_gigs: users insert own"
  on public.tracked_gigs
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "tracked_gigs: users update own"
  on public.tracked_gigs;
create policy "tracked_gigs: users update own"
  on public.tracked_gigs
  for update
  using (auth.uid() = user_id);

drop policy if exists "tracked_gigs: users delete own"
  on public.tracked_gigs;
create policy "tracked_gigs: users delete own"
  on public.tracked_gigs
  for delete
  using (auth.uid() = user_id);

-- A point-in-time scrape of a tracked gig. We store the whole scrape so the
-- UI can show diffs (title rewrites, package changes, etc.) without re-scraping.
create table if not exists public.tracked_gig_snapshots (
  id              uuid          primary key default gen_random_uuid(),
  tracked_gig_id  uuid          not null references public.tracked_gigs(id) on delete cascade,
  scraped_at      timestamptz   not null default now(),
  title           text          not null,
  description     text          not null,
  thumbnail_url   text,
  tags            jsonb         not null,
  packages        jsonb         not null,
  -- Denormalized numeric fields so charts don't have to crunch jsonb.
  min_price       numeric,
  max_price       numeric,
  -- Reserved for a future rank-in-search feature.
  search_keyword  text,
  search_position integer
);

create index if not exists tracked_gig_snapshots_gig_time_idx
  on public.tracked_gig_snapshots (tracked_gig_id, scraped_at desc);

alter table public.tracked_gig_snapshots enable row level security;

-- Snapshots are visible to the owner of the tracked gig. The using clause
-- delegates to tracked_gigs which itself enforces RLS.
drop policy if exists "tracked_gig_snapshots: users select own"
  on public.tracked_gig_snapshots;
create policy "tracked_gig_snapshots: users select own"
  on public.tracked_gig_snapshots
  for select
  using (
    exists (
      select 1
      from public.tracked_gigs tg
      where tg.id = tracked_gig_id
        and tg.user_id = auth.uid()
    )
  );

-- Inserts/deletes go through the server role (service key) from the API,
-- so we intentionally do NOT add insert/delete policies for `authenticated`.
