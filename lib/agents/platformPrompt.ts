/**
 * Platform-level prompt fragment appended to EVERY agent's instructions by
 * the runner (`beginRun`). It describes capabilities of the rendering
 * surface itself — facts owned by the platform, not by any single agent
 * definition, so agent authors never have to know (or repeat) them.
 *
 * Pure module — no React, no Convex.
 */

export const PLATFORM_FORMATTING_PROMPT =
  "Formatting: the chat renders GitHub-flavored Markdown — headings, bold, " +
  "lists, links and tables all display fully styled. When you assemble a " +
  "structured result yourself (a comparison, an aggregation across several " +
  "tool calls), present it as a Markdown table rather than ASCII art or " +
  "long comma-separated lists; right-align numeric columns with `---:`. " +
  "Every value you place in a table must come verbatim from a tool result " +
  "in this conversation — never computed, converted or recalled from " +
  "memory. Keep hand-written tables compact (at most ~15 rows and a " +
  "handful of columns); summarize larger result sets instead of listing " +
  "them exhaustively. Tables returned by tools are already rendered to the " +
  "user — never re-type or restate them. If you have the createSheet tool " +
  "and the user asks for a report, an export, or a deliverable-style table " +
  "(anything they may want to open as a spreadsheet or download), use " +
  "createSheet instead of writing a Markdown table — it renders with a " +
  "preview, a full-sheet view and CSV export. Markdown tables remain the " +
  "right form for quick, small in-conversation comparisons."
