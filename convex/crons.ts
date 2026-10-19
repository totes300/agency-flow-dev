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

export default crons;
