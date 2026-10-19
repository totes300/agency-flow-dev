/**
 * The email-draft block marker (email-triage B6b). The `submitDraft` tool
 * returns `{ block: AGENT_EMAIL_DRAFT_MARKER, draftId, version }`; the
 * conversation renders the draft from the live `emailDrafts` record (B8),
 * never from the message. Client-safe (no Convex imports).
 */
export const AGENT_EMAIL_DRAFT_MARKER = "agency-flow/email-draft@1";
