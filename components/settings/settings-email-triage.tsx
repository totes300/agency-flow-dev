"use client"

import { useState } from "react"
import { useConvexAuth, useMutation, useQuery } from "convex/react"
import { XIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { EmailTriageSettings } from "@/convex/email/settings"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toastError } from "@/lib/toast-helpers"

const NO_ACTOR = "none"

/**
 * Settings › General › "Email triage" (docs/prd-email-triage.md §7.6,
 * implementation plan §6 E2; B8b) — admins of an org with email triage only
 * (`email/settings.get` answers null otherwise, and the group stays hidden):
 * the default due date of email tasks (working days), the ignored sender
 * domains, and the agent actor — the admin automatic email work runs as.
 * Each control saves on its own.
 */
export function SettingsEmailTriage() {
  const { isAuthenticated } = useConvexAuth()
  const settings = useQuery(api.email.settings.get, isAuthenticated ? {} : "skip")
  if (!settings) return null
  return (
    <div className="border-t pt-8">
      {/* Re-seed the local number field when the saved value changes elsewhere. */}
      <EmailTriageForm key={settings.defaultDueWorkingDays} settings={settings} />
    </div>
  )
}

export function EmailTriageForm({ settings }: { settings: EmailTriageSettings }) {
  const update = useMutation(api.email.settings.update)
  const setAgentActor = useMutation(api.email.settings.setAgentActor)

  const [days, setDays] = useState(String(settings.defaultDueWorkingDays))
  // A saved actor who was demoted since: shown by name, flagged, never picked again.
  const staleActor = settings.agentActor && !settings.agentActor.isAdmin ? settings.agentActor : null
  const [domain, setDomain] = useState("")
  const [saved, setSaved] = useState<string | null>(null)

  const flash = (text: string) => {
    setSaved(text)
    setTimeout(() => setSaved((cur) => (cur === text ? null : cur)), 2000)
  }

  const saveDays = () => {
    const value = Number(days)
    if (days.trim() === "" || value === settings.defaultDueWorkingDays) return
    void update({ defaultDueWorkingDays: value })
      .then(() => flash("Default due date saved"))
      .catch((err) => {
        setDays(String(settings.defaultDueWorkingDays))
        toastError(err, "Couldn't save the default due date")
      })
  }

  const saveDomains = (next: string[], message: string) =>
    update({ ignoredDomains: next })
      .then(() => flash(message))
      .catch((err) => {
        toastError(err, "Couldn't save the ignored domains")
        throw err
      })

  const addDomain = () => {
    const value = domain.trim()
    if (!value) return
    void saveDomains([...settings.ignoredDomains, value], "Domain added")
      .then(() => setDomain(""))
      .catch(() => {})
  }

  const onActor = (value: string) => {
    void setAgentActor({ userId: value === NO_ACTOR ? null : (value as Id<"users">) })
      .then(() => flash("Agent actor saved"))
      .catch((err) => toastError(err, "Couldn't set the agent actor"))
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-sm font-semibold">Email triage</h2>
        <p className="text-[13px] text-muted-foreground">How tasks from client emails are prepared.</p>
      </div>

      <FieldGroup className="gap-6">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="email-triage-due">Default due date</FieldLabel>
            <FieldDescription>When the email names no date — counted in working days.</FieldDescription>
          </FieldContent>
          <div className="flex items-center gap-2">
            <Input
              id="email-triage-due"
              type="number"
              inputMode="numeric"
              min={0}
              max={30}
              step={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              onBlur={saveDays}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
              }}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">working days</span>
          </div>
        </Field>

        <Field>
          <FieldLabel htmlFor="email-triage-domain">Ignored sender domains</FieldLabel>
          <FieldDescription>Email from these domains never reaches Triage (newsletters, tools, your own domain).</FieldDescription>
          {settings.ignoredDomains.length > 0 && (
            <ul aria-label="Ignored sender domains" className="flex max-w-md flex-col">
              {settings.ignoredDomains.map((d) => (
                <li key={d} className="flex h-9 items-center gap-2 border-b border-border/60 text-sm">
                  <span className="min-w-0 flex-1 truncate">{d}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${d}`}
                    className="text-muted-foreground"
                    onClick={() =>
                      void saveDomains(
                        settings.ignoredDomains.filter((x) => x !== d),
                        "Domain removed",
                      ).catch(() => {})
                    }
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex max-w-md items-center gap-2">
            <Input
              id="email-triage-domain"
              value={domain}
              placeholder="newsletter.example.com"
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addDomain()
                }
              }}
            />
            <Button variant="outline" onClick={addDomain} disabled={!domain.trim()}>
              Add
            </Button>
          </div>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="email-triage-actor">Agent actor</FieldLabel>
            <FieldDescription>Automatic email work runs as this admin.</FieldDescription>
          </FieldContent>
          <div className="flex flex-col items-end gap-1">
            <Select value={settings.agentActorUserId ?? NO_ACTOR} onValueChange={onActor}>
              <SelectTrigger id="email-triage-actor" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={NO_ACTOR}>Not set</SelectItem>
                  {staleActor && (
                    <SelectItem value={staleActor._id} disabled>
                      {staleActor.name} (no longer an admin)
                    </SelectItem>
                  )}
                  {settings.admins.map((a) => (
                    <SelectItem key={a._id} value={a._id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {(staleActor || !settings.agentActor) && (
              <span className="text-xs text-warning">
                {staleActor ? "Automatic email work is paused — pick a current admin." : "Nothing runs automatically until you pick one."}
              </span>
            )}
          </div>
        </Field>
      </FieldGroup>

      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {saved}
      </p>
    </div>
  )
}
