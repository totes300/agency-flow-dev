import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// MCP idempotency keys are kept 24 h (docs/prd-mcp.md D23).
crons.interval("mcp idempotency cleanup", { hours: 1 }, internal.mcpIdempotency.cleanupExpired, {});

export default crons;
