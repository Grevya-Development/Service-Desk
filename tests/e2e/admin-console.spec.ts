import type { Page } from "@playwright/test";
import { test, expect, signedInAs } from "./support/fixtures";
import type { Role } from "./support/users";

/** Sidebar link labels, without badge counts. */
async function sidebar(page: Page) {
  const texts = await page.locator("aside nav a").allInnerTexts();
  return texts.map((t) => t.replace(/\s*\d+$/, "").trim());
}

const HELP_CENTER = ["Home", "Report an issue", "Request a service", "My requests", "Knowledge base", "My assets", "Service status"];
const CONSOLE = ["Overview", "Ticket queue", "New ticket", "Approvals", "Incidents", "Assets", "Reply templates", "Manage articles", "Reports", "Teams & agents", "Categories", "SLA targets", "Service catalog", "Settings"];

test.describe("admin console", () => {
  signedInAs("admin");

  test("desk admin sees only console pages and an overview with live numbers", async ({ page }) => {
    await page.goto("/home");
    await page.waitForURL(/\/admin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Admin console" })).toBeVisible();
    await expect(page.locator("header").getByText("Admin console", { exact: true })).toBeVisible();

    const links = await sidebar(page);
    for (const l of CONSOLE) expect(links, `console shows ${l}`).toContain(l);
    for (const l of HELP_CENTER) expect(links, `console hides ${l}`).not.toContain(l);

    const tiles = page.getByRole("region", { name: "Key numbers" }).getByRole("link");
    await expect(tiles).toHaveCount(8);
    await expect(tiles.filter({ hasText: "Open tickets" })).toContainText(/\d+/);
    for (const title of ["Tickets created and resolved", "Open tickets by team", "Where open tickets are", "Open tickets by priority", "Open tickets by age", "SLA performance", "Top categories", "Oldest open tickets", "Active incidents", "Agent workload", "Assets"]) {
      await expect(page.getByRole("heading", { level: 3, name: title, exact: true })).toBeVisible();
    }
    await expect(page.locator(".recharts-surface").first()).toBeVisible();

    // Numbers open the page behind them.
    await tiles.filter({ hasText: "Not assigned" }).click();
    await expect(page).toHaveURL(/\/desk\?view=unassigned$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ticket queue" })).toBeVisible();
  });

  test("date range presets change the period", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("navigation", { name: "Date range" }).getByRole("link", { name: "Last 7 days" }).click();
    await expect(page).toHaveURL(/\/admin\?range=7d$/);
    await expect(page.getByRole("navigation", { name: "Date range" }).getByRole("link", { name: "Last 7 days" })).toHaveAttribute("aria-current", "page");
  });

  test("switches to my requests and back", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Switch to my requests" }).click();
    await page.waitForURL(/\/home$/);
    await expect(page.getByRole("heading", { level: 1, name: "How can we help today?" })).toBeVisible();
    const links = await sidebar(page);
    expect(links).toContain("My requests");
    expect(links).toContain("Report an issue");

    // The choice sticks.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "How can we help today?" })).toBeVisible();

    await page.locator("aside").getByRole("button", { name: "Back to admin console" }).click();
    await page.waitForURL(/\/admin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Admin console" })).toBeVisible();
    await page.goto("/home");
    await page.waitForURL(/\/admin$/);
  });

  test("works on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Admin console" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Open menu" }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu.getByRole("link", { name: "Overview" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "My requests" })).toHaveCount(0);
  });
});

for (const role of ["priya", "manoj", "arvind", "hr"] as Role[]) {
  test.describe(`${role} (not a desk admin)`, () => {
    signedInAs(role);

    test("keeps the normal desk, no mode switch, and can't open the overview", async ({ page, context }) => {
      await page.goto("/home");
      await expect(page.getByRole("heading", { level: 1, name: "How can we help today?" })).toBeVisible();
      const links = await sidebar(page);
      expect(links).toContain("My requests");
      expect(links).not.toContain("Overview");
      await page.getByRole("button", { name: "Account menu" }).click();
      await expect(page.getByRole("button", { name: /Switch to my requests|Back to admin console/ })).toHaveCount(0);

      await page.goto("/admin");
      await expect(page).toHaveURL(/\/home\?denied=1$/);

      // A hand-made mode cookie changes nothing.
      await context.addCookies([{ name: "sd_mode", value: "admin", url: "http://localhost:3200" }]);
      await page.goto("/home");
      await expect(page.getByRole("heading", { level: 1, name: "How can we help today?" })).toBeVisible();
      await expect(page).toHaveURL(/\/home$/);
    });
  });
}
