import { defineConfig } from "vitest/config";

// Backend tests only. The frontend in ./frontend has its own Vitest config.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
