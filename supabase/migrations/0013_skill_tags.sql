-- JobFlow AI: convert `primary_skill` (single text) to `skill_tags` (text[]).
--
-- The Settings UI now treats the user's "what I sell" answer as a list of
-- tag chips ("logo design", "voiceover", "next.js") instead of one free-text
-- phrase. The AI prompts already understand a list — we just need the
-- database column to be an array so we don't keep parsing a magic
-- comma-separated string.
--
-- This migration:
--   1. Adds the new `skill_tags text[]` column with an empty-array default.
--   2. Backfills `skill_tags` from any existing `primary_skill` value by
--      splitting on commas (and "·" which the placeholder text used).
--      Empty entries are trimmed out.
--   3. Drops the old `primary_skill` column.
--   4. Adds a size-check constraint so a client can't store more than 20
--      tags. The UI enforces a tighter per-tier limit on top.
--
-- Safe to re-run: every step is conditional on the column's existence /
-- the constraint name.

-- 1. Add new column.
alter table public.profiles
  add column if not exists skill_tags text[] not null default '{}';

-- 2. Backfill from the old column when it still exists.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'primary_skill'
  ) then
    update public.profiles
       set skill_tags = coalesce(
         (
           select array_agg(t)
           from (
             -- split on comma OR the middle-dot the placeholder text used,
             -- trim whitespace, drop empties, drop dupes, normalize case.
             select distinct lower(trim(both ' ' from x)) as t
             from unnest(regexp_split_to_array(primary_skill, '[,·]')) as x
             where trim(both ' ' from x) <> ''
           ) s
         ),
         '{}'::text[]
       )
     where primary_skill is not null
       and primary_skill <> ''
       and (skill_tags is null or skill_tags = '{}');
  end if;
end $$;

-- 3. Drop the old column. Use `if exists` so a second run is a no-op.
alter table public.profiles
  drop column if exists primary_skill;

-- 4. Hard data-layer cap on tag count. The UI enforces a tighter per-tier
--    limit (e.g. 5 for free, 10 for pro) — this is the safety net.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_skill_tags_size_check'
  ) then
    alter table public.profiles
      add constraint profiles_skill_tags_size_check
      check (array_length(skill_tags, 1) is null
             or array_length(skill_tags, 1) <= 20);
  end if;
end $$;
