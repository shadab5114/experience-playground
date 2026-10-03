import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Suites share one test database, so run test files one at a time.
    fileParallelism: false,
    // Reads server/.env (TEST_DATABASE_URL and friends) without a shell wrapper.
    env: loadEnv("test", here, ""),
  },
});
