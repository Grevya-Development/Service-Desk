import { test as base, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { stateFile, type Role } from "./users";

type Fixtures = {
  /** Open a page signed in as another role (own browser context, closed after the test). */
  as: (role: Role) => Promise<Page>;
};

export const test = base.extend<Fixtures>({
  as: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async (role: Role) => {
      const context = await newRoleContext(browser, role);
      contexts.push(context);
      return context.newPage();
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});

export { expect };

export function newRoleContext(browser: Browser, role: Role) {
  return browser.newContext({ storageState: stateFile(role), viewport: { width: 1280, height: 900 }, locale: "en-GB", timezoneId: "Asia/Kolkata" });
}

/** Use a role's saved session for every test in the file/describe. */
export const signedInAs = (role: Role) => test.use({ storageState: stateFile(role) });

/** A sonner toast with this text. */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text }).first();
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(toast(page, text)).toBeVisible();
}

/** The open native <dialog> (Dialog component), optionally by its title. */
export function dialog(page: Page, title?: string | RegExp): Locator {
  const d = page.getByRole("dialog");
  return title ? d.filter({ has: page.getByRole("heading", { name: title }) }) : d;
}

/** Smallest valid PNG (1×1, transparent), generated in memory. */
export function tinyPng(name = "screenshot.png") {
  const buffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  return { name, mimeType: "image/png", buffer };
}

/** "SD-1042" for a ticket number. */
export const ref = (n: number) => `SD-${n}`;

/** Ticket number from a /requests/1042 or /desk/tickets/1042 URL. */
export function numberFromUrl(url: string): number {
  const m = /\/(?:requests|desk\/tickets)\/(\d+)(?:[?#]|$)/.exec(url);
  if (!m) throw new Error(`No ticket number in ${url}`);
  return Number(m[1]);
}

/** A <Card> by its header title (CardHeader renders an h3). */
export function card(page: Page, title: string | RegExp): Locator {
  return page
    .locator("div.rounded-xl")
    .filter({ has: page.getByRole("heading", { level: 3, name: title }) })
    .last();
}

/** Pick the <option> whose text contains `text` (selectOption has no partial label match). */
export async function selectByText(select: Locator, text: string) {
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  if (value === null) throw new Error(`No option containing "${text}"`);
  await select.selectOption(value);
}
