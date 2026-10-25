/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as __tests___helpers_appUploads from "../__tests__/helpers/appUploads.js";
import type * as __tests___helpers_billingWorld from "../__tests__/helpers/billingWorld.js";
import type * as __tests___helpers_mcpConnections from "../__tests__/helpers/mcpConnections.js";
import type * as __tests___helpers_orgSnapshot from "../__tests__/helpers/orgSnapshot.js";
import type * as __tests___helpers_taskFixtures from "../__tests__/helpers/taskFixtures.js";
import type * as activityLog from "../activityLog.js";
import type * as aiIntegration from "../aiIntegration.js";
import type * as attachmentContents from "../attachmentContents.js";
import type * as attachmentExtraction from "../attachmentExtraction.js";
import type * as attachments from "../attachments.js";
import type * as billingCloses from "../billingCloses.js";
import type * as billingInvoices from "../billingInvoices.js";
import type * as billingReconcile from "../billingReconcile.js";
import type * as billingReports from "../billingReports.js";
import type * as billingViews from "../billingViews.js";
import type * as categoryRates from "../categoryRates.js";
import type * as clientContacts from "../clientContacts.js";
import type * as clients from "../clients.js";
import type * as commentAttachments from "../commentAttachments.js";
import type * as commentReactions from "../commentReactions.js";
import type * as comments from "../comments.js";
import type * as connectedApps from "../connectedApps.js";
import type * as crons from "../crons.js";
import type * as dailyNotes from "../dailyNotes.js";
import type * as devSeedArloJune from "../devSeedArloJune.js";
import type * as devSeedInbox from "../devSeedInbox.js";
import type * as devSeedTasks from "../devSeedTasks.js";
import type * as fileUploads from "../fileUploads.js";
import type * as http from "../http.js";
import type * as invoices from "../invoices.js";
import type * as labels from "../labels.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_billing_closeData from "../lib/billing/closeData.js";
import type * as lib_billing_closeLifecycle from "../lib/billing/closeLifecycle.js";
import type * as lib_billing_entryCloseInfo from "../lib/billing/entryCloseInfo.js";
import type * as lib_billing_events from "../lib/billing/events.js";
import type * as lib_billing_invoiceLifecycle from "../lib/billing/invoiceLifecycle.js";
import type * as lib_billing_invoiceView from "../lib/billing/invoiceView.js";
import type * as lib_billing_labels from "../lib/billing/labels.js";
import type * as lib_billing_money from "../lib/billing/money.js";
import type * as lib_billing_periodState from "../lib/billing/periodState.js";
import type * as lib_billing_periodView from "../lib/billing/periodView.js";
import type * as lib_billing_periods from "../lib/billing/periods.js";
import type * as lib_billing_pricing from "../lib/billing/pricing.js";
import type * as lib_billing_projectPeriods from "../lib/billing/projectPeriods.js";
import type * as lib_billing_reconcile from "../lib/billing/reconcile.js";
import type * as lib_billing_reportGroups from "../lib/billing/reportGroups.js";
import type * as lib_billing_reportMonths from "../lib/billing/reportMonths.js";
import type * as lib_billing_scope from "../lib/billing/scope.js";
import type * as lib_billing_timers from "../lib/billing/timers.js";
import type * as lib_billing_usageBlock from "../lib/billing/usageBlock.js";
import type * as lib_clientPrefix from "../lib/clientPrefix.js";
import type * as lib_closeFlags from "../lib/closeFlags.js";
import type * as lib_closeGroups from "../lib/closeGroups.js";
import type * as lib_closeQueue from "../lib/closeQueue.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_content_validation from "../lib/content_validation.js";
import type * as lib_dailyNotesHelpers from "../lib/dailyNotesHelpers.js";
import type * as lib_dateValidation from "../lib/dateValidation.js";
import type * as lib_entryStatus from "../lib/entryStatus.js";
import type * as lib_helpers from "../lib/helpers.js";
import type * as lib_invoiceIdentifier from "../lib/invoiceIdentifier.js";
import type * as lib_markPaid from "../lib/markPaid.js";
import type * as lib_mcpAuth from "../lib/mcpAuth.js";
import type * as lib_mcpBilling from "../lib/mcpBilling.js";
import type * as lib_mcpBillingResults from "../lib/mcpBillingResults.js";
import type * as lib_mcpChanges from "../lib/mcpChanges.js";
import type * as lib_mcpConnections from "../lib/mcpConnections.js";
import type * as lib_mcpDelete from "../lib/mcpDelete.js";
import type * as lib_mcpExternalRefs from "../lib/mcpExternalRefs.js";
import type * as lib_mcpFiles from "../lib/mcpFiles.js";
import type * as lib_mcpInbox from "../lib/mcpInbox.js";
import type * as lib_mcpMembers from "../lib/mcpMembers.js";
import type * as lib_mcpProjectTerms from "../lib/mcpProjectTerms.js";
import type * as lib_mcpRecords from "../lib/mcpRecords.js";
import type * as lib_mcpRefs from "../lib/mcpRefs.js";
import type * as lib_mcpReports from "../lib/mcpReports.js";
import type * as lib_mcpSaveClients from "../lib/mcpSaveClients.js";
import type * as lib_mcpSaveComments from "../lib/mcpSaveComments.js";
import type * as lib_mcpSaveDailyNotes from "../lib/mcpSaveDailyNotes.js";
import type * as lib_mcpSavePlan from "../lib/mcpSavePlan.js";
import type * as lib_mcpSaveProjects from "../lib/mcpSaveProjects.js";
import type * as lib_mcpSaveTasks from "../lib/mcpSaveTasks.js";
import type * as lib_mcpSaveTimeEntries from "../lib/mcpSaveTimeEntries.js";
import type * as lib_mcpSearch from "../lib/mcpSearch.js";
import type * as lib_mcpTimer from "../lib/mcpTimer.js";
import type * as lib_mcpWriteResults from "../lib/mcpWriteResults.js";
import type * as lib_mcpWrites from "../lib/mcpWrites.js";
import type * as lib_notificationEvents from "../lib/notificationEvents.js";
import type * as lib_orgHelpers from "../lib/orgHelpers.js";
import type * as lib_plannerMath from "../lib/plannerMath.js";
import type * as lib_projectDelete from "../lib/projectDelete.js";
import type * as lib_projectEntries from "../lib/projectEntries.js";
import type * as lib_projectSummary from "../lib/projectSummary.js";
import type * as lib_rates from "../lib/rates.js";
import type * as lib_reportCore from "../lib/reportCore.js";
import type * as lib_reportPeriod from "../lib/reportPeriod.js";
import type * as lib_rounding from "../lib/rounding.js";
import type * as lib_searchText from "../lib/searchText.js";
import type * as lib_secretCrypto from "../lib/secretCrypto.js";
import type * as lib_task_helpers from "../lib/task_helpers.js";
import type * as lib_timer from "../lib/timer.js";
import type * as lib_timerEntry from "../lib/timerEntry.js";
import type * as lib_timesheetPivot from "../lib/timesheetPivot.js";
import type * as lib_todayPlan from "../lib/todayPlan.js";
import type * as lib_types from "../lib/types.js";
import type * as lib_url from "../lib/url.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_worksheetAi from "../lib/worksheetAi.js";
import type * as linkPreviews from "../linkPreviews.js";
import type * as mcp_auth from "../mcp/auth.js";
import type * as mcp_billing from "../mcp/billing.js";
import type * as mcp_connections from "../mcp/connections.js";
import type * as mcp_fetch from "../mcp/fetch.js";
import type * as mcp_files from "../mcp/files.js";
import type * as mcp_members from "../mcp/members.js";
import type * as mcp_report from "../mcp/report.js";
import type * as mcp_search from "../mcp/search.js";
import type * as mcp_timer from "../mcp/timer.js";
import type * as mcp_write from "../mcp/write.js";
import type * as mcpBillingPreviews from "../mcpBillingPreviews.js";
import type * as mcpFileUploads from "../mcpFileUploads.js";
import type * as mcpIdempotency from "../mcpIdempotency.js";
import type * as notifications from "../notifications.js";
import type * as orgMembers from "../orgMembers.js";
import type * as orgSettings from "../orgSettings.js";
import type * as planner from "../planner.js";
import type * as projectCategoryEstimates from "../projectCategoryEstimates.js";
import type * as projectRateOverrides from "../projectRateOverrides.js";
import type * as projects from "../projects.js";
import type * as reports from "../reports.js";
import type * as search from "../search.js";
import type * as statuses from "../statuses.js";
import type * as tasks from "../tasks.js";
import type * as tasks_access from "../tasks/access.js";
import type * as tasks_derived from "../tasks/derived.js";
import type * as tasks_filters from "../tasks/filters.js";
import type * as tasks_lookup from "../tasks/lookup.js";
import type * as tasks_model from "../tasks/model.js";
import type * as tasks_queries from "../tasks/queries.js";
import type * as tasks_read from "../tasks/read.js";
import type * as tasks_today from "../tasks/today.js";
import type * as tasks_userState from "../tasks/userState.js";
import type * as tasks_views from "../tasks/views.js";
import type * as tasks_write from "../tasks/write.js";
import type * as timeEntries from "../timeEntries.js";
import type * as timer from "../timer.js";
import type * as timesheets from "../timesheets.js";
import type * as typingIndicators from "../typingIndicators.js";
import type * as userRates from "../userRates.js";
import type * as users from "../users.js";
import type * as webhooks from "../webhooks.js";
import type * as workCategories from "../workCategories.js";
import type * as workday from "../workday.js";
import type * as worksheets from "../worksheets.js";
import type * as worksheetsHelpers from "../worksheetsHelpers.js";
import type * as workspaceRefs from "../workspaceRefs.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "__tests__/helpers/appUploads": typeof __tests___helpers_appUploads;
  "__tests__/helpers/billingWorld": typeof __tests___helpers_billingWorld;
  "__tests__/helpers/mcpConnections": typeof __tests___helpers_mcpConnections;
  "__tests__/helpers/orgSnapshot": typeof __tests___helpers_orgSnapshot;
  "__tests__/helpers/taskFixtures": typeof __tests___helpers_taskFixtures;
  activityLog: typeof activityLog;
  aiIntegration: typeof aiIntegration;
  attachmentContents: typeof attachmentContents;
  attachmentExtraction: typeof attachmentExtraction;
  attachments: typeof attachments;
  billingCloses: typeof billingCloses;
  billingInvoices: typeof billingInvoices;
  billingReconcile: typeof billingReconcile;
  billingReports: typeof billingReports;
  billingViews: typeof billingViews;
  categoryRates: typeof categoryRates;
  clientContacts: typeof clientContacts;
  clients: typeof clients;
  commentAttachments: typeof commentAttachments;
  commentReactions: typeof commentReactions;
  comments: typeof comments;
  connectedApps: typeof connectedApps;
  crons: typeof crons;
  dailyNotes: typeof dailyNotes;
  devSeedArloJune: typeof devSeedArloJune;
  devSeedInbox: typeof devSeedInbox;
  devSeedTasks: typeof devSeedTasks;
  fileUploads: typeof fileUploads;
  http: typeof http;
  invoices: typeof invoices;
  labels: typeof labels;
  "lib/auth": typeof lib_auth;
  "lib/billing/closeData": typeof lib_billing_closeData;
  "lib/billing/closeLifecycle": typeof lib_billing_closeLifecycle;
  "lib/billing/entryCloseInfo": typeof lib_billing_entryCloseInfo;
  "lib/billing/events": typeof lib_billing_events;
  "lib/billing/invoiceLifecycle": typeof lib_billing_invoiceLifecycle;
  "lib/billing/invoiceView": typeof lib_billing_invoiceView;
  "lib/billing/labels": typeof lib_billing_labels;
  "lib/billing/money": typeof lib_billing_money;
  "lib/billing/periodState": typeof lib_billing_periodState;
  "lib/billing/periodView": typeof lib_billing_periodView;
  "lib/billing/periods": typeof lib_billing_periods;
  "lib/billing/pricing": typeof lib_billing_pricing;
  "lib/billing/projectPeriods": typeof lib_billing_projectPeriods;
  "lib/billing/reconcile": typeof lib_billing_reconcile;
  "lib/billing/reportGroups": typeof lib_billing_reportGroups;
  "lib/billing/reportMonths": typeof lib_billing_reportMonths;
  "lib/billing/scope": typeof lib_billing_scope;
  "lib/billing/timers": typeof lib_billing_timers;
  "lib/billing/usageBlock": typeof lib_billing_usageBlock;
  "lib/clientPrefix": typeof lib_clientPrefix;
  "lib/closeFlags": typeof lib_closeFlags;
  "lib/closeGroups": typeof lib_closeGroups;
  "lib/closeQueue": typeof lib_closeQueue;
  "lib/constants": typeof lib_constants;
  "lib/content_validation": typeof lib_content_validation;
  "lib/dailyNotesHelpers": typeof lib_dailyNotesHelpers;
  "lib/dateValidation": typeof lib_dateValidation;
  "lib/entryStatus": typeof lib_entryStatus;
  "lib/helpers": typeof lib_helpers;
  "lib/invoiceIdentifier": typeof lib_invoiceIdentifier;
  "lib/markPaid": typeof lib_markPaid;
  "lib/mcpAuth": typeof lib_mcpAuth;
  "lib/mcpBilling": typeof lib_mcpBilling;
  "lib/mcpBillingResults": typeof lib_mcpBillingResults;
  "lib/mcpChanges": typeof lib_mcpChanges;
  "lib/mcpConnections": typeof lib_mcpConnections;
  "lib/mcpDelete": typeof lib_mcpDelete;
  "lib/mcpExternalRefs": typeof lib_mcpExternalRefs;
  "lib/mcpFiles": typeof lib_mcpFiles;
  "lib/mcpInbox": typeof lib_mcpInbox;
  "lib/mcpMembers": typeof lib_mcpMembers;
  "lib/mcpProjectTerms": typeof lib_mcpProjectTerms;
  "lib/mcpRecords": typeof lib_mcpRecords;
  "lib/mcpRefs": typeof lib_mcpRefs;
  "lib/mcpReports": typeof lib_mcpReports;
  "lib/mcpSaveClients": typeof lib_mcpSaveClients;
  "lib/mcpSaveComments": typeof lib_mcpSaveComments;
  "lib/mcpSaveDailyNotes": typeof lib_mcpSaveDailyNotes;
  "lib/mcpSavePlan": typeof lib_mcpSavePlan;
  "lib/mcpSaveProjects": typeof lib_mcpSaveProjects;
  "lib/mcpSaveTasks": typeof lib_mcpSaveTasks;
  "lib/mcpSaveTimeEntries": typeof lib_mcpSaveTimeEntries;
  "lib/mcpSearch": typeof lib_mcpSearch;
  "lib/mcpTimer": typeof lib_mcpTimer;
  "lib/mcpWriteResults": typeof lib_mcpWriteResults;
  "lib/mcpWrites": typeof lib_mcpWrites;
  "lib/notificationEvents": typeof lib_notificationEvents;
  "lib/orgHelpers": typeof lib_orgHelpers;
  "lib/plannerMath": typeof lib_plannerMath;
  "lib/projectDelete": typeof lib_projectDelete;
  "lib/projectEntries": typeof lib_projectEntries;
  "lib/projectSummary": typeof lib_projectSummary;
  "lib/rates": typeof lib_rates;
  "lib/reportCore": typeof lib_reportCore;
  "lib/reportPeriod": typeof lib_reportPeriod;
  "lib/rounding": typeof lib_rounding;
  "lib/searchText": typeof lib_searchText;
  "lib/secretCrypto": typeof lib_secretCrypto;
  "lib/task_helpers": typeof lib_task_helpers;
  "lib/timer": typeof lib_timer;
  "lib/timerEntry": typeof lib_timerEntry;
  "lib/timesheetPivot": typeof lib_timesheetPivot;
  "lib/todayPlan": typeof lib_todayPlan;
  "lib/types": typeof lib_types;
  "lib/url": typeof lib_url;
  "lib/validators": typeof lib_validators;
  "lib/worksheetAi": typeof lib_worksheetAi;
  linkPreviews: typeof linkPreviews;
  "mcp/auth": typeof mcp_auth;
  "mcp/billing": typeof mcp_billing;
  "mcp/connections": typeof mcp_connections;
  "mcp/fetch": typeof mcp_fetch;
  "mcp/files": typeof mcp_files;
  "mcp/members": typeof mcp_members;
  "mcp/report": typeof mcp_report;
  "mcp/search": typeof mcp_search;
  "mcp/timer": typeof mcp_timer;
  "mcp/write": typeof mcp_write;
  mcpBillingPreviews: typeof mcpBillingPreviews;
  mcpFileUploads: typeof mcpFileUploads;
  mcpIdempotency: typeof mcpIdempotency;
  notifications: typeof notifications;
  orgMembers: typeof orgMembers;
  orgSettings: typeof orgSettings;
  planner: typeof planner;
  projectCategoryEstimates: typeof projectCategoryEstimates;
  projectRateOverrides: typeof projectRateOverrides;
  projects: typeof projects;
  reports: typeof reports;
  search: typeof search;
  statuses: typeof statuses;
  tasks: typeof tasks;
  "tasks/access": typeof tasks_access;
  "tasks/derived": typeof tasks_derived;
  "tasks/filters": typeof tasks_filters;
  "tasks/lookup": typeof tasks_lookup;
  "tasks/model": typeof tasks_model;
  "tasks/queries": typeof tasks_queries;
  "tasks/read": typeof tasks_read;
  "tasks/today": typeof tasks_today;
  "tasks/userState": typeof tasks_userState;
  "tasks/views": typeof tasks_views;
  "tasks/write": typeof tasks_write;
  timeEntries: typeof timeEntries;
  timer: typeof timer;
  timesheets: typeof timesheets;
  typingIndicators: typeof typingIndicators;
  userRates: typeof userRates;
  users: typeof users;
  webhooks: typeof webhooks;
  workCategories: typeof workCategories;
  workday: typeof workday;
  worksheets: typeof worksheets;
  worksheetsHelpers: typeof worksheetsHelpers;
  workspaceRefs: typeof workspaceRefs;
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
