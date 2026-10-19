"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import {
  AlertTriangleIcon,
  Loader2Icon,
  PlusIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  AGENT_MAX_EXAMPLE_PROMPTS,
  findStaleToolRefs,
  groupToolCatalog,
  type AgentRunPermission,
  type ToolCatalogEntry,
} from "@/lib/agents/builder"
import { extractErrorMessage } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

type SkillOption = {
  _id: Id<"skills">
  name: string
  scope: "global" | "client"
  clientName: string | null
}

export type AgentFormInitial = {
  name: string
  description: string
  instructions: string
  tools: string[]
  skillIds: Id<"skills">[]
  runPermission: AgentRunPermission
  model: string | null
  examplePrompts: string[]
}

const BLANK_INITIAL: AgentFormInitial = {
  name: "",
  description: "",
  instructions: "",
  tools: [],
  skillIds: [],
  runPermission: "everyone",
  model: null,
  examplePrompts: [],
}

/**
 * Full-page create/edit form for an agent (admin-only). Single column inside
 * the workspace layout — not a modal. Initializes once from props via
 * `useState` (the parent keys it per agent so switching targets remounts),
 * never syncing state in an effect. Save validates client-side for instant
 * feedback; the mutation re-validates authoritatively.
 */
export function AgentBuilderForm({
  agentId,
  initial,
  catalog,
  skills,
  onClose,
}: {
  /** Present → editing an existing agent; null → creating a new one. */
  agentId: Id<"agents"> | null
  initial: AgentFormInitial | null
  catalog: ToolCatalogEntry[]
  skills: SkillOption[]
  onClose: (savedId?: Id<"agents">) => void
}) {
  const base = initial ?? BLANK_INITIAL
  const create = useMutation(api.agents.create)
  const update = useMutation(api.agents.update)

  const [name, setName] = useState(base.name)
  const [description, setDescription] = useState(base.description)
  const [instructions, setInstructions] = useState(base.instructions)
  const [tools, setTools] = useState<string[]>(base.tools)
  const [skillIds, setSkillIds] = useState<Id<"skills">[]>(base.skillIds)
  const [runPermission, setRunPermission] = useState<AgentRunPermission>(
    base.runPermission,
  )
  const [model, setModel] = useState(base.model ?? "")
  const [examplePrompts, setExamplePrompts] = useState<string[]>(
    base.examplePrompts,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const groups = groupToolCatalog(catalog)
  // Tool names the agent references that the registry no longer knows — shown
  // as a flagged section so the admin can drop them (US 47 / AC 6).
  const staleTools = findStaleToolRefs(tools, catalog)

  function toggleTool(toolName: string) {
    setTools((prev) =>
      prev.includes(toolName)
        ? prev.filter((t) => t !== toolName)
        : [...prev, toolName],
    )
  }
  function toggleSkill(skillId: Id<"skills">) {
    setSkillIds((prev) =>
      prev.includes(skillId)
        ? prev.filter((s) => s !== skillId)
        : [...prev, skillId],
    )
  }

  function updatePrompt(index: number, value: string) {
    setExamplePrompts((prev) => prev.map((p, i) => (i === index ? value : p)))
  }
  function removePrompt(index: number) {
    setExamplePrompts((prev) => prev.filter((_, i) => i !== index))
  }

  function submit() {
    if (submitting) return
    if (!name.trim()) return setError("Name is required.")
    if (!instructions.trim()) return setError("Instructions are required.")
    setSubmitting(true)
    setError("")
    const payload = {
      name,
      description,
      instructions,
      tools,
      skillIds,
      runPermission,
      model: model.trim() ? model.trim() : undefined,
      examplePrompts,
    }
    const promise = agentId
      ? update({ agentId, ...payload }).then(() => agentId)
      : create(payload)
    void promise
      .then((savedId) => onClose(savedId as Id<"agents">))
      .catch((err) =>
        setError(extractErrorMessage(err, "Couldn't save the agent.")),
      )
      .finally(() => setSubmitting(false))
  }

  const canAddPrompt = examplePrompts.length < AGENT_MAX_EXAMPLE_PROMPTS

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="flex flex-col gap-6">
        {/* Identity */}
        <FormField label="Name" htmlFor="agent-name">
          <Input
            id="agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Client Overview"
            autoFocus
          />
        </FormField>

        <FormField
          label="Description"
          htmlFor="agent-description"
          hint="One line shown in the rail and on the agent's start screen."
        >
          <Input
            id="agent-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this agent is for"
          />
        </FormField>

        <FormField
          label="Instructions"
          htmlFor="agent-instructions"
          hint="The system prompt — who the agent is and the rules it must follow."
        >
          <Textarea
            id="agent-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="You are …"
            rows={8}
          />
        </FormField>

        {/* Run permission */}
        <FormField
          label="Who can run it"
          hint="Admin-only agents don't appear in members' rails at all."
        >
          <div className="inline-flex rounded-lg border p-0.5">
            <PermissionSegment
              active={runPermission === "everyone"}
              onClick={() => setRunPermission("everyone")}
            >
              Everyone
            </PermissionSegment>
            <PermissionSegment
              active={runPermission === "admins"}
              onClick={() => setRunPermission("admins")}
            >
              Admins only
            </PermissionSegment>
          </div>
        </FormField>

        {/* Tools */}
        <FormField
          label="Tools"
          hint="The vetted actions this agent may take. Admin-only tools stay unavailable to members even if checked."
        >
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.scope}>
                <p className="text-xs font-medium text-muted-foreground">
                  {group.label}
                </p>
                <p className="mb-2 text-xs text-muted-foreground/70">
                  {group.description}
                </p>
                <div className="flex flex-col gap-1.5">
                  {group.tools.map((tool) => (
                    <label
                      key={tool.name}
                      className="flex cursor-pointer items-start gap-3 rounded-md border p-2.5 text-sm hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={tools.includes(tool.name)}
                        onCheckedChange={() => toggleTool(tool.name)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{tool.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {tool.scope === "admin" ? "admin" : "member"}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {tool.humanDescription}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {staleTools.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-500">
                  <AlertTriangleIcon className="size-3.5" />
                  Unavailable tools
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  These were renamed or removed in code. They&apos;re skipped
                  at runtime — remove them to clean up this agent.
                </p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {staleTools.map((toolName) => (
                    <div
                      key={toolName}
                      className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-background px-2.5 py-1.5 text-sm"
                    >
                      <span className="font-medium">{toolName}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6 text-muted-foreground hover:text-destructive"
                        onClick={() => toggleTool(toolName)}
                        title="Remove tool reference"
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </FormField>

        {/* Skills */}
        <FormField
          label="Skills"
          hint="Plain-English SOPs that steer judgment. They never change how a number is computed."
        >
          {skills.length === 0 ? (
            <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              <SparklesIcon className="size-4" />
              No skills yet — create them in the Skills area.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {skills.map((skill) => (
                <label
                  key={skill._id}
                  className="flex cursor-pointer items-center gap-3 rounded-md border p-2.5 text-sm hover:bg-muted/40"
                >
                  <Checkbox
                    checked={skillIds.includes(skill._id)}
                    onCheckedChange={() => toggleSkill(skill._id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{skill.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {skill.scope === "global"
                        ? "Global"
                        : `Client · ${skill.clientName ?? "Unknown"}`}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </FormField>

        {/* Example prompts */}
        <FormField
          label="Example prompts"
          hint="Clickable chips on the agent's start screen. Optional."
        >
          <div className="flex flex-col gap-2">
            {examplePrompts.map((prompt, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={prompt}
                  onChange={(e) => updatePrompt(i, e.target.value)}
                  placeholder="e.g. List our active projects"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removePrompt(i)}
                  title="Remove prompt"
                >
                  <XIcon className="size-4" />
                </Button>
              </div>
            ))}
            {canAddPrompt && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start text-muted-foreground"
                onClick={() => setExamplePrompts((prev) => [...prev, ""])}
              >
                <PlusIcon className="size-4" />
                Add example
              </Button>
            )}
          </div>
        </FormField>

        {/* Model override */}
        <FormField
          label="Model override"
          htmlFor="agent-model"
          hint="Advanced — leave blank to use the platform default. Accepts a gateway model slug."
        >
          <Input
            id="agent-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Default"
          />
        </FormField>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="mt-8 flex items-center justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={() => onClose()} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting && <Loader2Icon className="size-4 animate-spin" />}
          {agentId ? "Save changes" : "Create agent"}
        </Button>
      </div>
    </div>
  )
}

function FormField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint && (
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
      {children}
    </div>
  )
}

function PermissionSegment({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md px-3 py-1 text-sm transition-colors",
        active
          ? "bg-background font-medium text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
