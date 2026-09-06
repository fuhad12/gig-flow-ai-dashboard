import { BarChart3, Database, KeyRound, ExternalLink } from "lucide-react"

export function SetupRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-xl">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-emerald text-primary-foreground">
            <BarChart3 className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            JobFlow AI
          </span>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10">
              <Database className="size-4 text-amber-400" />
            </div>
            <h1 className="text-lg font-bold text-foreground">
              Supabase setup required
            </h1>
          </div>

          <p className="mb-4 text-sm text-muted-foreground leading-relaxed">
            Authentication and analysis caching need a Supabase project. Add the
            following to your <code className="rounded bg-secondary px-1 py-0.5 text-xs text-foreground">.env.local</code>{" "}
            and restart the dev server.
          </p>

          <pre className="mb-4 overflow-x-auto rounded-lg border border-border bg-secondary/50 p-4 text-xs leading-relaxed text-foreground">
{`OPENAI_API_KEY=sk-...
FIRECRAWL_API_KEY=fc-...
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...`}
          </pre>

          <ol className="space-y-3 text-sm text-foreground">
            <li className="flex gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald/15 text-[10px] font-bold text-emerald">
                1
              </span>
              <span>
                Create a project at{" "}
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-emerald hover:underline"
                >
                  supabase.com/dashboard
                  <ExternalLink className="size-3" />
                </a>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald/15 text-[10px] font-bold text-emerald">
                2
              </span>
              <span>
                Run the SQL files in{" "}
                <code className="rounded bg-secondary px-1 py-0.5 text-xs">
                  supabase/migrations/
                </code>{" "}
                in order
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald/15 text-[10px] font-bold text-emerald">
                3
              </span>
              <span className="flex items-start gap-2">
                <KeyRound className="mt-0.5 size-3.5 text-muted-foreground" />
                Copy the project URL, anon key, and service-role key from{" "}
                <span className="font-medium">Settings → API</span>
              </span>
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}
