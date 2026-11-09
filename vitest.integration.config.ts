import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.integration.test.ts", "apps/**/*.integration.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
