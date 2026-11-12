import type { Page } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { createTicket, uid } from "./support/api";
import { stateFile, type Role } from "./support/users";

// Each check opens its own phone-sized (375×812) context signed in as the right role.

type Target = { name: string; role: Role; path: () => Promise<string> };

let ticketNumber: number | null = null;
/** One ticket raised by Priya, shared by the request-detail and desk-ticket checks (created on first use). */
async function ticket() {
  if (ticketNumber === null) ticketNumber = (await createTicket("priya", { subject: `${uid()} Smoke test ticket with a fairly long subject line to wrap` })).number;
  return ticketNumber;
}

const TARGETS: Target[] = [
  { name: "home", role: "priya", path: async () => "/home" },
  { name: "my requests", role: "priya", path: async () => "/requests?tab=open" },
  { name: "request detail", role: "priya", path: async () => `/requests/${await ticket()}` },
  { name: "service catalog", role: "priya", path: async () => "/catalog" },
  { name: "knowledge base", role: "priya", path: async () => "/kb" },
  { name: "service status", role: "priya", path: async () => "/status" },
  { name: "desk queue", role: "manoj", path: async () => "/desk?view=open" },
  { name: "desk ticket", role: "manoj", path: async () => `/desk/tickets/${await ticket()}` },
  { name: "admin console overview", role: "admin", path: async () => "/admin" },
  { name: "admin teams", role: "admin", path: async () => "/admin/teams" },
];

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

for (const target of TARGETS) {
  test(`${target.name}: one h1, no console errors, no horizontal scroll at 375px`, async ({ browser }) => {
    const context = await browser.newContext({
      storageState: stateFile(target.role),
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
      locale: "en-GB",
      timezoneId: "Asia/Kolkata",
    });
    const page = await context.newPage();
    const errors = collectErrors(page);
    try {
      const path = await target.path();
      const res = await page.goto(path);
      expect(res?.ok(), `HTTP status for ${path}`).toBeTruthy();
      await page.waitForLoadState("networkidle");

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const wide = [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.right > doc.clientWidth + 1 && getComputedStyle(el).position !== "fixed";
          })
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} (right=${Math.round(el.getBoundingClientRect().right)})`);
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, wide };
      });
      expect(overflow.scrollWidth, `page is wider than the screen; widest elements: ${overflow.wide.join(", ")}`).toBeLessThanOrEqual(overflow.clientWidth);

      expect(errors, "console errors").toEqual([]);
    } finally {
      await context.close();
    }
  });
}
