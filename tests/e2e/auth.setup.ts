import fs from "node:fs";
import path from "node:path";
import { test as setup, expect } from "@playwright/test";
import { PASSWORD, ROLES, USERS, stateFile } from "./support/users";

// Sign in once per demo user through the real login form and keep the session cookies.
setup.describe.configure({ mode: "serial" });

for (const role of ROLES) {
  setup(`sign in as ${role}`, async ({ page }) => {
    fs.mkdirSync(path.dirname(stateFile(role)), { recursive: true });
    await page.goto("/login");
    await page.getByLabel("Work email").fill(USERS[role].email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    if (role === "admin") {
      // Desk admins start in the admin console.
      await page.waitForURL(/\/admin$/);
      await expect(page.getByRole("heading", { level: 1, name: "Admin console" })).toBeVisible();
    } else {
      await page.waitForURL(/\/home(\?|$)/);
      await expect(page.getByRole("heading", { level: 1, name: "How can we help today?" })).toBeVisible();
    }
    await page.context().storageState({ path: stateFile(role) });
  });
}
