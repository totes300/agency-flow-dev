import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { WebhookEvent } from "@clerk/backend";
import { Webhook } from "svix";

const http = httpRouter();

http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const event = await validateRequest(request);
    if (!event) {
      return new Response("Invalid webhook signature", { status: 400 });
    }

    switch (event.type) {
      case "user.created":
      case "user.updated":
        await ctx.runMutation(internal.users.upsertFromClerk, {
          data: event.data,
        });
        break;
      case "user.deleted": {
        const clerkUserId = event.data.id;
        if (clerkUserId) {
          await ctx.runMutation(internal.users.deleteFromClerk, {
            clerkUserId,
          });
        }
        break;
      }
      case "organizationMembership.created":
      case "organizationMembership.updated": {
        const memberData = event.data;
        const memberClerkUserId = memberData.public_user_data?.user_id;
        const memberOrgId = memberData.organization?.id;
        if (!memberClerkUserId || !memberOrgId) {
          console.error("Malformed organizationMembership webhook payload", { type: event.type });
          return new Response("Missing membership identifiers", { status: 400 });
        }
        const pubData = memberData.public_user_data;
        await ctx.runMutation(internal.orgMembers.upsertMembership, {
          orgId: memberOrgId,
          clerkUserId: memberClerkUserId,
          role: memberData.role ?? "org:member",
          userData: pubData ? {
            firstName: pubData.first_name ?? undefined,
            lastName: pubData.last_name ?? undefined,
            imageUrl: pubData.image_url ?? undefined,
            identifier: pubData.identifier ?? undefined,
          } : undefined,
        });
        break;
      }
      case "organizationMembership.deleted": {
        const deletedData = event.data;
        const deletedClerkUserId = deletedData.public_user_data?.user_id;
        const deletedOrgId = deletedData.organization?.id;
        if (!deletedClerkUserId || !deletedOrgId) {
          console.error("Malformed organizationMembership.deleted webhook payload", { type: event.type });
          return new Response("Missing membership identifiers", { status: 400 });
        }
        await ctx.runMutation(internal.orgMembers.deleteMembership, {
          orgId: deletedOrgId,
          clerkUserId: deletedClerkUserId,
        });
        break;
      }
    }

    return new Response(null, { status: 200 });
  }),
});

async function validateRequest(
  req: Request
): Promise<WebhookEvent | null> {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("Missing CLERK_WEBHOOK_SECRET environment variable");
    return null;
  }

  const payloadString = await req.text();
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.error("Missing svix headers");
    return null;
  }

  const wh = new Webhook(secret);
  try {
    return wh.verify(payloadString, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as unknown as WebhookEvent;
  } catch (error) {
    console.error("Webhook verification failed:", error);
    return null;
  }
}

export default http;
