-- JobFlow AI: user profiles + per-user gig analyses + RLS policies.
--
-- Depends on: 0001_create_gig_analyses.sql.
-- Run this in the Supabase SQL editor after migration 0001.

-- ---------- Profiles ----------

create table if not exists public.profiles (
  id          uuid          primary key references auth.users(id) on delete cascade,
  email       text          not null,
  is_premium  boolean       not null default false,
  created_at  timestamptz   not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: users can read their own row"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: users can update their own row"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row when a new auth.users row appears.
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

-- ---------- Tie gig analyses to a user ----------

alter table public.gig_analyses
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists gig_analyses_user_id_created_at_idx
  on public.gig_analyses (user_id, created_at desc);

-- Allow signed-in users to read their own history. Inserts/updates remain
-- service-role-only so server enforces quotas and validation.
drop policy if exists "gig_analyses: users can read their own rows"
  on public.gig_analyses;
create policy "gig_analyses: users can read their own rows"
  on public.gig_analyses for select
  using (auth.uid() = user_id);
