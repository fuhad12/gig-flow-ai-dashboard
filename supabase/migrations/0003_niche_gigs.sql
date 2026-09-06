-- JobFlow AI: competitor intelligence.
-- Stores top gigs per niche so we can derive keyword trends, price stats,
-- and evidence-based critiques. Read by any signed-in user; writes happen
-- server-side via the service role.

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

-- Allow any signed-in user to read trends data.
drop policy if exists "niche_gigs: signed-in users can read" on public.niche_gigs;
create policy "niche_gigs: signed-in users can read"
  on public.niche_gigs for select
  to authenticated
  using (true);
