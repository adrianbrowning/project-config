import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [ "**/*.test.ts" ],
    testTimeout: 120000,
    hookTimeout: 60000,
    globalSetup: [ "./globalSetup.ts" ],
    setupFiles: [ "./setup.ts" ],
    pool: "forks", // Use forks for better isolation
    fileParallelism: false, // Run tests serially for Docker stability (replaces poolOptions.forks.singleFork in Vitest 4)
  },
});
