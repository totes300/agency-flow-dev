import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// MCP idempotency keys are kept 24 h (docs/prd-mcp.md D23).
crons.interval("mcp idempotency cleanup", { hours: 1 }, internal.mcpIdempotency.cleanupExpired, {});

// MCP billing preview tokens commit for 10 minutes; rows are kept 24 h (docs/prd-mcp.md §9).
crons.interval("mcp billing preview cleanup", { hours: 1 }, internal.mcpBillingPreviews.cleanupExpired, {});

export default crons;
