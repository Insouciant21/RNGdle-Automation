import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cache = path.join(os.homedir(), ".cache/ms-playwright");
const chromium = fs.existsSync(cache) ? fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()
  .map((name) => path.join(cache, name, "chrome-linux64/chrome")).find((file) => fs.existsSync(file)) : undefined;

export default defineConfig({
  testDir: "test/e2e",
  workers: 1,
  use: { baseURL: "http://localhost:4322", browserName: "chromium", launchOptions: chromium ? { executablePath: chromium } : {} },
  webServer: { command: "pnpm build && node scripts/preview-test.mjs", url: "http://localhost:4322/api/status", timeout: 60000, reuseExistingServer: false },
});
