import { v, ConvexError } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { CONNECTOR_CATALOG } from "../lib/agents/connectors";
import { requireEmailTriageEnabled, setEmailTriageFlag } from "./email/gate";
import { normalizeSubject, stripQuoted, type EmailAddress } from "./email/model";
import { ORG_TIMEZONE_FALLBACK } from "./lib/timer";
import { addCalendarDays, localDateOf, weekdayOf, zonedDateTimeToInstant } from "./lib/workingDays";
import { isClosedCategory } from "./tasks/model";

/**
 * DEV-ONLY email-triage seed (docs/prd-email-triage.md §9 B2). Loads the
 * canvas scenarios into one org so Triage can be built and demoed before
 * Gmail is connected (implementation plan: B2 → B4 → … → B1 → B3):
 *
 *   - turns `orgSettings.emailTriageEnabled` on (D23);
 *   - one SEED mailbox: a `connectors` row of type `gmail`, `devSeed: true`,
 *     status `revoked`, no credentials — never connected to Google, so sync
 *     and send must skip it;
 *   - five conversations (`emailThreads` + `emailMessages`, the new client
 *     messages at stage `received`, bodies with quoted history stripped by
 *     `email/model.stripQuoted`, the full text kept in `bodyHtml`):
 *       Kovács Réka (Pragmatico) — Black Friday, 5 requests, Friday 15:12, a PDF
 *       Nagy Gábor  (Pragmatico) — "élesben hibás" price bug, urgent
 *       Szabó Péter (Arlo)       — "mikorra lesz kész?" on a thread linked to a task
 *       Molnár Judit (unknown)   — a new sender from an unknown domain
 *       Kiss Anna   (Arlo)       — a pure thank-you
 *   - NO Triage items, ledger rows or Inbox rows: since B4 the inbound
 *     pipeline (email/pipeline.ts) owns them. `process` runs it on the seeded
 *     `received` messages, so the canvas outcomes come from the real code:
 *       Réka  → `request` item, 5 ledger rows (sizes, 20% verbatim)
 *       Gábor → `request` item, urgent
 *       Péter → `question` item on the linked task
 *       Judit → `new_sender` item (screenSender)
 *       Anna  → Inbox `email_event` · `no_action`, no item (deterministic
 *               acknowledge — no model call)
 *
 * Uses the org's existing clients (Pragmatico, Arlo — matched by EXACT name,
 * see SEED_CLIENTS / the `clientNames` arg; created when missing) and adds
 * their email domain + the sender contacts when missing. Péter's thread links to the latest open top-level
 * task of an Arlo project, when there is one.
 *
 * Idempotent: every row has a deterministic provider id (`seed-…`) and is
 * looked up before insert. `reset` deletes ONLY the seed mailbox and the
 * email rows hanging off it (threads, messages, thread↔task links, agent
 * items, requests, promises, email Inbox rows); clients, contacts, domains
 * and the feature flag stay.
 *
 * Run:   npx convex run devSeedEmail:seed '{}'                (single-org deployment)
 *        npx convex run devSeedEmail:seed '{"orgId":"org_…"}'
 *        npx convex run devSeedEmail:seed '{"orgId":"org_…","clientNames":{"arlo":"Arlow Kft."}}'
 * Then:  npx convex run devSeedEmail:process '{"fakeModel":true}'   (canned outputs, no AI credit)
 *        npx convex run devSeedEmail:process '{}'                   (the real model — needs the org's AI key)
 * Reset: npx convex run devSeedEmail:reset '{"orgId":"org_…"}'
 *
 * Reads whole-org tables on purpose (bounded): a dummy-data dev tool.
 */

const SEED_PREFIX = "seed-";
const SEED_MAILBOX_MASK = "Seed mailbox · not connected to Google";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const READ_CAP = 500;

// ─── Content ────────────────────────────────────────────────────────────────

type SeedClientKey = "pragmatico" | "arlo";

/**
 * The seeded clients. An org client is adopted only on an EXACT
 * (case-insensitive, trimmed) name match against `names` — or against the
 * name passed in `clientNames` — never a substring ("Pragmatico Holding" is
 * left alone). Only adopted or created clients get the domain + contacts.
 */
