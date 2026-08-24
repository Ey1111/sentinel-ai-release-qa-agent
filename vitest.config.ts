import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "**/node_modules/**", "**/dist/**"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
