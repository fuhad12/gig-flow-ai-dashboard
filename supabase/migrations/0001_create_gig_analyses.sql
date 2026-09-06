-- JobFlow AI: persistence for scraped gigs + AI analyses.
--
-- Run this in the Supabase SQL editor (or via `supabase db push`) once.

create extension if not exists "pgcrypto";

create table if not exists public.gig_analyses (
  id          uuid          primary key default gen_random_uuid(),
  url         text          not null,
  scraped     jsonb         not null,
  analysis    jsonb         not null,
  created_at  timestamptz   not null default now()
);

-- Fast lookup of the freshest analysis for a given URL.
create index if not exists gig_analyses_url_created_at_idx
  on public.gig_analyses (url, created_at desc);

-- RLS: this table is only ever touched by the server using the service-role
-- key, so we lock it down entirely from anon/auth clients. When user accounts
-- are added later, swap this for per-row policies keyed on user_id.
alter table public.gig_analyses enable row level security;
