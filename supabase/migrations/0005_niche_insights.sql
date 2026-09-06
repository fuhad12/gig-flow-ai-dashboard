-- Cache for LLM-generated niche insights. Keyed by (niche_slug, scraped_at)
-- so that as long as the underlying snapshot in `niche_gigs` is the same, we
-- never pay OpenAI again for the same view.

create table if not exists public.niche_insights (
  niche_slug   text          not null,
  scraped_at   timestamptz   not null,
  insights     jsonb         not null,
  created_at   timestamptz   not null default now(),
  primary key (niche_slug, scraped_at)
);

create index if not exists niche_insights_slug_created_at_idx
  on public.niche_insights (niche_slug, created_at desc);

alter table public.niche_insights enable row level security;

drop policy if exists "niche_insights: signed-in users can read"
  on public.niche_insights;
create policy "niche_insights: signed-in users can read"
  on public.niche_insights
  for select
  to authenticated
  using (true);
