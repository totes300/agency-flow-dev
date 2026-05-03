/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activityLog from "../activityLog.js";
import type * as attachments from "../attachments.js";
import type * as categoryRates from "../categoryRates.js";
import type * as clientContacts from "../clientContacts.js";
import type * as clients from "../clients.js";
import type * as commentAttachments from "../commentAttachments.js";
import type * as commentReactions from "../commentReactions.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as dailyNotes from "../dailyNotes.js";
import type * as http from "../http.js";
import type * as invoices from "../invoices.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_content_validation from "../lib/content_validation.js";
import type * as lib_dailyNotesHelpers from "../lib/dailyNotesHelpers.js";
import type * as lib_dateValidation from "../lib/dateValidation.js";
import type * as lib_helpers from "../lib/helpers.js";
import type * as lib_invoiceAnchor from "../lib/invoiceAnchor.js";
import type * as lib_invoiceCreation from "../lib/invoiceCreation.js";
import type * as lib_invoiceIdentifier from "../lib/invoiceIdentifier.js";
import type * as lib_markPaid from "../lib/markPaid.js";
import type * as lib_myTaskHelpers from "../lib/myTaskHelpers.js";
import type * as lib_orgHelpers from "../lib/orgHelpers.js";
import type * as lib_projectSummary from "../lib/projectSummary.js";
import type * as lib_rates from "../lib/rates.js";
import type * as lib_readyToInvoice from "../lib/readyToInvoice.js";
import type * as lib_reportPeriod from "../lib/reportPeriod.js";
import type * as lib_retainerBalance from "../lib/retainerBalance.js";
import type * as lib_retainerUsage from "../lib/retainerUsage.js";
import type * as lib_rounding from "../lib/rounding.js";
import type * as lib_taskActivityIndicators from "../lib/taskActivityIndicators.js";
import type * as lib_task_helpers from "../lib/task_helpers.js";
import type * as lib_timer from "../lib/timer.js";
import type * as lib_types from "../lib/types.js";
import type * as lib_url from "../lib/url.js";
import type * as lib_validators from "../lib/validators.js";
import type * as linkPreviews from "../linkPreviews.js";
import type * as migrations_deleteLegacyTimeEntries from "../migrations/deleteLegacyTimeEntries.js";
import type * as migrations_seedInvoicingScenarios from "../migrations/seedInvoicingScenarios.js";
import type * as migrations_wipeAllTimeEntries from "../migrations/wipeAllTimeEntries.js";
import type * as migrations_wipeInvoicingForRefactor from "../migrations/wipeInvoicingForRefactor.js";
import type * as myTasks from "../myTasks.js";
import type * as orgMembers from "../orgMembers.js";
import type * as orgSettings from "../orgSettings.js";
import type * as projectCategoryEstimates from "../projectCategoryEstimates.js";
import type * as projectRateOverrides from "../projectRateOverrides.js";
import type * as projects from "../projects.js";
import type * as retainerCron from "../retainerCron.js";
import type * as retainerPeriods from "../retainerPeriods.js";
import type * as statements from "../statements.js";
import type * as statuses from "../statuses.js";
import type * as taskViewReceipts from "../taskViewReceipts.js";
import type * as tasks from "../tasks.js";
import type * as timeEntries from "../timeEntries.js";
import type * as timer from "../timer.js";
import type * as typingIndicators from "../typingIndicators.js";
import type * as userRates from "../userRates.js";
import type * as users from "../users.js";
import type * as workCategories from "../workCategories.js";
import type * as workday from "../workday.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activityLog: typeof activityLog;
  attachments: typeof attachments;
  categoryRates: typeof categoryRates;
  clientContacts: typeof clientContacts;
  clients: typeof clients;
  commentAttachments: typeof commentAttachments;
  commentReactions: typeof commentReactions;
  comments: typeof comments;
  crons: typeof crons;
  dailyNotes: typeof dailyNotes;
  http: typeof http;
  invoices: typeof invoices;
  "lib/auth": typeof lib_auth;
  "lib/constants": typeof lib_constants;
  "lib/content_validation": typeof lib_content_validation;
  "lib/dailyNotesHelpers": typeof lib_dailyNotesHelpers;
  "lib/dateValidation": typeof lib_dateValidation;
  "lib/helpers": typeof lib_helpers;
  "lib/invoiceAnchor": typeof lib_invoiceAnchor;
  "lib/invoiceCreation": typeof lib_invoiceCreation;
  "lib/invoiceIdentifier": typeof lib_invoiceIdentifier;
  "lib/markPaid": typeof lib_markPaid;
  "lib/myTaskHelpers": typeof lib_myTaskHelpers;
  "lib/orgHelpers": typeof lib_orgHelpers;
  "lib/projectSummary": typeof lib_projectSummary;
  "lib/rates": typeof lib_rates;
  "lib/readyToInvoice": typeof lib_readyToInvoice;
  "lib/reportPeriod": typeof lib_reportPeriod;
  "lib/retainerBalance": typeof lib_retainerBalance;
  "lib/retainerUsage": typeof lib_retainerUsage;
  "lib/rounding": typeof lib_rounding;
  "lib/taskActivityIndicators": typeof lib_taskActivityIndicators;
  "lib/task_helpers": typeof lib_task_helpers;
  "lib/timer": typeof lib_timer;
  "lib/types": typeof lib_types;
  "lib/url": typeof lib_url;
  "lib/validators": typeof lib_validators;
  linkPreviews: typeof linkPreviews;
  "migrations/deleteLegacyTimeEntries": typeof migrations_deleteLegacyTimeEntries;
  "migrations/seedInvoicingScenarios": typeof migrations_seedInvoicingScenarios;
  "migrations/wipeAllTimeEntries": typeof migrations_wipeAllTimeEntries;
  "migrations/wipeInvoicingForRefactor": typeof migrations_wipeInvoicingForRefactor;
  myTasks: typeof myTasks;
  orgMembers: typeof orgMembers;
  orgSettings: typeof orgSettings;
  projectCategoryEstimates: typeof projectCategoryEstimates;
  projectRateOverrides: typeof projectRateOverrides;
  projects: typeof projects;
  retainerCron: typeof retainerCron;
  retainerPeriods: typeof retainerPeriods;
  statements: typeof statements;
  statuses: typeof statuses;
  taskViewReceipts: typeof taskViewReceipts;
  tasks: typeof tasks;
  timeEntries: typeof timeEntries;
  timer: typeof timer;
  typingIndicators: typeof typingIndicators;
  userRates: typeof userRates;
  users: typeof users;
  workCategories: typeof workCategories;
  workday: typeof workday;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
