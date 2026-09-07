# Deploying JobFlow AI

End-to-end runbook for taking the app from clone to a live production URL on
Vercel + Supabase + Stripe. Should take ~30 minutes start to finish if it's
your first time, ~5 the second.

> **TL;DR**
> 1. `cp .env.example .env.local` and fill in the secrets below.
> 2. Run `supabase/setup.sql` in the Supabase SQL editor (one paste, one click).
> 3. Set the same env vars in Vercel project settings.
> 4. Wire the Stripe webhook to `https://YOUR_DOMAIN/api/billing/webhook`.
> 5. Deploy.

---

## 1. Prerequisites

| Service     | Why we need it                                                  |
| ----------- | --------------------------------------------------------------- |
| Supabase    | Auth, Postgres, RLS for `gig_analyses`, `tracked_gigs`, etc.    |
| OpenAI      | gpt-4o (text + vision) for all AI features.                     |
| Firecrawl   | Live scraping of Fiverr gig + search pages.                     |
| Stripe      | Pro subscription billing (skip if you only want the free tier). |
| Vercel      | Hosting + scheduled cron for tracker refreshes.                 |

---

## 2. Supabase setup

### 2.1 Create the project

1. Go to [app.supabase.com](https://app.supabase.com) → **New project**.
2. Region: pick the one closest to your Vercel deploy region.
3. Save the **DB password** — you'll need it if you ever connect via `psql`.

### 2.2 Apply the schema

You have two options:

- **Fast path (recommended for fresh projects)** — open
  `supabase/setup.sql`, copy the whole file, paste it into the
  **SQL editor** in the Supabase dashboard, click **Run**. That single
  file builds every table, index, policy, trigger, and RPC the app needs.
  It's idempotent, so re-running is safe.

- **Incremental path (for existing deployments)** — the per-feature
  migrations live in `supabase/migrations/0001…0012_*.sql`. Run only
  the files numbered higher than your current state, or push with the
  Supabase CLI:

  ```bash
  supabase link --project-ref <YOUR_REF>
  supabase db push
  ```

See `supabase/README.md` for which file to pick and how to verify the
install.

### 2.3 Configure auth

In the Supabase dashboard:

- **Authentication → Providers** → enable **Email** (keep **Confirm email** on for production).
- **Authentication → URL Configuration**:
  - **Site URL**: `https://jobflow.win` (or `http://localhost:3000` in dev).
  - **Redirect URLs** add:
    - `https://jobflow.win/auth/callback`
    - `https://jobflow.win/auth/update-password`
    - (Also keep localhost equivalents for local testing.)
- **Authentication → Email Templates → Confirm signup**: brand as JobFlow.
  Supabase’s default confirmation link (`{{ .ConfirmationURL }}`) is fine —
  it redirects through `/auth/callback` after exchange.

### 2.4 Send auth email via Resend (required for production)

Keep **Supabase** for Auth + DB. Use **Resend** only as the mail sender so
confirm / reset emails say **JobFlow**, not Supabase Auth, and aren’t capped
at ~2 messages/hour.

1. Sign up at [resend.com](https://resend.com) → create an API key.
2. **Domains** → add `jobflow.win` → add the DNS records Resend shows
   (SPF / DKIM) → wait until **Verified**.
3. In Supabase: **Authentication → Emails → SMTP Settings** → enable custom SMTP:

| Field | Value |
| --- | --- |
| Sender email | `noreply@jobflow.win` (must be on the verified domain) |
| Sender name | `JobFlow` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key |

4. Save, then sign up with a real inbox and confirm the From line is JobFlow.

Optional later: store these in Vercel for app notification emails
(`lib/email.ts`): `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`,
`RESEND_REPLY_TO`, `NOTIFY_EMAIL_FROM`. Auth SMTP only needs the API key
pasted into Supabase.

### 2.5 Grab keys

**Settings → API**:

- `NEXT_PUBLIC_SUPABASE_URL` = Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `anon` public key
- `SUPABASE_SERVICE_ROLE_KEY` = `service_role` secret key (server-only,
  **never** expose this to the browser)

---

## 3. OpenAI

1. [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → create a key.
2. Confirm the project has billing enabled and access to `gpt-4o`.
3. Set `OPENAI_API_KEY`.

Budget guide: the average user spends ~$0.10–$0.30/mo of OpenAI credits on
free-tier quotas, ~$1.50–$2.00 on Pro. See the cached `gig_analyses` table —
identical URLs reuse the cached analysis for free.

---

## 4. Scraping (Apify preferred, Firecrawl optional)

### Apify (recommended for launch — free $5/mo)

1. [console.apify.com](https://console.apify.com) → Sign up (no card).
2. Integrations → copy API token → set `APIFY_API_TOKEN`.
3. Optional: set `APIFY_FIVERR_ACTOR_ID` (default `automation-lab~fiverr-scraper`).
4. Test one gig URL in the Actor console before relying on it in production.

When `APIFY_API_TOKEN` is set, JobFlow uses Apify for gig + search scrapes
and skips Firecrawl.

### Firecrawl (optional fallback)

1. [firecrawl.dev](https://firecrawl.dev) → create an account, copy the API key.
2. Set `FIRECRAWL_API_KEY`.
3. Only used when Apify token is **not** set.

Without this key the scraper falls back to mock data (handy for tests, not
useful in production). Free plan gets you ~500 scrapes/month.

---

## 5. Stripe

> Skip section 5 entirely if you're launching free-tier only.

### 5.1 Create products

In the Stripe dashboard you need **four recurring prices** (subscriptions)
and **three one-time prices** (credit top-up packs). Each product can hold
multiple prices, so most teams collapse Monthly + Yearly into a single
"JobFlow Pro" / "JobFlow Agency" product with two prices each.

**Subscriptions** (`Products → Add product`, type = "Recurring"):

| Product | Cadence | Price | Env var |
| --- | --- | --- | --- |
| JobFlow Pro | Monthly | **$12.00** | `STRIPE_PRO_MONTHLY_PRICE_ID` |
| JobFlow Pro | Yearly  | **$108.00** | `STRIPE_PRO_YEARLY_PRICE_ID` |
| JobFlow Agency | Monthly | **$29.99** | `STRIPE_AGENCY_MONTHLY_PRICE_ID` |
| JobFlow Agency | Yearly  | **$269.99** | `STRIPE_AGENCY_YEARLY_PRICE_ID` |

The legacy `STRIPE_MONTHLY_PRICE_ID` / `STRIPE_YEARLY_PRICE_ID` env names
still work as aliases for the Pro tier — only use them when migrating an
existing deployment.

**Credit top-ups** (`Products → Add product`, type = "One-time"):

| Product | Credits | Price | Env var |
| --- | --- | --- | --- |
| JobFlow Credits 5  | 5  | **$3.99**  | `STRIPE_TOPUP_5_PRICE_ID` |
| JobFlow Credits 15 | 15 | **$9.99**  | `STRIPE_TOPUP_15_PRICE_ID` |
| JobFlow Credits 30 | 30 | **$17.99** | `STRIPE_TOPUP_30_PRICE_ID` |

Per-credit pricing: $0.80 (5-pack) → $0.67 (15-pack) → $0.60 (30-pack).
The 30-pack matches the subscription per-credit rate; the 5-pack carries
a modest flexibility premium for impulse spend. The pack credit counts
and amounts live in `lib/stripe-packs.ts` — if you change the Stripe
price amount here, update that file too or the UI will quote a different
number than Stripe actually charges.

Finally, copy your secret key from **Developers → API keys** into
`STRIPE_SECRET_KEY`.

### 5.2 Webhook

Stripe webhooks tell our app when a subscription is created, renewed, or
cancelled. The handler lives at `app/api/billing/webhook/route.ts`.

**Production**:

1. **Developers → Webhooks → Add endpoint**.
2. URL: `https://jobflow.win/api/billing/webhook`.
3. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.

**Local development**:

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```

Use the secret it prints in your `.env.local`.

### 5.3 Customer portal

1. **Settings → Billing → Customer portal** → enable.
2. Allow: cancel subscription, switch plans, update payment method.

---

## 6. Cron — tracker auto-refresh

Vercel Cron Jobs need two things:

1. **`vercel.json`** (already committed at the repo root):
   ```json
   {
     "crons": [{ "path": "/api/tracking/refresh", "schedule": "0 6 * * *" }]
   }
   ```
   This fires a GET to `/api/tracking/refresh` once daily at 06:00 UTC
   (Hobby-compatible; denser schedules need Vercel Pro).
2. **`CRON_SECRET`** env var. Generate one and paste into Vercel:
   ```bash
   openssl rand -base64 32
   ```
   Vercel auto-injects `Authorization: Bearer $CRON_SECRET` on every scheduled
   invocation, and the route rejects anything else.

You can also trigger it manually for testing:

```bash
curl -X GET https://jobflow.win/api/tracking/refresh \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## 7. Vercel deploy

### 7.1 Import the project

1. [vercel.com/new](https://vercel.com/new) → import this repo.
2. Framework: **Next.js** (auto-detected).
3. Build command + output: leave defaults.

### 7.2 Set environment variables

Copy every value from your filled-in `.env.local` into Vercel:

- **Settings → Environment Variables** → add each one to **Production**
  (and Preview / Development if you want).
- Don't forget `NEXT_PUBLIC_SITE_URL` — set it to `https://jobflow.win` in production.

### 7.3 First deploy

Hit **Deploy**. After it goes live:

1. Open the production URL — you should see the marketing landing page.
2. Sign up with a test email → verify in inbox → land on the dashboard.
3. Paste a Fiverr URL into the Analyzer → confirm you see a real analysis.
4. Upgrade with Stripe test card `4242 4242 4242 4242` → confirm the
   Settings page shows "JobFlow Pro".
5. Open the **Tracker** → add a competitor → wait for the daily cron
   (or curl the cron endpoint manually) and confirm a second snapshot lands.

---

## 8. Domain (optional)

1. **Vercel → Domains** → add `jobflow.win` (and `www.jobflow.win` if you use it).
2. Update DNS as instructed.
3. Update `NEXT_PUBLIC_SITE_URL=https://jobflow.win` and the Supabase **Site URL** + **Redirect URLs**
   to use `https://jobflow.win`.
4. Re-create the Stripe webhook endpoint with the new URL (Stripe doesn't
   auto-migrate webhook URLs).

---

## 9. Troubleshooting

| Symptom                                            | Fix                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Setup screen shows on homepage                     | Supabase env vars missing — double-check `NEXT_PUBLIC_SUPABASE_URL` and the anon key.  |
| Stripe portal button errors                        | Customer portal not enabled in Stripe dashboard, or `STRIPE_SECRET_KEY` is missing.    |
| Tracker never updates                              | Cron not firing — verify `CRON_SECRET` matches in both Vercel env and `vercel.json` schedule deployed. |
| Webhook receives events but profile doesn't update | `STRIPE_WEBHOOK_SECRET` mismatch, or Supabase service-role key wrong.                  |
| Analyze returns mock-looking data                  | `FIRECRAWL_API_KEY` missing → scraper fell back to mock.                               |
| `gpt-4o not found`                                 | OpenAI account doesn't have gpt-4o access yet. Top up billing or wait.                 |

---

## 10. Operational notes

- **Cost ceiling**: with the default 5 free / 30 pro quotas, a viral spike of
  10k users costs ~$300/mo OpenAI + ~$80 Firecrawl + ~$25 Vercel. Plenty of
  headroom on the $12/mo plan.
- **Database backups**: Supabase Pro plans include PITR (point-in-time
  recovery). On the free tier, schedule a weekly `pg_dump` via GitHub Actions.
- **Logs**: Vercel function logs are the source of truth for any 5xx. Check
  there before Supabase or Stripe dashboards.
