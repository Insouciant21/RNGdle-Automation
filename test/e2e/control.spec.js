import { test, expect } from "@playwright/test";
import { bundle } from "../helpers/cloud-fixture.js";

test.beforeAll(async ({ request }) => {
  const data = await bundle();
  data.state.days["2026-10-18"] = { status: "success", emailSentAt: "2026-10-18T00:05:00Z", attempts: 1,
    result: { number: 123456, earnedEp: 100, totalEp: 200, badges: [], poem: "mountains rise" } };
  const response = await request.post("/__migration/import", { headers: { Authorization: "Bearer e2e-migration-token" }, data });
  expect(response.status()).toBe(200);
});

test("Astro serves SSR data on routed views with transitions and no settings page", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.locator("#password").fill("control-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#roll-number")).toHaveText("123456");
  await expect(page.locator("#poem-text")).toHaveText("mountains rise");
  await expect(page.locator("#schedule-meta")).toHaveText("00:00 UTC");
  const html = await (await page.context().request.get("/")).text();
  expect(html).toContain("123456");
  expect(html).toContain("mountains rise");
  await page.getByRole("link", { name: "Logs", exact: true }).click();
  await expect(page).toHaveURL(/\/logs$/);
  await expect(page.locator("#log-panel")).toContainText("Backup imported");
  const logsHtml = await (await page.context().request.get("/logs")).text();
  expect(logsHtml).toContain("Backup imported");
  await page.getByRole("link", { name: "Authentication", exact: true }).click();
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.locator("#rngdle-account")).toHaveText("player@example.com");
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.locator("#log-panel")).toContainText("Backup imported");
  const preview = await page.context().request.get("/preview/email");
  expect(preview.status()).toBe(200);
  expect(await preview.text()).toContain("123456");
  expect(preview.headers()["content-security-policy"]).toContain("default-src 'none'");
  await page.goto("/");
  await page.screenshot({ path: "test-results/control-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
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
  expect(overviewText).not.toContain("control-test-password");
  const setup = await request.post("/api/auth/setup", { headers: { "X-CSRF-Token": csrfToken }, data: {} });
  expect(setup.status()).toBe(404);
  const setupPage = await request.get("/setup");
  expect(setupPage.status()).toBe(404);
  expect((await overview.json()).schedule).toMatchObject({ time: "00:00", timezone: "UTC" });
  const duplicate = await request.post("/__migration/import", { headers: { Authorization: "Bearer e2e-migration-token" }, data: await bundle() });
  expect(duplicate.status()).toBe(409);
  const oversized = await request.post("/api/auth/login", { data: { password: "x".repeat(40000) } });
  expect(oversized.status()).toBe(413);
});
