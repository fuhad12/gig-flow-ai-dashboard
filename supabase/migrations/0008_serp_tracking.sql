-- JobFlow AI: real Fiverr SERP rank tracking.
--
-- A tracked gig can be associated with N "tracked keywords" (e.g. one
-- gig URL but the seller wants to monitor where they rank for both
-- "nextjs developer" and "react developer"). For each keyword we
-- record point-in-time SERP snapshots: position (or null if not in the
-- top N), how many results we scanned, and the top competitors above
-- the user's gig.
--
-- Depends on: 0006_tracking.sql (for tracked_gigs).

create extension if not exists "pgcrypto";

-- ---------- tracked_keywords ----------

create table if not exists public.tracked_keywords (
  id              uuid          primary key default gen_random_uuid(),
  tracked_gig_id  uuid          not null references public.tracked_gigs(id) on delete cascade,
  keyword         text          not null,
  -- Resolved Fiverr search URL we hit when checking rank. Stored so the
  -- backend can refresh without re-deriving (and so we can support both
  -- /search/gigs?query=... and /categories/... URLs in future).
  search_url      text          not null,
  created_at      timestamptz   not null default now(),
  unique (tracked_gig_id, keyword)
);

create index if not exists tracked_keywords_tracked_gig_idx
  on public.tracked_keywords (tracked_gig_id);

alter table public.tracked_keywords enable row level security;

drop policy if exists "tracked_keywords: users select own"
  on public.tracked_keywords;
create policy "tracked_keywords: users select own"
  on public.tracked_keywords for select
  using (
    exists (
      select 1 from public.tracked_gigs tg
      where tg.id = tracked_gig_id and tg.user_id = auth.uid()
    )
  );

-- Inserts/updates/deletes all go through the service-role API layer
-- (mirrors the snapshots table pattern in 0006), so no auth-role write
-- policies needed here.

-- ---------- serp_snapshots ----------

create table if not exists public.serp_snapshots (
  id                  uuid          primary key default gen_random_uuid(),
  tracked_keyword_id  uuid          not null references public.tracked_keywords(id) on delete cascade,
  checked_at          timestamptz   not null default now(),
  -- 1-based position, or null if the gig wasn't found in the scanned
  -- top-N. Storing a position alongside `not_found` lets the UI
  -- distinguish "we didn't scan deep enough" from "definitely not there".
  position            integer,
  not_found           boolean       not null default false,
  -- How many SERP rows we actually scanned (Fiverr returns up to ~20
  -- in their main feed before pagination).
  results_scanned     integer       not null default 0,
  -- Top 5 competitors above the user (or top 5 overall when not_found).
  -- Each entry: { url, title, position, price }.
  competitors         jsonb         not null default '[]'::jsonb
);

create index if not exists serp_snapshots_kw_time_idx
  on public.serp_snapshots (tracked_keyword_id, checked_at desc);

alter table public.serp_snapshots enable row level security;

drop policy if exists "serp_snapshots: users select own"
  on public.serp_snapshots;
create policy "serp_snapshots: users select own"
  on public.serp_snapshots for select
  using (
    exists (
      select 1
      from public.tracked_keywords tk
      join public.tracked_gigs tg on tg.id = tk.tracked_gig_id
      where tk.id = tracked_keyword_id
        and tg.user_id = auth.uid()
    )
  );
