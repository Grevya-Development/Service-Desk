import type { Page } from "@playwright/test";
import { test, expect, expectToast, dialog, card, signedInAs } from "./support/fixtures";
import { uid } from "./support/api";
import { TEAM } from "./support/users";

signedInAs("arvind"); // IT team lead

const row = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });

/** Set "Low first response" to `hours` and save. */
async function setLowFirstResponse(page: Page, hours: string) {
  await page.getByLabel("Low first response unit").selectOption("hours");
  await page.getByLabel("Low first response", { exact: true }).fill(hours);
  await page.getByRole("button", { name: "Save targets" }).click();
  await expectToast(page, "SLA targets saved");
}

test.describe("administration", () => {
  test("lead edits an SLA target and restores it", async ({ page }) => {
    await page.goto("/admin/sla");
    await expect(page.getByRole("heading", { level: 1, name: "SLA targets" })).toBeVisible();
    const current = card(page, "Current targets").getByRole("listitem").filter({ hasText: "Low" });
    await expect(current).toContainText("Reply 8h");

    try {
      await setLowFirstResponse(page, "9");
      await expect(current).toContainText("Reply 9h");
      await page.reload();
      await expect(card(page, "Current targets").getByRole("listitem").filter({ hasText: "Low" })).toContainText("Reply 9h");

      // The form refuses impossible targets before saving.
      await page.getByLabel("Low first response", { exact: true }).fill("0");
      await expect(page.getByText("Enter both targets as numbers above zero.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Save targets" })).toBeDisabled();
    } finally {
      await page.goto("/admin/sla");
      await setLowFirstResponse(page, "8");
    }
    await expect(card(page, "Current targets").getByRole("listitem").filter({ hasText: "Low" })).toContainText("Reply 8h");
  });

  test("lead creates a category (employees can pick it) and deletes it", async ({ page, as }) => {
    const name = uid("E2E").slice(0, 40);
    await page.goto("/admin/categories");
    await page.getByRole("button", { name: "Add category" }).click();
    const d = dialog(page, `New category for ${TEAM.it}`);
    await d.getByLabel("Name").fill(name);
    await d.getByLabel("Description").fill("Created by the end-to-end suite.");
    await d.getByRole("button", { name: "Add category" }).click();
    await expectToast(page, "Category added");
    await expect(row(page, name)).toBeVisible();
    await expect(row(page, name).getByText("Active")).toBeVisible();

    const employee = await as("priya");
    await employee.goto("/requests/new?team=it");
    await expect(employee.getByLabel("What is it about?").locator("option", { hasText: name })).toHaveCount(1);

    await row(page, name).getByRole("button", { name: "Delete" }).click();
    await dialog(page, `Delete “${name}”? This can't be undone.`).getByRole("button", { name: "Confirm" }).click();
    await expectToast(page, "Category deleted");
    await expect(row(page, name)).toHaveCount(0);
  });

  test("lead creates a catalog item with fields, sees it in the catalog, then hides and deletes it", async ({ page, as }) => {
    const name = `${uid("E2E")} Ergonomic chair`;
    await page.goto("/admin/catalog");
    await page.getByRole("link", { name: "New item" }).click();
    await page.waitForURL(/\/admin\/catalog\/new/);

    await page.getByLabel(/^Name\*?$/).fill(name);
    await page.getByLabel("Description", { exact: true }).fill("Request an ergonomic chair for your desk.");
    await page.getByRole("button", { name: "Add the first field" }).click();
    await page.getByLabel("Question").nth(0).fill("Desk location");
    await page.getByRole("checkbox", { name: "Required" }).nth(0).check();
    await page.getByRole("button", { name: "Add another field" }).click();
    await page.getByLabel("Question").nth(1).fill("Chair size");
    await page.getByLabel("Answer type").nth(1).selectOption("select");
    await page.getByLabel("Options").fill("Small\nMedium\nLarge");
    await page.getByRole("button", { name: "Create item" }).click();
    await expectToast(page, "Catalog item created");
    await page.waitForURL(/\/admin\/catalog$/);
    await expect(row(page, name)).toBeVisible();
    await expect(row(page, name).getByText("Live")).toBeVisible();

    // Employees see it in the catalog with its form.
    const employee = await as("priya");
    await employee.goto("/catalog");
    await employee.getByRole("link", { name: new RegExp(name) }).first().click();
    await expect(employee.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(employee.getByLabel(/Desk location/)).toBeVisible();
    await expect(employee.getByLabel(/Chair size/).locator("option")).toHaveText(["Choose one (optional)", "Small", "Medium", "Large"]);

    // Hide it: gone from the catalog.
    await row(page, name).getByRole("button", { name: "Hide" }).click();
    await expectToast(page, `“${name}” is hidden from the catalog`);
    await expect(row(page, name).getByText("Hidden")).toBeVisible();
    await employee.goto("/catalog");
    await expect(employee.getByRole("heading", { level: 1, name: "Request a service" })).toBeVisible();
    await expect(employee.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);

    // Delete it (no requests yet, so it's really deleted).
    await row(page, name).getByRole("link", { name: `Edit ${name}` }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await dialog(page, `Delete “${name}”? This can't be undone.`).getByRole("button", { name: "Confirm" }).click();
    await expectToast(page, "Catalog item deleted");
    await page.waitForURL(/\/admin\/catalog$/);
    await expect(row(page, name)).toHaveCount(0);
  });

  test.describe("desk admin", () => {
    signedInAs("admin");

    test("settings rejects business hours that end before they start", async ({ page }) => {
      await page.goto("/admin/settings");
      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
      await page.getByLabel("Day starts").fill("18:00");
      await page.getByLabel("Day ends").fill("09:00");
      await page.getByRole("button", { name: "Save business hours" }).click();
      await expectToast(page, "The working day must end after it starts.");

      await page.reload();
      await expect(page.getByLabel("Day starts")).toHaveValue("09:30");
      await expect(page.getByLabel("Day ends")).toHaveValue("18:30");
    });
  });

  test("a team lead who isn't a desk admin can't open Settings", async ({ page }) => {
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/home\?denied=1$/);
  });

  test.describe("employee", () => {
    signedInAs("priya");

    for (const path of ["/desk", "/desk/tickets/1001", "/admin/sla", "/admin/catalog", "/admin/settings"]) {
      test(`is redirected away from ${path}`, async ({ page }) => {
        await page.goto(path);
        await expect(page).toHaveURL(/\/home\?denied=1$/);
        await expect(page.getByRole("alert").filter({ hasText: "That page is only for support agents or team leads" })).toBeVisible();
        await expect(page.getByRole("link", { name: /Ticket queue/ })).toHaveCount(0);
      });
    }
  });
});
