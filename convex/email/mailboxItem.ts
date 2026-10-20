import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { closeItem, findLiveItem, openItem } from "../agentItems";
import { isEmailTriageEnabled } from "./gate";
import { syncErrorFix, type SyncErrorKind } from "./syncModel";

/**
 * The "Mailbox not syncing · ‹address›" Triage item (B3, §5.2.1): one per
 * connector (I13 — anchor `{ type: "mailbox", id }`), opened after a
 * mailbox has failed to sync for 10 minutes, joined while it keeps failing,
 * closed by the next successful sync or by a disconnect. A mailbox that needs
 * a reconnect never opens one — its connector row shows the Reconnect fix.
 * Its only actions are Reconnect and Resync (no Done / Decline / Merge).
 */

export const MAILBOX_ANCHOR_TYPE = "mailbox";

const anchorOf = (row: Doc<"connectors">) => ({ type: MAILBOX_ANCHOR_TYPE, id: row._id as string });

export async function openMailboxAttention(
  ctx: MutationCtx,
  row: Doc<"connectors">,
  error: { kind: SyncErrorKind; message: string; at: number },
): Promise<void> {
  if (!(await isEmailTriageEnabled(ctx, row.orgId))) return;
  const note = { message: `${error.message} — ${syncErrorFix(error.kind)}`, at: error.at };
  const live = await findLiveItem(ctx, row.orgId, anchorOf(row));
  if (live) {
    // Joined: the same item says the latest reason (no re-sort of the list every minute).
    if (live.decisionNote?.message !== note.message) await ctx.db.patch(live._id, { decisionNote: note });
    return;
  }
  const itemId = await openItem(ctx, { orgId: row.orgId, source: "email", anchor: anchorOf(row), kind: "attention", status: "open" });
  await ctx.db.patch(itemId, { decisionNote: note });
}

export async function closeMailboxAttention(ctx: MutationCtx, row: Doc<"connectors">): Promise<void> {
  const live = await findLiveItem(ctx, row.orgId, anchorOf(row));
  if (live) await closeItem(ctx, live, { outcome: undefined });
}
