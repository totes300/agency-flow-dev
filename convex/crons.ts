import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run on the 1st of each month at 06:00 UTC
// For each active retainer project: ensure period exists for previous month
// Phase 2 (Reports): will also generate monthly reports here
crons.monthly(
  "retainer monthly period creation",
  { day: 1, hourUTC: 6, minuteUTC: 0 },
  internal.retainerCron.generateMonthlyPeriods,
);

export default crons;
