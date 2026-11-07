import type { Page } from "@playwright/test";
import { test, expect, expectToast, dialog, card, ref, numberFromUrl, signedInAs } from "./support/fixtures";
import { getTicket } from "./support/api";
import { USERS } from "./support/users";

signedInAs("priya");

/** Priya asks for a laptop from the catalog (needs her manager's approval). Returns the ticket number. */
async function requestLaptop(page: Page, reason: string) {
  await page.goto("/catalog");
  await expect(page.getByRole("heading", { level: 1, name: "Request a service" })).toBeVisible();
  await page.getByRole("link", { name: /New or replacement laptop/ }).first().click();
  await page.waitForURL(/\/catalog\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: /New or replacement laptop/ })).toBeVisible();

  await page.getByLabel("Which laptop do you need?").selectOption('Developer 16" (32 GB RAM)');
  await page.getByLabel("Why do you need it?").fill(reason);
  await page.getByLabel("Needed by").fill(new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Submit request" }).click();
  await page.waitForURL(/\/requests\/\d+$/);
  await expectToast(page, "Request submitted");
  const number = numberFromUrl(page.url());

  await expect(page.getByText(`Waiting for approval from ${USERS.kavin.name} (your manager)`)).toBeVisible();
  await expect(card(page, /New or replacement laptop: your answers/).getByText(reason)).toBeVisible();
  return number;
}

/** The approval card for one ticket on /approvals. */
const approvalCard = (page: Page, number: number) =>
  page.locator("div.rounded-xl").filter({ has: page.getByRole("link", { name: ref(number), exact: true }) }).last();

test.describe("catalog requests with manager approval", () => {
  test("manager approves: the request opens and is assigned to an agent", async ({ page, as }) => {
    const number = await requestLaptop(page, "Local model training runs out of memory on my current laptop.");
    const before = await getTicket("priya", number);
    expect(before.status).toBe("new");
    expect(before.assignee_id).toBeNull();

    const kavin = await as("kavin");
    await kavin.goto("/approvals");
    await expect(kavin.getByRole("heading", { level: 1, name: "Approvals" })).toBeVisible();
    const item = approvalCard(kavin, number);
    await expect(item).toBeVisible();
    await expect(item.getByText("You're their manager")).toBeVisible();
    await item.getByRole("button", { name: "Approve" }).click();
    const d = dialog(kavin, `Approve ${ref(number)}?`);
    await d.getByLabel("Add a comment (optional)").fill("Approved, go ahead.");
    await d.getByRole("button", { name: "Confirm" }).click();
    await expectToast(kavin, "Request approved");
    await expect(approvalCard(kavin, number).getByRole("button", { name: "Approve" })).toHaveCount(0);

    // Requester view: approved, in progress and someone is looking after it.
    await page.reload();
    await expect(page.getByText("In progress", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/is working on it\.$/)).toBeVisible();
    const approval = card(page, "Approval");
    await expect(approval.getByText("Approved", { exact: true })).toBeVisible();
    await expect(approval.getByText("“Approved, go ahead.”")).toBeVisible();

    const after = await getTicket("priya", number);
    expect(after.status).toBe("open");
    expect(after.assignee_id).not.toBeNull();
  });

  test("manager rejects: a reason is required and the request closes", async ({ page, as }) => {
    const number = await requestLaptop(page, "Would like a bigger screen.");

    const kavin = await as("kavin");
    await kavin.goto("/approvals");
    await approvalCard(kavin, number).getByRole("button", { name: "Reject" }).click();
    const d = dialog(kavin, `Reject ${ref(number)}?`);
    const confirm = d.getByRole("button", { name: "Confirm" });
    await expect(confirm).toBeDisabled();
    await d.getByRole("textbox").fill("   ");
    await expect(confirm).toBeDisabled();
    await d.getByRole("textbox").fill("Your current laptop is under a year old.");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expectToast(kavin, "Request rejected");

    await page.reload();
    await expect(page.getByText("This request wasn't approved and is closed")).toBeVisible();
    await expect(card(page, "Approval").getByText("“Your current laptop is under a year old.”")).toBeVisible();
    expect((await getTicket("priya", number)).status).toBe("closed");
  });
});
