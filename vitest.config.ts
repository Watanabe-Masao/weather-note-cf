import { defineConfig } from "vitest/config";

// Unit tests run in Node with fixture files; they do not need the Cloudflare runtime.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
