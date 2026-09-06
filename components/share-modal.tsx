"use client"

/**
 * Modal launched from the auditor header that toggles public sharing for a
 * gig analysis and surfaces the copy-paste URL + a PDF download.
 *
 * Optimistic flow:
 *   - On open, GET /api/share/:id to learn the current state. While loading
 *     we render a skeleton so the toggle isn't misleading.
 *   - User flips the switch → POST /api/share/:id. On success, update local
 *     state with the slug + URL.
 *   - PDF link points at the public URL + `?print=1` so the page auto-opens
 *     the browser's print dialog (which can save to PDF).
 */

import { useEffect, useState } from "react"
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Printer,
  Share2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export interface ShareModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  analysisId: string
  /**
   * If the caller already knows the current public slug (e.g. from the
   * analyze response), pass it through to skip the initial GET round-trip.
   */
  initialPublicSlug?: string | null
  /**
   * Bubble the new slug back up so the parent (auditor view) can update
   * its in-memory copy of the analysis without refetching.
   */
  onChange?: (publicSlug: string | null) => void
}

interface ShareState {
  publicSlug: string | null
  publicUrl: string | null
}

export function ShareModal({
  open,
  onOpenChange,
  analysisId,
  initialPublicSlug,
  onChange,
}: ShareModalProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<ShareState>({
    publicSlug: initialPublicSlug ?? null,
    publicUrl: null,
  })
  const [copied, setCopied] = useState(false)

  // Fetch current state when the modal opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/share/${analysisId}`)
        if (!res.ok) {
          throw new Error(
            ((await res.json().catch(() => null)) as { error?: string } | null)
              ?.error ?? `Request failed (${res.status})`,
          )
        }
        const data = (await res.json()) as ShareState
        if (!cancelled) setState(data)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Something went wrong")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, analysisId])

  const toggle = async (nextPublic: boolean) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/share/${analysisId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public: nextPublic }),
      })
      if (!res.ok) {
        throw new Error(
          ((await res.json().catch(() => null)) as { error?: string } | null)
            ?.error ?? `Request failed (${res.status})`,
        )
      }
      const data = (await res.json()) as ShareState
      setState(data)
      onChange?.(data.publicSlug)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = async () => {
    if (!state.publicUrl) return
    try {
      await navigator.clipboard.writeText(state.publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard API can fail outside secure contexts — ignore quietly.
    }
  }

  const isPublic = state.publicSlug != null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Share2 className="size-4 text-emerald" />
            Share this audit
          </DialogTitle>
          <DialogDescription>
            Get a public link anyone can open — perfect for Reddit threads,
            Discord, or sending to a client. You can revoke access any time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Public toggle */}
          <div className="flex items-center justify-between rounded-md border border-border bg-card/40 p-3">
            <div>
              <div className="text-sm font-medium text-foreground">
                Public link
              </div>
              <div className="text-xs text-muted-foreground">
                {isPublic
                  ? "Anyone with the link can view this audit."
                  : "Only you can see this audit."}
              </div>
            </div>
            {loading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <Switch
                checked={isPublic}
                disabled={saving}
                onCheckedChange={(v) => void toggle(v)}
              />
            )}
          </div>

          {/* URL row, only when public */}
          {isPublic && state.publicUrl && (
            <div className="space-y-1.5">
              <Label htmlFor="share-url" className="text-xs">
                Shareable URL
              </Label>
              <div className="flex gap-2">
                <Input
                  id="share-url"
                  value={state.publicUrl}
                  readOnly
                  className="bg-background"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <>
                      <Check className="size-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-xs"
                  asChild
                >
                  <a
                    href={state.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="size-3.5" />
                    Open in new tab
                  </a>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-xs"
                  asChild
                >
                  <a
                    href={`${state.publicUrl}?print=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Printer className="size-3.5" />
                    Download as PDF
                  </a>
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
