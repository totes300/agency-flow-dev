import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { McpAuthContext } from "./mcpAuth";
import { createRefResolver, type RefResolver } from "./mcpRefs";
import { runItem } from "./mcpWrites";
import { referenceNames, requireMember, type ReferenceNames } from "./mcpSaveTasks";
import type { SaveProjectsResult } from "./mcpWriteResults";
import { normalizeProjectCode } from "./helpers";
import { parseDuration } from "../../lib/duration";
import {
  BILLING_TYPE_LABEL,
  archiveProjectForAuth,
  createProjectForAuth,
  restoreProjectForAuth,
  updateProjectForAuth,
  updateRetainerForAuth,
  type CreateProjectInput,
  type UpdateProjectInput,
  type UpdateRetainerInput,
} from "../projects";
import {
  removeProjectCategoryEstimateForAuth,
  upsertProjectCategoryEstimateForAuth,
} from "../projectCategoryEstimates";
import { removeProjectRateOverrideForAuth, upsertProjectRateOverrideForAuth } from "../projectRateOverrides";

/**
 * MCP `save_projects` (docs/prd-mcp.md §6): a batch of project creates and
 * edits in ONE mutation, all-or-nothing (I5), through the app's project
 * paths (convex/projects.ts and the settings' estimate / rate-override
 * mutations, `*ForAuth`). Admins only, as in the app. Every validation is
 * the app's own (docs/prd-project-billing-redesign.md is the vocabulary);
 * this module only maps fields and refuses what the app's forms never send:
 *
 * - Create = the New Project form: client, name, billing type, optional
 *   code (else suggested from the client), team, and the type's terms —
 *   fixed: `fixedFee` (+ `estimates`); retainer: `includedMinutes`,
 *   `monthlyFee`, `overageRate`, `startDate`, `cycleLength`, `rollover`
 *   (only with a cycle of 2+ months: the app forces it off otherwise, so
 *   asking for it is an error); T&M: `rates`, saved right after the create
 *   (the form sets them on the next screen); non-billable: none. New
 *   retainers start active. `billingType` may be omitted when the terms are
 *   not known yet (D-BILLINGTYPE): the project starts non-billable and the
 *   result row says so; terms without a type are an error.
 * - Edit = Settings: name, code (a change rewrites every task key of the
 *   project, old keys stay as aliases — at most one code change per call,
 *   the rewrite touches every task of the project), team, fixed fee (never
 *   below what is invoiced), retainer terms (the app's dialog is confirmed:
 *   the cycle grid is locked while a period is closed; fee, hours and rate
 *   apply to open periods only) and `retainerActive` (activate / pause).
 * - `estimates` (fixed, the Budget settings): replaces the project's
 *   category estimates — listed categories are set, the others removed.
 * - `rates` (fixed and T&M, the Rates settings): per category, a project
 *   override of the billable rate; `null` goes back to the category default.
 * - A different `billingType` on an edit changes the type together with its
 *   terms, through the same core as the app's Settings (`projects.update`):
 *   allowed while the project has no billing history (no close, no
 *   invoice — `projectHasBillingHistory`), with the New Project form's
 *   validation of the new terms; the previous type's terms are cleared
 *   (see `updateProjectForAuth`). Time entries stay as logged.
 * - The client never changes after creation (the app has no path for it);
 *   `archived` archives (running timers on the project's tasks are saved as
 *   entries, as in the app) or restores.
 * - Only fields that differ are written; an item that changes nothing is
 *   "unchanged".
 *
 * Money is in the project's currency (the client's), in major units as the
 * forms take it. Durations (`includedMinutes`, estimate `minutes`) are whole
 * minutes or a duration string the app parses ("20h", "1h30m", "1:30";
 * lib/duration.ts), so the model never converts units (D1). A field that does not apply to
 * the billing type is an error, never ignored.
 *
 * Read budget per item (at most MCP_BATCH_MAX = 25): refs ~5, names one
 * range per table per call, the core's reads (client, code uniqueness over
 * the org's projects, org members for the team, categories and estimates
 * for a fixed project, the live closes for a retainer grid change, the
 * invoiced amount for a fixed fee) — about 20 ranges; a code change adds
 * ~4 per task of the project, an archive one per org member (timer rescue).
 */

