import type { StorageActionWriter } from "convex/server";
import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/**
 * A blob stored as one user's own app upload (convex/fileUploads.ts): what
 * the upload endpoint leaves behind, so `attachments.save` and
 * `commentAttachments.save` accept it from that user. Run inside `t.run`.
 * The endpoint itself is exercised in fileUploads.test.ts.
 */
export async function storeAppUpload(
  ctx: MutationCtx & { storage: StorageActionWriter },
  owner: { orgId: string; userId: Id<"users"> } | { orgId: string; externalId: string },
  body: BlobPart,
): Promise<Id<"_storage">> {
  const userId =
    "userId" in owner
      ? owner.userId
      : (await ctx.db
          .query("users")
          .withIndex("byExternalId", (q) => q.eq("externalId", owner.externalId))
          .unique())!._id;
  const storageId = await ctx.storage.store(new Blob([body]));
  await ctx.db.insert("fileUploads", {
    uploadId: `test_${storageId}`,
    orgId: owner.orgId,
    userId,
    createdAt: Date.now(),
    storageId,
  });
  return storageId;
}
