-- JobFlow AI: shareable public audit links.
--
-- Adds an optional `public_slug` to each gig analysis. When a slug is
-- present the row is considered public and can be read by anonymous
-- visitors at /audit/<slug>. Toggling sharing off is just nulling the
-- slug back out (we don't delete the row).
--
-- Depends on: 0002_auth_and_quotas.sql.

alter table public.gig_analyses
  add column if not exists public_slug text unique,
  add column if not exists shared_at   timestamptz;

-- Partial index — most rows will never be shared.
create index if not exists gig_analyses_public_slug_idx
  on public.gig_analyses (public_slug)
  where public_slug is not null;

-- Anyone (authed or anon) can SELECT a row when it has a slug. This is what
-- powers the public /audit/[slug] page. Owner-row reads continue to work
-- through the existing "users can read their own rows" policy.
drop policy if exists "gig_analyses: anyone can read shared rows"
  on public.gig_analyses;
create policy "gig_analyses: anyone can read shared rows"
  on public.gig_analyses for select
  using (public_slug is not null);
