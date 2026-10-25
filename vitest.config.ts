import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // .claude/ holds agent worktrees (stale copies of the repo); .reference/ is
    // read-only reference code. Neither is this checkout's test suite.
    exclude: ["node_modules/**", ".claude/**", ".reference/**"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
