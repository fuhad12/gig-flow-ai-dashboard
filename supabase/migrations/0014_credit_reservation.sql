-- JobFlow AI: atomic credit reservation.
--
-- Closes a TOCTOU race in the generate/analyze/predict routes. Before
-- this RPC, the flow was:
--   1. SELECT count from gig_analyses + gig_generations  (read)
--   2. Call OpenAI / Gemini                              (30-90s)
--   3. INSERT row                                        (write — too late!)
--
-- Concurrent requests, or any failure that prevented step 3 (table
-- missing, RLS misconfig, network blip), let free users walk past the
-- monthly cap. This RPC moves the metering insert to BEFORE the LLM
-- call, inside a per-user advisory lock so two concurrent reservations
-- can never both succeed when only one slot remains.
--
-- The pattern: caller invokes `reserve_credit_slot(uid, kind, limit, meta)`
-- which either returns a uuid (slot reserved — caller proceeds with the
-- LLM, then UPDATEs the row with the real result) or NULL (over budget —
-- caller returns 402). If the LLM call fails, the caller DELETEs the
-- reservation row so the credit isn't charged.
--
-- `meta` carries the row-specific columns:
--   kind = 'analysis'    → meta has `url`, optionally `scraped`/`analysis`
--   kind = 'generation'  → meta has `niche`, optionally `generation`
-- For pre-LLM reservations the optional fields default to '{}'::jsonb so
-- NOT NULL constraints are satisfied.

create or replace function public.reserve_credit_slot(
  uid           uuid,
  kind          text,
  monthly_limit integer,
  meta          jsonb
) returns uuid
language plpgsql
security definer
as $$
declare
  used_count    integer;
  topup_total   integer;
  reservation   uuid;
begin
  -- Serialize concurrent reservations for this single user. The
  -- transaction-scoped lock auto-releases on commit / rollback. Different
  -- users hash to different keys so there's no global bottleneck.
  perform pg_advisory_xact_lock(hashtext('credit_gate:' || uid::text));

  -- Combined monthly consumption across BOTH AI products. Calendar-month
  -- boundary at UTC matches lib/quota.ts.
  select (
      (select count(*) from public.gig_analyses
         where user_id = uid
           and created_at >= date_trunc('month', now() at time zone 'utc'))
      +
      (select count(*) from public.gig_generations
         where user_id = uid
           and created_at >= date_trunc('month', now() at time zone 'utc'))
    ) into used_count;

  -- Unspent topup balance. Topups roll forward across months and survive
  -- subscription cancellation; expired rows (when an expires_at is set)
  -- don't count.
  select coalesce(sum(credits_remaining), 0)
    from public.credit_topups
   where user_id = uid
     and credits_remaining > 0
     and (expires_at is null or expires_at > now())
   into topup_total;

  if used_count >= (monthly_limit + topup_total) then
    return null;
  end if;

  -- Reserve the slot. The placeholder JSON keeps NOT NULL constraints
  -- happy until the caller UPDATEs with the real LLM output.
  if kind = 'analysis' then
    insert into public.gig_analyses (user_id, url, scraped, analysis)
    values (
      uid,
      meta ->> 'url',
      coalesce(meta -> 'scraped',  '{}'::jsonb),
      coalesce(meta -> 'analysis', '{}'::jsonb)
    )
    returning id into reservation;
  elsif kind = 'generation' then
    insert into public.gig_generations (user_id, niche, generation)
    values (
      uid,
      meta ->> 'niche',
      coalesce(meta -> 'generation', '{}'::jsonb)
    )
    returning id into reservation;
  else
    raise exception 'reserve_credit_slot: unknown kind %', kind;
  end if;

  return reservation;
end;
$$;

-- Authenticated users invoke the RPC only via PostgREST from server
-- code that's already authorized them. The function is SECURITY DEFINER
-- so it can touch credit_topups even though that table is normally
-- service-role-only.
revoke all on function public.reserve_credit_slot(uuid, text, integer, jsonb)
  from public;
grant execute on function public.reserve_credit_slot(uuid, text, integer, jsonb)
  to authenticated, service_role;
