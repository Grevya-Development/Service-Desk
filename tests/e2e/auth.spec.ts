import { test, expect, expectToast } from "./support/fixtures";
import { PASSWORD, USERS } from "./support/users";

// These tests start signed out (no storageState).

test.describe("sign in and out", () => {
  test("signs in with the right password and lands on Home", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.getByLabel("Work email").fill(USERS.priya.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/home(\?|$)/);
    await expect(page.getByRole("heading", { level: 1, name: "How can we help today?" })).toBeVisible();
    await expect(page.getByText(`, ${USERS.priya.first}`)).toBeVisible();
  });

  test("shows a clear message for a wrong password and stays on the login page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(USERS.priya.email);
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expectToast(page, "Incorrect email or password");
    await expect(page).toHaveURL(/\/login/);
    // Input is kept so the person can fix it.
    await expect(page.getByLabel("Work email")).toHaveValue(USERS.priya.email);
  });

  test("redirects a signed-out visitor to /login?next=… and returns them there after sign-in", async ({ page }) => {
    await page.goto("/requests?tab=open");
    await expect(page).toHaveURL(/\/login\?next=%2Frequests%3Ftab%3Dopen$/);
    await page.getByLabel("Work email").fill(USERS.priya.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/requests(\?|$)/);
    await expect(page.getByRole("heading", { level: 1, name: "My requests" })).toBeVisible();
  });

  // Deep links from KB articles and "My assets" carry ?team=… / ?asset=… and must survive sign-in.
  test("keeps the query string of a deep link through sign-in", async ({ page }) => {
    await page.goto("/requests/new?team=it");
    await expect(page).toHaveURL(/\/login\?next=%2Frequests%2Fnew%3Fteam%3Dit$/);
    await page.getByLabel("Work email").fill(USERS.priya.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/requests\/new\?team=it$/);
    await expect(page.getByText("Sending to")).toBeVisible();
  });

  test("signs out from the account menu", async ({ page }) => {
    // Lakshmi isn't used by other specs: sign-out revokes every session of the user.
    await page.goto("/login");
    await page.getByLabel("Work email").fill(USERS.lakshmi.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/home(\?|$)/);

    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByText(USERS.lakshmi.email)).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login(\?|$)/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    // The session is really gone: protected pages bounce back to the login page.
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login\?next=%2Fhome$/);
  });
});
