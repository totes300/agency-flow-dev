"use client"

import type { AgentBlock } from "@/lib/agents/blocks"
import { TextBlock } from "@/components/agents/blocks/text-block"
import { ReasoningBlock } from "@/components/agents/blocks/reasoning-block"
import { ToolCallBlock } from "@/components/agents/blocks/tool-call-block"
import { TableBlock } from "@/components/agents/blocks/table-block"
import { ArtifactBlock } from "@/components/agents/blocks/artifact-block"
import { ProposalBlock } from "@/components/agents/blocks/proposal-block"
import { QuestionBlock } from "@/components/agents/blocks/question-block"
import { EmailDraftBlock } from "@/components/agents/blocks/email-draft-block"
import { EventLineBlock } from "@/components/agents/blocks/event-line-block"
import { TaskCardBlock } from "@/components/agents/blocks/task-card-block"
import { RequestChecklistBlock } from "@/components/agents/blocks/request-checklist-block"

/**
 * The block vocabulary's single dispatch point (PRD renderer contract):
 * every block type has exactly one renderer, shared by all agents.
 * `error`/`system` blocks are run-derived (not message parts) and render
 * directly in the thread timeline.
 *
 * `readOnly` (a non-owner admin viewing a thread in the audit view) makes the
 * interactive blocks — proposals, questions and the email component — inert;
 * every other block is read-only already.
 */
export function BlockRenderer({
  block,
  readOnly = false,
}: {
  block: AgentBlock
  readOnly?: boolean
}) {
  switch (block.kind) {
    case "text":
      return <TextBlock text={block.text} streaming={block.streaming} />
    case "reasoning":
      return <ReasoningBlock text={block.text} streaming={block.streaming} />
    case "tool":
      return (
        <ToolCallBlock
          toolName={block.toolName}
          phase={block.phase}
          input={block.input}
          output={block.output}
          errorText={block.errorText}
        />
      )
    case "table":
      return <TableBlock table={block.table} artifactId={block.artifactId} />
    case "artifact":
      return (
        <ArtifactBlock
          artifactId={block.artifactId}
          name={block.name}
          artifactKind={block.artifactKind}
        />
      )
    case "proposal":
      return (
        <ProposalBlock proposalIds={block.proposalIds} readOnly={readOnly} />
      )
    case "question":
      return <QuestionBlock questionId={block.questionId} readOnly={readOnly} />
    case "emailDraft":
      return <EmailDraftBlock draftId={block.draftId} readOnly={readOnly} />
    case "event":
      return <EventLineBlock text={block.text} />
    case "taskCard":
      return <TaskCardBlock taskId={block.taskId} />
    case "requestChecklist":
      return <RequestChecklistBlock checklistRef={block.ref} />
  }
}
