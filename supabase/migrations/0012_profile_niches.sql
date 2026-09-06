-- JobFlow AI: per-user niche selection + primary skill.
--
-- Until now the app defaulted every user to the first niche in the
-- catalog ("AI Apps"), which meant non-AI sellers saw irrelevant
-- competitor scrapes and the AI assistants tended to drift toward
-- AI/dev jargon. This migration lets each user pin the niches they
-- actually sell in, so:
--
--   1. The trends UI only surfaces THEIR niches in the dropdown.
--   2. On-demand Firecrawl scrapes are gated to those niches —
--      previously any signed-in user could trigger a scrape for any
--      of 16 niches just by changing the dropdown, burning credits.
--   3. AI prompts pick up the user's primary niche + skill phrase as
--      contextual hints, so generated copy isn't AI-dev biased.
--
-- New columns are nullable / default-empty so existing rows keep
-- working — code falls back to "no selection" gracefully.

alter table public.profiles
  add column if not exists selected_niches text[] not null default '{}',
  add column if not exists primary_skill   text   null,
  add column if not exists onboarded_at    timestamptz null;

-- Cap the selection to a sensible upper bound — the multi-select
-- UI will enforce a tighter limit per tier (e.g. 3 for free, 10 for
-- pro/agency), but this is a hard rail at the data layer so a
-- malicious client can't cram 1000 niches into the array.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_selected_niches_size_check'
  ) then
    alter table public.profiles
      add constraint profiles_selected_niches_size_check
      check (array_length(selected_niches, 1) is null
             or array_length(selected_niches, 1) <= 20);
  end if;
end $$;
