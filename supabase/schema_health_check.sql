-- =============================================================================
-- JobFlow AI — Schema health check (entire platform)
-- Paste into Supabase SQL editor. Every row should show ok = true.
-- =============================================================================

with expected_tables(name) as (
  values
    ('profiles'),
    ('gig_analyses'),
    ('gig_generations'),
    ('niche_gigs'),
    ('niche_insights'),
    ('tracked_gigs'),
    ('tracked_gig_snapshots'),
    ('tracked_keywords'),
    ('serp_snapshots'),
    ('notifications'),
    ('credit_topups'),
    ('influencers'),
    ('referral_commissions'),
    ('trend_scrapes')
),
expected_columns(table_name, column_name) as (
  values
    ('profiles', 'email'),
    ('profiles', 'stripe_customer_id'),
    ('profiles', 'subscription_status'),
    ('profiles', 'subscription_tier'),
    ('profiles', 'selected_niches'),
    ('profiles', 'skill_tags'),
    ('profiles', 'onboarded_at'),
    ('profiles', 'referred_by_influencer_id'),
    ('gig_analyses', 'user_id'),
    ('gig_analyses', 'public_slug'),
    ('gig_generations', 'user_id'),
    ('credit_topups', 'credits_remaining'),
    ('influencers', 'code'),
    ('influencers', 'commission_pct'),
    ('referral_commissions', 'stripe_invoice_id')
),
expected_functions(name) as (
  values
    ('handle_new_user'),
    ('decrement_oldest_topup'),
    ('reserve_credit_slot')
)
select
  'table:' || t.name as object,
  (to_regclass('public.' || t.name) is not null) as ok
from expected_tables t

union all

select
  'column:' || c.table_name || '.' || c.column_name,
  exists (
    select 1
    from information_schema.columns ic
    where ic.table_schema = 'public'
      and ic.table_name = c.table_name
      and ic.column_name = c.column_name
  )
from expected_columns c

union all

select
  'function:' || f.name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = f.name
  )
from expected_functions f

order by object;
