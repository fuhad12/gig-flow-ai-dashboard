-- JobFlow AI: persistence for AI-generated gig drafts (the "Gig Generator").
--
-- We track generations in their own table so we can:
--   1. Show the user a history of drafts (future UI).
--   2. Meter generations against the same monthly AI-credit budget as
--      analyses, so `/api/generate` can no longer be used as an
--      unlimited free pass on Pro-tier compute. See `lib/quota.ts`.
--
-- Depends on: 0001 (gig_analyses), 0002 (profiles + auth wiring).

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

-- Allow signed-in users to read their own drafts. Inserts remain
-- service-role-only so the API can enforce the credit quota.
drop policy if exists "gig_generations: users can read their own rows"
  on public.gig_generations;
create policy "gig_generations: users can read their own rows"
  on public.gig_generations for select
  using (auth.uid() = user_id);
