-- ---------- Activity feed / notifications ----------
-- One row per user-visible event. Generated server-side after a tracker
-- refresh detects a meaningful diff (price change, title rewrite, rank
-- shift, etc.). The bell UI renders these unread-first.
--
-- Inserts always come from the service role (cron + manual refresh), so
-- we only need RLS for select/update by the owner.

create extension if not exists "pgcrypto";

create table if not exists public.notifications (
  id           uuid          primary key default gen_random_uuid(),
  user_id      uuid          not null references auth.users(id) on delete cascade,
  -- Free-form discriminator so the UI can choose the right icon / route.
  --   "tracker.price_change"   payload: { trackedGigId, gigTitle, oldPrice, newPrice, direction: "up"|"down" }
  --   "tracker.title_change"   payload: { trackedGigId, gigTitle, oldTitle, newTitle }
  --   "tracker.thumbnail_change" payload: { trackedGigId, gigTitle }
  --   "rank.up"                payload: { trackedGigId, gigTitle, keyword, oldPosition, newPosition }
  --   "rank.down"              payload: { trackedGigId, gigTitle, keyword, oldPosition, newPosition }
  --   "rank.appeared"          payload: { trackedGigId, gigTitle, keyword, newPosition }
  --   "rank.lost"              payload: { trackedGigId, gigTitle, keyword, oldPosition }
  kind         text          not null,
  title        text          not null,
  body         text          not null,
  payload      jsonb         not null default '{}'::jsonb,
  created_at   timestamptz   not null default now(),
  read_at      timestamptz
);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

create index if not exists notifications_user_recent_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications: users select own"
  on public.notifications;
create policy "notifications: users select own"
  on public.notifications
  for select
  using (auth.uid() = user_id);

-- Users may mark their own notifications read (`update read_at`).
drop policy if exists "notifications: users update own"
  on public.notifications;
create policy "notifications: users update own"
  on public.notifications
  for update
  using (auth.uid() = user_id);

drop policy if exists "notifications: users delete own"
  on public.notifications;
create policy "notifications: users delete own"
  on public.notifications
  for delete
  using (auth.uid() = user_id);

-- Inserts go through the service role; no insert policy.
