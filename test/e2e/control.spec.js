import { test, expect } from "@playwright/test";
import { bundle } from "../helpers/cloud-fixture.js";

test.beforeAll(async ({ request }) => {
  const data = await bundle();
  data.state.days["2026-10-18"] = { status: "success", emailSentAt: "2026-10-18T00:05:00Z", attempts: 1,
    result: { number: 123456, earnedEp: 100, totalEp: 200, badges: [], poem: "mountains rise" } };
  const response = await request.post("/__migration/import", { headers: { Authorization: "Bearer e2e-migration-token" }, data });
  expect(response.status()).toBe(200);
});

test("Workers runtime serves authenticated Astro views without a settings page", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.locator("#password").fill("control-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#roll-number")).toHaveText("123456");
  await expect(page.locator("#poem-text")).toHaveText("mountains rise");
  await page.getByRole("tab", { name: "Logs", exact: true }).click();
  await expect(page.locator("#log-panel")).toContainText("Backup imported");
  await page.getByRole("tab", { name: "Authentication", exact: true }).click();
  await expect(page.locator("#rngdle-account")).toHaveText("player@example.com");
  await expect(page.getByRole("tab", { name: "Settings", exact: true })).toHaveCount(0);
  const preview = await page.context().request.get("/preview/email");
  expect(preview.status()).toBe(200);
  expect(await preview.text()).toContain("123456");
  expect(preview.headers()["content-security-policy"]).toContain("default-src 'none'");
  await page.screenshot({ path: "test-results/control-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(page.locator("#roll-number")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/control-mobile.png" });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});

test("Workers rejects missing CSRF and removed endpoints, keeping deployment secrets private", async ({ request }) => {
  const login = await request.post("/api/auth/login", { data: { password: "control-test-password" } });
  expect(login.status()).toBe(200);
  const { csrfToken } = await login.json();
  const noCsrf = await request.post("/api/email/send", { data: { type: "result" } });
  expect(noCsrf.status()).toBe(403);
  for (const removed of ["/api/settings", "/api/auth/password"]) {
    const write = await request.put(removed, { headers: { "X-CSRF-Token": csrfToken }, data: {} });
    expect(write.status()).toBe(404);
  }
  const overview = await request.get("/api/overview");
  const overviewText = await overview.text();
  expect(overviewText).not.toContain("smtp-private");
  expect(overviewText).not.toContain("llm-private");
  expect(overviewText).toContain("\"time\":\"08:02\"");
  const duplicate = await request.post("/__migration/import", { headers: { Authorization: "Bearer e2e-migration-token" }, data: await bundle() });
  expect(duplicate.status()).toBe(409);
  const oversized = await request.post("/api/auth/login", { data: { password: "x".repeat(40000) } });
  expect(oversized.status()).toBe(413);
});