export type ProjectBillingType = Doc<"projects">["billingType"];

export type SaveProjectItem = {
  /** The project to edit: code (ARLO), ID or link. Omit to create. */
  ref?: string;
  name?: string;
  /** Create: the client (client:KONV, ID or link). Edit: must be the project's client. */
  client?: string;
  code?: string;
  /**
   * Create: the type; omitted = non-billable until the terms are known.
   * Edit: a different type changes it (with its terms) while the project has
   * no close or invoice.
   */
  billingType?: ProjectBillingType;
  fixedFee?: number;
  /** Minutes, or a duration string ("20h"). */
  includedMinutes?: number | string;
  monthlyFee?: number;
  overageRate?: number;
  startDate?: string;
  cycleLength?: number;
  rollover?: boolean;
  retainerActive?: boolean;
  estimates?: Array<{ category: string; minutes: number | string }>;
  rates?: Array<{ category: string; rate: number | null }>;
  /** Member emails or "me"; replaces the project team. */
  team?: string[];
  archived?: boolean;
};

type Row = SaveProjectsResult["items"][number];

export const ADMIN_ONLY_PROJECTS = "Projects are created and edited by admins only, as in the app.";

/** The result row's note for a create that left the billing type to be set later. */
export const BILLING_TYPE_NOT_SET_NOTE =
  "billing type not set (non_billable); set it with save_projects when the terms are known";

const RETAINER_FIELDS = ["includedMinutes", "monthlyFee", "overageRate", "startDate", "cycleLength", "rollover", "retainerActive"] as const;

/** The term fields of a create; with no `billingType` they have no type to belong to. */
const TERM_FIELDS = ["fixedFee", "estimates", "rates", ...RETAINER_FIELDS] as const;

/** Refuses the fields the app's forms never send for this billing type. */
function assertFieldsApply(item: SaveProjectItem, billingType: ProjectBillingType): void {
  const label = BILLING_TYPE_LABEL[billingType];
  if (item.fixedFee !== undefined && billingType !== "fixed") {
    throw new ConvexError(`fixedFee applies to fixed-fee projects; this one is ${label}.`);
  }
  if (item.estimates !== undefined && billingType !== "fixed") {
    throw new ConvexError(`estimates apply to fixed-fee projects (the Budget settings); this one is ${label}.`);
  }
  if (item.rates !== undefined && billingType !== "fixed" && billingType !== "t_and_m") {
    throw new ConvexError(`rates apply to fixed-fee and time & materials projects; this one is ${label}.`);
  }
  const retainer = RETAINER_FIELDS.filter((f) => item[f] !== undefined);
  if (retainer.length > 0 && billingType !== "retainer") {
    throw new ConvexError(`${retainer.join(", ")} apply to retainer projects; this one is ${label}.`);
  }
}

/** Whole minutes from a number of minutes or a duration string ("20h", "1h30m", "1:30"). */
export function durationMinutes(value: number | string, name: string): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) throw new ConvexError(`${name} must be whole minutes (0 or more), or a duration like "20h".`);
    return value;
  }
  const minutes = parseDuration(value);
  if (minutes === null) {
    throw new ConvexError(`${name} "${value.trim().slice(0, 40)}" is not a duration: use minutes (600) or e.g. "10h", "1h30m", "1:30".`);
  }
  return minutes;
}

/** Rollover only exists across a cycle of 2+ months (the app forces it off otherwise): asking for it is an error. */
function assertRollover(rollover: boolean | undefined, cycleLength: number): void {
  if (rollover === true && cycleLength < 2) {
    throw new ConvexError("rollover needs a cycle of 2 or more months (cycleLength); a 1-month retainer bills monthly, as in the app.");
  }
}

