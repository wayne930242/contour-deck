import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.CT_PORT ?? 41731);
/** The window of the prototype checks in docs/DESIGN.md: a 760 px high stage. */
const viewport = { width: 1440, height: 810 };

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport,
  },
  // Chromium by default; CT_BROWSERS=all adds Firefox and WebKit (pnpm exec playwright install firefox webkit).
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport } },
    ...(process.env.CT_BROWSERS === "all"
      ? [
          { name: "firefox", use: { ...devices["Desktop Firefox"], viewport } },
          { name: "webkit", use: { ...devices["Desktop Safari"], viewport } },
        ]
      : []),
  ],
  webServer: {
    command: `node scripts/serve.mjs ${port}`,
    url: `http://127.0.0.1:${port}/demo/index.html`,
    reuseExistingServer: false,
  },
});
