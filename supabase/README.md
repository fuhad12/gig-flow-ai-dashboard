# Supabase database setup

## TL;DR — fresh project

Open the Supabase SQL editor, paste in **[`setup.sql`](./setup.sql)**, hit
run. Done. That single file creates every table, index, policy, trigger,
and RPC the app needs.

It's safe to re-run — every statement uses `if not exists` / `drop policy
if exists`, so running `setup.sql` twice on the same database is a no-op.

## Files in this folder

| File | When to use it |
| --- | --- |
| **`setup.sql`** | **Use this.** Single consolidated schema — fresh installs run this once and they're done. |
| `migrations/0001…0012_*.sql` | Numbered incremental migrations. Kept for `supabase db push` workflows and as a per-feature change log. If you've never deployed before, ignore them and just run `setup.sql`. |

## When to use the numbered migrations instead

You only need the per-feature migrations if you're already running an
older copy of the app and you want to apply just the **delta** for a new
feature without re-running the whole schema. In that case, run only the
files numbered higher than your current state.

For everyone else: **`setup.sql` is all you need.**

## Verifying the install

After running `setup.sql`, this query should return 11 tables:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
order by table_name;
```

Expected output:

```
credit_topups
gig_analyses
gig_generations
niche_gigs
niche_insights
notifications
profiles
serp_snapshots
tracked_gig_snapshots
tracked_gigs
tracked_keywords
```

And the helper RPC:

```sql
select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('handle_new_user', 'decrement_oldest_topup');
```
