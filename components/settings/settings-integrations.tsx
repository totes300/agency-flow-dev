"use client"

/**
 * Integrations settings tab (Phase 9 BYOK).
 *
 * Owns the Anthropic API key lifecycle UI:
 *   - Not configured: explanation + "Add API key" CTA.
 *   - Configured: masked preview, audit metadata, Test / Replace / Remove.
 *
 * Security invariants this UI must respect:
 *   - The plaintext key is only ever in memory during the paste→validate
 *     flow. Once `validateAndSaveKey` returns ok, we clear the field.
 *   - We never render the key anywhere except behind the modal's password
 *     input. After save, only the mask is visible.
 *   - Test / Replace / Remove are all admin-gated server-side; the route
 *     is admin-only, so the UI gate is redundant defense.
 */

import { useState } from "react"
import { useAction, useMutation, useQuery } from "convex/react"
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  KeyIcon,
  Loader2Icon,
  PlugIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
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
import { Skeleton } from "@/components/ui/skeleton"
import { toastError } from "@/lib/toast-helpers"

function IntegrationsSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    </div>
  )
}

export function SettingsIntegrations() {
  const status = useQuery(api.aiIntegration.getStatus, {})
  const [setupOpen, setSetupOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [testPending, setTestPending] = useState(false)

  const testStoredKey = useAction(api.aiIntegration.testStoredKey)
  const removeKey = useMutation(api.aiIntegration.removeKey)

  // Three states from the query:
  //   undefined → still loading
  //   null      → caller isn't admin (defensive — the /settings route is
  //               admin-gated, so this branch should be unreachable in
  //               production, but rendering nothing useful beats crashing)
  //   object    → resolved status
  if (status === undefined) return <IntegrationsSkeleton />
  if (status === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Admin access is required to manage integrations.
      </p>
    )
  }

  async function handleTest() {
    if (testPending) return
    setTestPending(true)
    try {
      const result = await testStoredKey({})
      if (result.ok) {
        toast.success("API key is working.")
      } else {
        toast.error(result.error)
      }
    } catch (err) {
      toastError(err, "Couldn't test the API key")
    } finally {
      setTestPending(false)
    }
  }

  async function handleRemove() {
    try {
      await removeKey({})
      toast.success("API key removed.")
      setRemoveOpen(false)
    } catch (err) {
      toastError(err, "Couldn't remove the API key")
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">AI integration</h2>
        <p className="text-sm text-muted-foreground">
          Worksheet AI summaries use your own API key. Calls bill directly to
          the connected account — we never charge you for AI usage.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Anthropic</h3>
              {status.configured ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900">
                  <CheckCircle2Icon className="size-3" aria-hidden />
                  Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border">
                  <PlugIcon className="size-3" aria-hidden />
                  Not configured
                </span>
              )}
            </div>

            {status.configured ? (
              <div className="flex flex-col gap-1 text-sm">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/80 w-fit">
                  {status.mask ?? "sk-ant-…"}
                </code>
                {status.configuredAt && (
                  <p className="text-xs text-muted-foreground">
                    Set {status.configuredByName ? `by ${status.configuredByName} ` : ""}
                    on {new Date(status.configuredAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect your Anthropic account to enable AI-generated client
                worksheets. Get a key at{" "}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  console.anthropic.com
                  <ExternalLinkIcon className="ml-0.5 inline size-3" aria-hidden />
                </a>
                .
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {status.configured ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={testPending}
                >
                  {testPending ? (
                    <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
                  ) : null}
                  {testPending ? "Testing…" : "Test"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSetupOpen(true)}
                >
                  Replace
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoveOpen(true)}
                  className="text-destructive hover:text-destructive"
                >
                  Remove
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setSetupOpen(true)}>
                <KeyIcon className="size-3.5" aria-hidden />
                Add API key
              </Button>
            )}
          </div>
        </div>
      </div>

      <SetupKeyDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        isReplacing={status.configured}
      />

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Remove Anthropic API key?"
        description="AI-generated worksheet summaries will stop working until a new key is added. Time-entry data and existing worksheets are not affected."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={handleRemove}
      />
    </div>
  )
}

// ─── Setup / replace dialog ────────────────────────────────────────────────

function SetupKeyDialog({
  open,
  onOpenChange,
  isReplacing,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  isReplacing: boolean
}) {
  const validateAndSaveKey = useAction(api.aiIntegration.validateAndSaveKey)
  const [plaintext, setPlaintext] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on open so a stale value from a previous session never leaks back.
  // (We do this via the controlled `open` flip rather than useEffect.)
  function handleOpenChange(next: boolean) {
    if (!next) {
      setPlaintext("")
      setError(null)
      setPending(false)
    }
    onOpenChange(next)
  }

  async function handleSubmit() {
    if (!plaintext.trim() || pending) return
    setPending(true)
    setError(null)
    try {
      const result = await validateAndSaveKey({ plaintext: plaintext.trim() })
      if (result.ok) {
        toast.success(
          isReplacing
            ? "API key replaced and verified."
            : "API key added and verified.",
        )
        handleOpenChange(false)
      } else {
        setError(result.error)
      }
    } catch (err) {
      toastError(err, "Couldn't save the API key")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isReplacing ? "Replace Anthropic API key" : "Add Anthropic API key"}
          </DialogTitle>
          <DialogDescription>
            Paste your key from{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              console.anthropic.com
            </a>
            . We&apos;ll run a tiny test call (~$0.000003) to verify it works
            before saving. The key is encrypted at rest.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <Label htmlFor="anthropic-api-key">API key</Label>
          <Input
            id="anthropic-api-key"
            type="password"
            placeholder="sk-ant-…"
            autoComplete="off"
            value={plaintext}
            onChange={(e) => {
              setPlaintext(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !pending && plaintext.trim()) {
                e.preventDefault()
                void handleSubmit()
              }
            }}
            disabled={pending}
            aria-invalid={error ? true : undefined}
          />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={pending || !plaintext.trim()}
          >
            {pending ? (
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
            ) : null}
            {pending ? "Validating…" : "Validate & save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