const SEED_CLIENTS: Record<SeedClientKey, { names: readonly string[]; name: string; domain: string }> = {
  pragmatico: { names: ["Pragmatico", "Pragmatico Kft."], name: "Pragmatico", domain: "pragmatico.hu" },
  arlo: { names: ["Arlo", "Arlow"], name: "Arlo", domain: "arlo.hu" },
};

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const PEOPLE = {
  reka: { name: "Kovács Réka", email: "reka@pragmatico.hu", client: "pragmatico" as const, primary: true },
  gabor: { name: "Nagy Gábor", email: "gabor@pragmatico.hu", client: "pragmatico" as const, primary: false },
  peter: { name: "Szabó Péter", email: "peter@arlo.hu", client: "arlo" as const, primary: true },
  anna: { name: "Kiss Anna", email: "anna@arlo.hu", client: "arlo" as const, primary: false },
  judit: { name: "Molnár Judit", email: "judit@zoldkert.hu", client: null, primary: false },
};
type PersonKey = keyof typeof PEOPLE;

type SeedMessage = {
  key: string;
  direction: "inbound" | "outbound";
  /** Inbound: the client; outbound: the mailbox owner. */
  person: PersonKey | "us";
  to: Array<PersonKey | "us">;
  cc?: Array<PersonKey | "us">;
  subject: string;
  /** The full plain-text body as it arrived (quoted history included). */
  raw: string;
  at: (ctx: SeedClock) => number;
  attachments?: Array<{ name: string; mime: string; size: number }>;
  /** History before the scenario message has already been handled. */
  stage: "received" | "handled";
};

type SeedThread = {
  key: string;
  client: SeedClientKey | null;
  contact: PersonKey | null;
  subject: (task: Doc<"tasks"> | null) => string;
  messages: (subject: string) => SeedMessage[];
  linkTask?: boolean;
};

type SeedClock = { now: number; lastFriday1512: number; tz: string };

const REKA_BODY = `Sziasztok!

Jövő szerdáig kellene a Black Friday kampányhoz pár dolog:

1. Bannerek két méretben: 1200×628 és 1080×1920.
2. A 20% kedvezmény csak a webshopra vonatkozik, az üzletekre nem – ezt kérnénk a bannereken is jelezni.
3. A landing oldalra kellene egy visszaszámláló, ami péntek éjfélig fut.
4. Egy hírlevél a meglévő feliratkozóknak, a bannerek vizuáljával.
5. És még egy story méret is kellene az Instagramra.

Csatoltam a brand színeket PDF-ben.

Köszi előre is!

Üdvözlettel,
Kovács Réka
Marketing manager | Pragmatico Kft.
+36 30 123 4567

2026. okt. 9., P 11:20 dátummal Tóth Ádám <office@agency.test> ezt írta:
> Szia Réka!
> Ha megvan a Black Friday briefje, küldd nyugodtan, már készülünk rá.
> Ádám`;

const GABOR_BODY = `Szia Ádám!

Élesben hibás az ár a Téli kabát termékoldalon: 89 990 Ft helyett 8 999 Ft jelenik meg, és a kosárba is így kerül be. Már jött két rendelés ezen az áron.

Kérlek nézzétek meg minél előbb, addig kivettük a terméket a kampányból.

https://pragmatico.hu/termek/teli-kabat

Gábor

Küldve az iPhone-omról`;

const PETER_FIRST = `Sziasztok!

Kérnénk egy új aloldalt az őszi kampányhoz, a múltkori landing mintájára. A szövegeket a jövő héten küldöm.

Köszi,
Péter`;

const PETER_REPLY_FROM_US = `Szia Péter!

Köszi, elkezdtük. A jövő hét közepére megvan az első verzió, addig várjuk a szövegeket.

Ádám`;

const PETER_QUESTION = (sentAt: string) => `Szia Ádám!

Mikorra lesz kész? A jövő heti kampányindításhoz kellene tudnunk.

Köszi,
Péter

${sentAt} Tóth Ádám <office@agency.test> ezt írta:
> Szia Péter!
>
> Köszi, elkezdtük. A jövő hét közepére megvan az első verzió, addig várjuk a szövegeket.
>
> Ádám`;

