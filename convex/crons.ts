import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Platform cron jobs. Each job targets an internal function and stays small;
 * the logic lives (and is tested) in its own module.
 */
const crons = cronJobs();

// Agent runs whose action died without settling (I11): fail them as "Run
// timed out", free the thread and start its next queued run.
crons.interval(
  "sweep stale agent runs",
  { minutes: 5 },
  internal.agentRunner.sweepStaleRuns,
  {},
);

// Email triage I5: an inbound message stuck in a work stage for 30 min (its
// scheduled work was lost) is re-kicked. Flagged orgs only (I14).
crons.interval(
  "sweep stuck email messages",
  { minutes: 10 },
  internal.email.pipeline.sweepStuckMessages,
  {},
);

// Email triage D24: Filtered messages are deleted after 30 days unless
// promoted. Visits only orgs with `emailTriageEnabled` (I14).
crons.cron(
  "purge filtered email items",
  "30 2 * * *", // daily 02:30 UTC
  internal.email.triage.purgeFiltered,
  {},
);

export default crons;
