"use client"
/**
 * The signing secret after Add endpoint / Rotate secret, shown once (W4;
 * mockup frame D). It lives only in this dialog's props: closing it drops
 * it, and no query returns it again.
 */
import { useState } from "react"
import { CheckIcon, ChevronRightIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"

export function WebhookSecretDialog({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
    } catch {
      toast.error("Couldn't copy. Select the secret and copy it by hand.")
    }
  }

  return (
    <Dialog
      open={secret !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false)
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Save your signing secret</DialogTitle>
          <DialogDescription>
            You won&apos;t see it again. Your agent uses it to check that a request came from Agency Flow.
          </DialogDescription>
        </DialogHeader>

        <InputGroup className="bg-muted">
          <InputGroupInput readOnly value={secret ?? ""} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" onClick={handleCopy} aria-label="Copy secret">
              {copied ? <CheckIcon /> : <CopyIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>

        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
            How to verify a delivery
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
            <p>
              Each POST carries <code className="font-mono">X-AgencyFlow-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>.
              Compute HMAC-SHA256 of <code className="font-mono">&lt;t&gt;.&lt;raw body&gt;</code> with this secret and
              compare it to <code className="font-mono">v1</code> in constant time.
            </p>
            <p>
              Reject requests older than 5 minutes, and skip an <code className="font-mono">id</code> you have already
              handled: a retry resends the same id.
            </p>
          </CollapsibleContent>
        </Collapsible>

        <DialogFooter>
          <Button
            onClick={() => {
              setCopied(false)
              onClose()
            }}
          >
            I&apos;ve saved it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