const JUDIT_BODY = `Kedves Ügynökség!

Molnár Judit vagyok, a Zöldkert Kft. marketingeseként keresem Önöket. Ajánlást kaptunk a Pragmatico-tól: egy kisebb webshop arculatfrissítést és havi hírlevelet szeretnénk kiszervezni.

Tudnának egy rövid egyeztetést javasolni jövő hétre? Szívesen küldök briefet is.

Üdvözlettel,
Molnár Judit
Zöldkert Kft.
+36 20 555 0101`;

const ANNA_DELIVERY_FROM_US = `Szia Anna!

Csatolom a szeptemberi riportot, a legfontosabb számokat az első oldalon összefoglaltuk.

Ádám`;

const ANNA_THANKS = `Köszönöm szépen! 🙏

Anna

On Mon, Oct 12, 2026 at 9:41 AM Tóth Ádám <office@agency.test> wrote:
> Szia Anna!
>
> Csatolom a szeptemberi riportot, a legfontosabb számokat az első oldalon összefoglaltuk.
>
> Ádám`;

const THREADS: readonly SeedThread[] = [
  {
    key: "reka-black-friday",
    client: "pragmatico",
    contact: "reka",
    subject: () => "Re: Black Friday kampány – anyagok",
    messages: (subject) => [
      {
        key: "reka-black-friday-1",
        direction: "inbound",
        person: "reka",
        to: ["us"],
        cc: ["gabor"],
        subject,
        raw: REKA_BODY,
        at: (c) => c.lastFriday1512,
        attachments: [{ name: "brand-szinek.pdf", mime: "application/pdf", size: 248_312 }],
        stage: "received",
      },
    ],
  },
  {
    key: "gabor-price-bug",
    client: "pragmatico",
    contact: "gabor",
    subject: () => "SÜRGŐS: rossz ár a webshopban",
    messages: (subject) => [
      {
        key: "gabor-price-bug-1",
        direction: "inbound",
        person: "gabor",
        to: ["us"],
        subject,
        raw: GABOR_BODY,
        at: (c) => c.now - 35 * MINUTE,
        stage: "received",
      },
    ],
  },
  {
    key: "peter-question",
    client: "arlo",
    contact: "peter",
    linkTask: true,
    subject: (task) => (task ? `Re: ${task.title}` : "Re: Őszi kampány aloldal"),
    messages: (subject) => [
      {
        key: "peter-question-1",
        direction: "inbound",
        person: "peter",
        to: ["us"],
        subject: normalizeSubject(subject),
        raw: PETER_FIRST,
        at: (c) => c.now - 9 * DAY,
        stage: "handled",
      },
      {
        key: "peter-question-2",
        direction: "outbound",
        person: "us",
        to: ["peter"],
        subject,
        raw: PETER_REPLY_FROM_US,
        at: (c) => c.now - 8 * DAY,
        stage: "handled",
      },
      {
        key: "peter-question-3",
        direction: "inbound",
        person: "peter",
        to: ["us"],
        subject,
        raw: PETER_QUESTION("2026. okt. 11., V 10:04 dátummal"),
        at: (c) => c.now - 3 * HOUR,
        stage: "received",
      },
    ],
  },
  {
    key: "judit-new-sender",
    client: null,
    contact: null,
    subject: () => "Bemutatkozás – webshop arculat és hírlevél",
    messages: (subject) => [
      {
        key: "judit-new-sender-1",
        direction: "inbound",
        person: "judit",
        to: ["us"],
        subject,
        raw: JUDIT_BODY,
        at: (c) => c.now - 2 * HOUR,
        stage: "received",
      },
    ],
  },
  {
    key: "anna-thanks",
    client: "arlo",
    contact: "anna",
    subject: () => "Re: Szeptemberi riport",
    messages: (subject) => [
      {
        key: "anna-thanks-1",
        direction: "outbound",
        person: "us",
        to: ["anna"],
        subject: normalizeSubject(subject),
        raw: ANNA_DELIVERY_FROM_US,
        at: (c) => c.now - 1 * DAY,
        stage: "handled",
      },
      {
        key: "anna-thanks-2",
        direction: "inbound",
        person: "anna",
        to: ["us"],
        subject,
        raw: ANNA_THANKS,
        at: (c) => c.now - 25 * MINUTE,
        stage: "received",
      },
    ],
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** The given org, else the deployment's only org (dev tools). */
async function resolveOrgId(ctx: MutationCtx, orgId: string | undefined): Promise<string> {
  if (orgId) return orgId;
  const settings = await ctx.db.query("orgSettings").take(READ_CAP);
  const orgIds = Array.from(new Set(settings.map((s) => s.orgId)));
  if (orgIds.length === 0) {
    throw new ConvexError("No org found in orgSettings. Sign into the app once so an org is created.");
  }
  if (orgIds.length > 1) {
    throw new ConvexError(
      `Multiple orgs in this deployment — pass {"orgId":"..."} explicitly. Candidates: ${orgIds.join(", ")}`,
    );
  }
  return orgIds[0];
}

/** The seed mailbox's owner: the designated agent actor, else the first admin. */
async function resolveMailboxOwner(
  ctx: MutationCtx,
  orgId: string,
  settings: Doc<"orgSettings">,
): Promise<Doc<"users">> {
  const members = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(READ_CAP);
  const adminIds = members.filter((m) => m.role === "admin" && m.userId).map((m) => m.userId!);
  const preferred = settings.agentActorUserId && adminIds.includes(settings.agentActorUserId)
    ? settings.agentActorUserId
    : adminIds[0];
  const user = preferred ? await ctx.db.get(preferred) : null;
  if (!user || user.deletedAt) throw new ConvexError(`No admin in ${orgId} to own the seed mailbox.`);
  return user;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The full body for the Gmail-style view (sanitised again on render). */
function toSimpleHtml(raw: string): string {
  return `<div>${escapeHtml(raw).replace(/\n/g, "<br>")}</div>`;
}

/** The most recent Friday 15:12 (org time) before `now` — Réka's email. */
function lastFriday1512(now: number, tz: string): number {
  let date = localDateOf(now, tz);
  for (let i = 0; i < 8; i++) {
    if (weekdayOf(date) === 5) {
      const at = zonedDateTimeToInstant(date, 15, 12, tz);
      if (at < now) return at;
    }
    date = addCalendarDays(date, -1);
  }
  return now - 3 * DAY;
}

async function findSeedMailbox(ctx: MutationCtx, orgId: string): Promise<Doc<"connectors">[]> {
  const rows = await ctx.db
    .query("connectors")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(READ_CAP);
  return rows.filter((r) => r.devSeed === true);
}

// ─── seed ───────────────────────────────────────────────────────────────────

export type EmailSeedResult = {
  orgId: string;
  mailboxId: Id<"connectors">;
  clientsCreated: string[];
  contactsCreated: string[];
  threadsCreated: number;
  messagesCreated: number;
  linkedTaskId: Id<"tasks"> | null;
};

export const seed = internalMutation({
  args: {
    orgId: v.optional(v.string()),
    // Exact names of the org's Pragmatico / Arlo clients, when they differ
    // from the defaults in SEED_CLIENTS.
    clientNames: v.optional(v.object({ pragmatico: v.optional(v.string()), arlo: v.optional(v.string()) })),
  },
  handler: async (ctx, args): Promise<EmailSeedResult> => {
    const orgId = await resolveOrgId(ctx, args.orgId);
    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .first();
    if (!settings) throw new ConvexError(`No orgSettings row for ${orgId}.`);
    const tz = settings.timezone || ORG_TIMEZONE_FALLBACK;
    const now = Date.now();

    // 1. The feature (D23) — everything below is behind it (I14).
    await setEmailTriageFlag(ctx, orgId, true);
    await requireEmailTriageEnabled(ctx, orgId);

    // 2. The seed mailbox.
    const owner = await resolveMailboxOwner(ctx, orgId, settings);
    let mailbox = (await findSeedMailbox(ctx, orgId))[0] ?? null;
    if (!mailbox) {
      const existing = await ctx.db
        .query("connectors")
        .withIndex("by_orgId_userId_type", (q) => q.eq("orgId", orgId).eq("userId", owner._id).eq("type", "gmail"))
        .unique();
      if (existing) {
        throw new ConvexError(
          `${owner.name} already has a real Gmail connection — the seed never writes into a real mailbox.`,
        );
      }
      // A real connect for this (org, user, gmail) is refused while this row
      // exists (connectors.ts assertNoDevSeedConnection; TODO(B1): the OAuth
      // callback too), so the demo mailbox is never adopted.
      const mailboxId = await ctx.db.insert("connectors", {
        orgId,
        userId: owner._id,
        type: "gmail",
        status: "revoked",
        credentialMask: SEED_MAILBOX_MASK,
        scopes: [...CONNECTOR_CATALOG.gmail.defaultScopes],
        connectedAt: now,
        devSeed: true,
        updatedAt: now,
      });
      mailbox = (await ctx.db.get(mailboxId))!;
    }
    const mailboxOwner = mailbox.userId === owner._id ? owner : ((await ctx.db.get(mailbox.userId)) ?? owner);
    const us: EmailAddress = { name: mailboxOwner.name, email: (mailboxOwner.email ?? "office@agency.test").toLowerCase() };

    // 3. Clients (+ their email domain) and sender contacts.
    const clientsCreated: string[] = [];
    const contactsCreated: string[] = [];
    const orgClients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(READ_CAP);
    const clientIds = {} as Record<SeedClientKey, Id<"clients">>;
    for (const key of Object.keys(SEED_CLIENTS) as SeedClientKey[]) {
      const spec = SEED_CLIENTS[key];
      const override = args.clientNames?.[key];
      const names = override ? [override] : spec.names;
      const exact = orgClients.filter((c) => names.some((n) => sameName(c.name, n)));
      let client = exact.find((c) => !c.archivedAt) ?? exact[0] ?? null;
      if (!client) {
        const id = await ctx.db.insert("clients", {
          orgId,
          name: spec.name,
          currency: settings.defaultCurrency,
          emailDomains: [spec.domain],
          createdAt: now,
          updatedAt: now,
          createdBy: owner._id,
        });
        client = (await ctx.db.get(id))!;
        clientsCreated.push(spec.name);
      } else if (!(client.emailDomains ?? []).includes(spec.domain)) {
        await ctx.db.patch(client._id, {
          emailDomains: [...(client.emailDomains ?? []), spec.domain],
          updatedAt: now,
        });
      }
      clientIds[key] = client._id;
    }
    const contactIds = {} as Partial<Record<PersonKey, Id<"clientContacts">>>;
    for (const key of Object.keys(PEOPLE) as PersonKey[]) {
      const person = PEOPLE[key];
      if (!person.client) continue;
      const clientId = clientIds[person.client];
      const existing = await ctx.db
        .query("clientContacts")
        .withIndex("by_orgId_email", (q) => q.eq("orgId", orgId).eq("email", person.email))
        .first();
      if (existing) {
        contactIds[key] = existing._id;
        continue;
      }
      const hasPrimary = (
        await ctx.db
          .query("clientContacts")
          .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
          .take(50)
      ).some((c) => c.isPrimary);
      contactIds[key] = await ctx.db.insert("clientContacts", {
        orgId,
        clientId,
        name: person.name,
        email: person.email,
        isPrimary: person.primary && !hasPrimary,
        createdAt: now,
        updatedAt: now,
        createdBy: owner._id,
      });
      contactsCreated.push(person.name);
    }

    // 4. Péter's linked task: the latest open top-level task of an Arlo project.
    const linkedTask = await findLinkTask(ctx, orgId, clientIds.arlo);

    // 5. Conversations, messages, thread ↔ task links (items come from `process`).
    const clock: SeedClock = { now, lastFriday1512: lastFriday1512(now, tz), tz };
    const address = (who: PersonKey | "us"): EmailAddress =>
      who === "us" ? us : { name: PEOPLE[who].name, email: PEOPLE[who].email };
    let threadsCreated = 0;
    let messagesCreated = 0;

    for (const spec of THREADS) {
      const gmailThreadId = `${SEED_PREFIX}${spec.key}`;
      const task = spec.linkTask ? linkedTask : null;
      const subject = spec.subject(task);
      const messages = spec.messages(subject);
      const times = messages.map((m) => m.at(clock));
      const inbound = messages.map((m, i) => ({ m, at: times[i] })).filter(({ m }) => m.direction === "inbound");
      const outbound = messages.map((m, i) => ({ m, at: times[i] })).filter(({ m }) => m.direction === "outbound");
      const participants = dedupeAddresses(
        messages.flatMap((m) => [address(m.person), ...m.to.map(address), ...(m.cc ?? []).map(address)]),
      );
      const last = messages[messages.length - 1];

      let thread = await ctx.db
        .query("emailThreads")
        .withIndex("by_orgId_connectorId_gmailThreadId", (q) =>
          q.eq("orgId", orgId).eq("connectorId", mailbox._id).eq("gmailThreadId", gmailThreadId),
        )
        .unique();
      if (!thread) {
        const threadId = await ctx.db.insert("emailThreads", {
          orgId,
          connectorId: mailbox._id,
          gmailThreadId,
          subject: normalizeSubject(subject),
          clientId: spec.client ? clientIds[spec.client] : undefined,
          contactId: spec.contact ? contactIds[spec.contact] : undefined,
          participants,
          lastMessageAt: Math.max(...times),
          lastInboundAt: inbound.length ? Math.max(...inbound.map((x) => x.at)) : undefined,
          lastOutboundAt: outbound.length ? Math.max(...outbound.map((x) => x.at)) : undefined,
          waitingOn: last.direction === "inbound" ? "us" : "client",
          createdAt: now,
          updatedAt: now,
        });
        thread = (await ctx.db.get(threadId))!;
        threadsCreated++;
      }

      for (const [i, message] of messages.entries()) {
        const gmailMessageId = `${SEED_PREFIX}${message.key}`;
        const existing = await ctx.db
          .query("emailMessages")
          .withIndex("by_orgId_connectorId_gmailMessageId", (q) =>
            q.eq("orgId", orgId).eq("connectorId", mailbox._id).eq("gmailMessageId", gmailMessageId),
          )
          .unique();
        if (existing) continue;
        await ctx.db.insert("emailMessages", {
          orgId,
          threadId: thread._id,
          connectorId: mailbox._id,
          gmailMessageId,
          rfcMessageId: `<${message.key}@seed.agency-flow.invalid>`,
          direction: message.direction,
          from: address(message.person),
          to: message.to.map(address),
          cc: (message.cc ?? []).map(address),
          subject: message.subject,
          bodyText: stripQuoted(message.raw, { subject: message.subject }).text,
          bodyHtml: toSimpleHtml(message.raw),
          attachments: message.attachments ?? [],
          sentAt: times[i],
          stage: message.stage,
          createdAt: now,
        });
        messagesCreated++;
      }

      if (task) {
        const links = await ctx.db
          .query("emailThreadTasks")
          .withIndex("by_orgId_threadId", (q) => q.eq("orgId", orgId).eq("threadId", thread._id))
          .take(50);
        if (!links.some((l) => l.taskId === task._id)) {
          await ctx.db.insert("emailThreadTasks", {
            orgId,
            threadId: thread._id,
            taskId: task._id,
            role: "created",
            createdAt: now,
          });
        }
      }
    }

    return {
      orgId,
      mailboxId: mailbox._id,
      clientsCreated,
      contactsCreated,
      threadsCreated,
      messagesCreated,
      linkedTaskId: linkedTask?._id ?? null,
    };
  },
});

function dedupeAddresses(list: EmailAddress[]): EmailAddress[] {
  const seen = new Set<string>();
  return list.filter((a) => (seen.has(a.email) ? false : (seen.add(a.email), true)));
}

async function findLinkTask(
  ctx: MutationCtx,
  orgId: string,
  clientId: Id<"clients">,
): Promise<Doc<"tasks"> | null> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
    .take(50);
  let best: Doc<"tasks"> | null = null;
  for (const project of projects) {
    if (project.orgId !== orgId) continue;
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", project._id))
      .order("desc")
      .take(200);
    for (const task of tasks) {
      if (task.parentTaskId || task.archivedAt || isClosedCategory(task.statusCategory)) continue;
      if (!best || task._creationTime > best._creationTime) best = task;
    }
  }
  return best;
}

// ─── process ────────────────────────────────────────────────────────────────

export type EmailSeedProcessResult = { orgId: string; scheduled: number; retried: number };

/**
 * Run the inbound pipeline (email/pipeline.ts) on the seed mailbox's
 * messages: every message still in a work stage is (re)started, a `failed`
 * one is retried. Handled messages are left alone — to replay the scenario
 * from scratch: reset → seed → process.
 *
 * `fakeModel: true` uses the canned outputs of email/fakeClassifier.ts
 * instead of model calls (demo without AI credit); without it the real
 * model runs and the org needs an AI key (Settings → Integrations).
 *
 *   npx convex run devSeedEmail:process '{"fakeModel":true}'
 */
export const process = internalMutation({
  args: { orgId: v.optional(v.string()), fakeModel: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<EmailSeedProcessResult> => {
    const orgId = await resolveOrgId(ctx, args.orgId);
    await requireEmailTriageEnabled(ctx, orgId);
    let scheduled = 0;
    let retried = 0;
    for (const mailbox of await findSeedMailbox(ctx, orgId)) {
      const threads = await ctx.db
        .query("emailThreads")
        .withIndex("by_orgId_connectorId_gmailThreadId", (q) => q.eq("orgId", orgId).eq("connectorId", mailbox._id))
        .take(READ_CAP);
      for (const thread of threads) {
        const messages = await ctx.db
          .query("emailMessages")
          .withIndex("by_orgId_threadId_sentAt", (q) => q.eq("orgId", orgId).eq("threadId", thread._id))
          .take(READ_CAP);
        for (const message of messages) {
          if (message.stage === "handled") continue;
          if (message.stage === "failed") {
            await ctx.scheduler.runAfter(0, internal.email.pipeline.retryStage, {
              messageId: message._id,
              fakeModel: args.fakeModel,
            });
            retried++;
            continue;
          }
          await ctx.scheduler.runAfter(0, internal.email.pipeline.processInboundMessage, {
            messageId: message._id,
            fakeModel: args.fakeModel,
          });
          scheduled++;
        }
      }
    }
    return { orgId, scheduled, retried };
  },
});

// ─── reset ──────────────────────────────────────────────────────────────────

export type EmailSeedResetResult = { orgId: string; deleted: Record<string, number> };

/** Remove the seed mailbox and every email row hanging off it — nothing else. */
export const reset = internalMutation({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<EmailSeedResetResult> => {
    const orgId = await resolveOrgId(ctx, args.orgId);
    const deleted: Record<string, number> = {
      connectors: 0,
      emailThreads: 0,
      emailMessages: 0,
      emailThreadTasks: 0,
      agentItems: 0,
      clientRequests: 0,
      emailPromises: 0,
      notifications: 0,
    };
    // Email Inbox rows of the seed conversations (task-less, keyed by thread).
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(READ_CAP * 4);
    for (const mailbox of await findSeedMailbox(ctx, orgId)) {
      const threads = await ctx.db
        .query("emailThreads")
        .withIndex("by_orgId_connectorId_gmailThreadId", (q) => q.eq("orgId", orgId).eq("connectorId", mailbox._id))
        .take(READ_CAP);
      for (const thread of threads) {
        const byThread = {
          emailMessages: await ctx.db
            .query("emailMessages")
            .withIndex("by_orgId_threadId_sentAt", (q) => q.eq("orgId", orgId).eq("threadId", thread._id))
            .take(READ_CAP),
          emailThreadTasks: await ctx.db
            .query("emailThreadTasks")
            .withIndex("by_orgId_threadId", (q) => q.eq("orgId", orgId).eq("threadId", thread._id))
            .take(READ_CAP),
          agentItems: await ctx.db
            .query("agentItems")
            .withIndex("by_orgId_anchorType_anchorId_status", (q) =>
              q.eq("orgId", orgId).eq("anchor.type", "emailThread").eq("anchor.id", thread._id),
            )
            .take(READ_CAP),
          clientRequests: await ctx.db
            .query("clientRequests")
            .withIndex("by_orgId_threadId", (q) => q.eq("orgId", orgId).eq("threadId", thread._id))
            .take(READ_CAP),
          emailPromises: await ctx.db
            .query("emailPromises")
            .withIndex("by_orgId_threadId", (q) => q.eq("orgId", orgId).eq("threadId", thread._id))
            .take(READ_CAP),
        };
        for (const [table, rows] of Object.entries(byThread)) {
          for (const row of rows) await ctx.db.delete(row._id);
          deleted[table] += rows.length;
        }
        for (const row of notifications) {
          if (row.threadId !== thread._id) continue;
          await ctx.db.delete(row._id);
          deleted.notifications++;
        }
        await ctx.db.delete(thread._id);
        deleted.emailThreads++;
      }
      await ctx.db.delete(mailbox._id);
      deleted.connectors++;
    }
    return { orgId, deleted };
  },
});
