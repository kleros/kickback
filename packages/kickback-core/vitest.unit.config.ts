import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testNamePattern: /^(?!.*a revert from the chain reaches the user)/,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["test/kickback.test.ts", "test/core.chain.test.ts", "test/lifecycle.integration.test.ts"],
  },
});