async function teamIds(resolver: RefResolver, team: readonly string[]): Promise<Id<"users">[]> {
  const ids: Id<"users">[] = [];
  for (const ref of team) {
    const id = await requireMember(resolver, ref);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

async function estimateRows(names: ReferenceNames, estimates: SaveProjectItem["estimates"]) {
  const rows = new Map<Id<"workCategories">, number>();
  for (const e of estimates ?? []) {
    const minutes = durationMinutes(e.minutes, `The estimate for "${e.category}"`);
    const categoryId = await names.category(e.category);
    if (rows.has(categoryId)) throw new ConvexError(`The category "${e.category}" is listed twice in estimates.`);
    rows.set(categoryId, minutes);
  }
  return rows;
}

/** Applies `rates`: an override per category, `null` back to the default. Returns whether anything changed. */
async function applyRates(
  ctx: MutationCtx,
  auth: McpAuthContext,
  names: ReferenceNames,
  project: Doc<"projects">,
  rates: NonNullable<SaveProjectItem["rates"]>,
): Promise<boolean> {
  let changed = false;
  const seen = new Set<Id<"workCategories">>();
  for (const r of rates) {
    const categoryId = await names.category(r.category);
    if (seen.has(categoryId)) throw new ConvexError(`The category "${r.category}" is listed twice in rates.`);
    seen.add(categoryId);
    const existing = await ctx.db
      .query("projectRateOverrides")
      .withIndex("by_projectId_workCategoryId", (q) => q.eq("projectId", project._id).eq("workCategoryId", categoryId))
      .unique();
    if (r.rate === null) {
      if (existing) {
        await removeProjectRateOverrideForAuth(ctx, auth, { id: existing._id });
        changed = true;
      }
    } else if (existing?.billableRate !== r.rate) {
      await upsertProjectRateOverrideForAuth(ctx, auth, { projectId: project._id, workCategoryId: categoryId, billableRate: r.rate });
      changed = true;
    }
  }
  return changed;
}

/** Applies `estimates` as the Budget settings' Save: listed categories set, the rest removed. */
async function applyEstimates(
  ctx: MutationCtx,
  auth: McpAuthContext,
  names: ReferenceNames,
  project: Doc<"projects">,
  estimates: NonNullable<SaveProjectItem["estimates"]>,
): Promise<boolean> {
  const wanted = await estimateRows(names, estimates);
  const current = await ctx.db
    .query("projectCategoryEstimates")
    .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
    .collect();
  let changed = false;
  for (const [workCategoryId, minutes] of wanted) {
    const existing = current.find((e) => e.workCategoryId === workCategoryId);
    if (existing?.estimatedMinutes === minutes) continue;
    await upsertProjectCategoryEstimateForAuth(ctx, auth, { projectId: project._id, workCategoryId, estimatedMinutes: minutes });
    changed = true;
  }
  for (const est of current) {
    if (wanted.has(est.workCategoryId)) continue;
    await removeProjectCategoryEstimateForAuth(ctx, auth, { id: est._id });
    changed = true;
  }
  return changed;
}

function row(project: Doc<"projects">, action: Row["action"], extra: Partial<Row> = {}): Row {
  return {
    projectId: project._id,
    code: project.code,
    name: project.name,
    billingType: project.billingType,
    archived: project.archivedAt !== undefined,
    action,
    ...extra,
  };
}

async function createItem(
  ctx: MutationCtx,
  auth: McpAuthContext,
  names: ReferenceNames,
  resolver: RefResolver,
  item: SaveProjectItem,
): Promise<Row> {
  if (item.archived === true) {
    throw new ConvexError("archived applies to existing projects: create the project first, then archive it by ref.");
  }
  if (item.name === undefined || item.client === undefined) {
    throw new ConvexError(
      "name and client are required to create a project (and billingType, unless the terms are not known yet: it then starts non-billable). To edit one, pass its ref (code, ID or link).",
    );
  }
  // D-BILLINGTYPE: no type yet = non-billable until the terms are known.
  if (item.billingType === undefined) {
    const terms = TERM_FIELDS.filter((f) => item[f] !== undefined);
    if (terms.length > 0) {
      throw new ConvexError(
        `billingType is required with ${terms.join(", ")}: name the type these terms belong to, or omit them to start non-billable.`,
      );
    }
  }
  const billingType = item.billingType ?? "non_billable";
  assertFieldsApply(item, billingType);
  if (item.retainerActive !== undefined) {
    throw new ConvexError("retainerActive applies to existing retainers: a new retainer starts active.");
  }
  const includedMinutes = item.includedMinutes !== undefined ? durationMinutes(item.includedMinutes, "includedMinutes") : undefined;
  assertRollover(item.rollover, item.cycleLength ?? 1);
  const client = await resolver.require(item.client, "client");
  if (client.type !== "client") throw new Error(`Expected a client, resolved a ${client.type}`);

  const estimates = item.estimates !== undefined ? await estimateRows(names, item.estimates) : undefined;
  const input: CreateProjectInput = {
    clientId: client.client._id,
    name: item.name,
    billingType,
    code: item.code,
    fixedPrice: item.fixedFee,
    categoryEstimates: estimates
      ? [...estimates].map(([workCategoryId, estimatedMinutes]) => ({ workCategoryId, estimatedMinutes }))
      : undefined,
    includedMinutesPerMonth: includedMinutes,
    monthlyFee: item.monthlyFee,
    startDate: item.startDate,
    cycleLength: item.cycleLength,
    rolloverEnabled: item.rollover,
    overageRate: item.overageRate,
    teamMembers: item.team !== undefined ? await teamIds(resolver, item.team) : undefined,
  };
  const projectId = await createProjectForAuth(ctx, auth, input);
  let project = (await ctx.db.get(projectId))!;
  if (item.rates !== undefined) {
    await applyRates(ctx, auth, names, project, item.rates);
    project = (await ctx.db.get(projectId))!;
  }
  return row(project, "created", item.billingType === undefined ? { note: BILLING_TYPE_NOT_SET_NOTE } : {});
}

async function editItem(
  ctx: MutationCtx,
  auth: McpAuthContext,
  names: ReferenceNames,
  resolver: RefResolver,
  calls: { codeChanges: number },
  item: SaveProjectItem & { ref: string },
): Promise<Row> {
  const resolved = await resolver.require(item.ref, "project");
  if (resolved.type !== "project") throw new Error(`Expected a project, resolved a ${resolved.type}`);
  let project = resolved.project;
  if (item.client !== undefined) {
    const client = await resolver.require(item.client, "client");
    if (client.type !== "client") throw new Error(`Expected a client, resolved a ${client.type}`);
    if (client.client._id !== project.clientId) {
      throw new ConvexError("A project's client cannot change (as in the app). Create a new project under the other client.");
    }
  }
  // D-BILLINGTYPE: a different type changes it with its terms (the core
  // refuses once the project has a close or an invoice); the fields must
  // apply to the type the project is about to have.
  const newType = item.billingType !== undefined && item.billingType !== project.billingType ? item.billingType : undefined;
  const billingType = newType ?? project.billingType;
  assertFieldsApply(item, billingType);
  const includedMinutes = item.includedMinutes !== undefined ? durationMinutes(item.includedMinutes, "includedMinutes") : undefined;
  if (billingType === "retainer") {
    assertRollover(item.rollover, item.cycleLength ?? (newType === undefined ? project.cycleLength : undefined) ?? 1);
  }

  let changed = false;
  const extra: Partial<Row> = {};
  if (item.archived === false && project.archivedAt !== undefined) {
    await restoreProjectForAuth(ctx, auth, { id: project._id });
    changed = true;
  }

  // Settings → General / Team: only what differs.
  const update: UpdateProjectInput = { id: project._id };
  if (item.name !== undefined && item.name.trim() !== project.name) update.name = item.name;
  if (item.code !== undefined && item.code.trim() !== project.code && normalizeProjectCode(item.code) !== project.code) {
    // A code change rewrites every task key of the project; one per call
    // keeps that inside Convex's per-call read limits.
    if (++calls.codeChanges > 1) {
      throw new ConvexError("Change at most one project code per call (each rewrites every task key of its project).");
    }
    update.code = item.code;
  }
  if (newType !== undefined) {
    // The type and the new type's terms change together (the create-time
    // validation runs in the core; `estimates` seed the Budget rows as a
    // fixed create does).
    update.billingType = newType;
    if (item.fixedFee !== undefined) update.fixedPrice = item.fixedFee;
    if (includedMinutes !== undefined) update.includedMinutesPerMonth = includedMinutes;
    if (item.monthlyFee !== undefined) update.monthlyFee = item.monthlyFee;
    if (item.overageRate !== undefined) update.overageRate = item.overageRate;
    if (item.startDate !== undefined) update.startDate = item.startDate;
    if (item.cycleLength !== undefined) update.cycleLength = item.cycleLength;
    if (item.rollover !== undefined) update.rolloverEnabled = item.rollover;
    if (item.estimates !== undefined) {
      update.categoryEstimates = [...(await estimateRows(names, item.estimates))].map(([workCategoryId, estimatedMinutes]) => ({
        workCategoryId,
        estimatedMinutes,
      }));
    }
  } else if (item.fixedFee !== undefined && item.fixedFee !== project.fixedPrice) {
    update.fixedPrice = item.fixedFee;
  }
  if (item.team !== undefined) {
    const ids = await teamIds(resolver, item.team);
    const current = project.teamMembers ?? [];
    if (ids.length !== current.length || ids.some((id) => !current.includes(id))) update.teamMembers = ids;
  }
  if (Object.keys(update).length > 1) {
    await updateProjectForAuth(ctx, auth, update);
    if (update.code !== undefined) extra.previousCode = project.code;
    changed = true;
    // The retainer diff below compares against the terms just written.
    if (newType !== undefined) project = (await ctx.db.get(project._id))!;
  }

  // Settings → Retainer (the dialog's confirmation is the tool call itself, D3).
  const retainer: UpdateRetainerInput = { id: project._id, confirmed: true };
  if (includedMinutes !== undefined && includedMinutes !== project.includedMinutesPerMonth) {
    retainer.includedMinutesPerMonth = includedMinutes;
  }
  if (item.monthlyFee !== undefined && item.monthlyFee !== project.monthlyFee) retainer.monthlyFee = item.monthlyFee;
  if (item.overageRate !== undefined && item.overageRate !== project.overageRate) retainer.overageRate = item.overageRate;
  if (item.startDate !== undefined && item.startDate !== project.startDate) retainer.startDate = item.startDate;
  if (item.cycleLength !== undefined && item.cycleLength !== (project.cycleLength ?? 1)) retainer.cycleLength = item.cycleLength;
  if (item.rollover !== undefined && item.rollover !== (project.rolloverEnabled ?? false)) retainer.rolloverEnabled = item.rollover;
  if (item.retainerActive !== undefined) {
    const status = item.retainerActive ? "active" : "inactive";
    if (status !== (project.retainerStatus ?? "active")) retainer.retainerStatus = status;
  }
  if (Object.keys(retainer).length > 2) {
    await updateRetainerForAuth(ctx, auth, retainer);
    changed = true;
  }

  project = (await ctx.db.get(project._id))!;
  // A change to fixed seeded the estimates above (unlisted categories at 0, as create does).
  if (item.estimates !== undefined && newType === undefined && (await applyEstimates(ctx, auth, names, project, item.estimates))) changed = true;
  if (item.rates !== undefined && (await applyRates(ctx, auth, names, project, item.rates))) changed = true;

  if (item.archived === true && project.archivedAt === undefined) {
    const rescue = await archiveProjectForAuth(ctx, auth, { id: project._id });
    if (rescue.autoSavedTimers.length > 0) {
      extra.autoSavedTimers = rescue.autoSavedTimers.map((t) => ({ member: t.userName, minutes: t.minutes }));
    }
    if (rescue.timerSaveFailures.length > 0) {
      extra.timerSaveFailures = rescue.timerSaveFailures.map((t) => ({ member: t.userName, reason: t.reason }));
    }
    changed = true;
  }
  return row((await ctx.db.get(project._id))!, changed ? "updated" : "unchanged", extra);
}

/** Runs every item in order; the first failing item aborts the whole call (I5). */
export async function saveProjects(
  ctx: MutationCtx,
  auth: McpAuthContext,
  items: readonly SaveProjectItem[],
): Promise<SaveProjectsResult> {
  if (!auth.isAdmin) throw new ConvexError(ADMIN_ONLY_PROJECTS);
  const calls = { codeChanges: 0 };
  const names = referenceNames(ctx, auth.orgId);
  const resolver = createRefResolver(ctx, auth);
  const results: Row[] = [];
  for (const [index, item] of items.entries()) {
    const label = item.ref ?? (item.name ? item.name.slice(0, 40) : null);
    results.push(
      await runItem(index, label, () =>
        item.ref !== undefined
          ? editItem(ctx, auth, names, resolver, calls, { ...item, ref: item.ref })
          : createItem(ctx, auth, names, resolver, item),
      ),
    );
  }
  return { tool: "save_projects", items: results };
}
