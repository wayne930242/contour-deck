import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ALLOWED_ORIGINS: "https://deck.example,http://localhost:*",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    // WebSockets on Durable Objects need shared storage: one worker, no per-file isolation
    // (Cloudflare docs, Workers Vitest integration, known issues).
    maxWorkers: 1,
    isolate: false,
  },
});
