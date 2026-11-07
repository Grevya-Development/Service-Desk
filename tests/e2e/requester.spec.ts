import { test, expect, expectToast, dialog, card, selectByText, tinyPng, ref, numberFromUrl, signedInAs } from "./support/fixtures";
import { agentSetStatus, createTicket, getTicket, uid } from "./support/api";
import { TEAM } from "./support/users";

signedInAs("priya");

test.describe("requester: report an issue", () => {
  test("reports an issue end to end with an article suggestion, device and screenshot", async ({ page }) => {
    const subject = `${uid()} VPN password reset keeps failing`;
    await page.goto("/requests/new");
    await expect(page.getByRole("heading", { level: 1, name: "Report an issue" })).toBeVisible();

    // Step 1: team
    await page.getByRole("button", { name: new RegExp(TEAM.it) }).click();
    await expect(page.getByText("Sending to")).toBeVisible();

    // Step 2: topic + summary → a matching help article is suggested
    await page.getByLabel("What is it about?").selectOption({ label: "Access & Accounts" });
    await page.getByLabel("Summary").fill("reset password");
    const suggestions = page.getByText("These articles might help").locator("..");
    await expect(suggestions).toBeVisible();
    await expect(suggestions.getByRole("link", { name: /Reset your Grevya password/ })).toBeVisible();
    await page.getByLabel("Summary").fill(subject);

    await page.getByLabel("Details").fill("The reset link says it has expired every time I open it. Started this morning.");
    await page.getByText("How much is this affecting you?").locator("..").getByText("High", { exact: true }).click();
    await selectByText(page.getByLabel("Which device?"), "GRV-LT-0007");

    // Attach a generated PNG
    await page.locator('input[type="file"][name="files"]').setInputFiles(tinyPng("vpn-error.png"));
    await expect(page.getByRole("list", { name: "Files to attach" }).getByText("vpn-error.png")).toBeVisible();

    await page.getByRole("button", { name: "Submit request" }).click();
    await page.waitForURL(/\/requests\/\d+$/);
    const number = numberFromUrl(page.url());
    await expectToast(page, `${ref(number)} raised`);

    await expect(page.getByRole("heading", { level: 1, name: subject })).toBeVisible();
    await expect(card(page, "What you told us").getByRole("link", { name: /vpn-error\.png/ })).toBeVisible();
    const details = card(page, "Details");
    await expect(details.getByText(ref(number), { exact: true })).toBeVisible();
    await expect(details.getByText(TEAM.it)).toBeVisible();
    await expect(details.getByText("Access & Accounts")).toBeVisible();
    await expect(details.getByText("High", { exact: true })).toBeVisible();
    await expect(details.getByText("GRV-LT-0007", { exact: true })).toBeVisible();
    expect((await getTicket("priya", number)).status).toMatch(/new|open/);
  });

  test("replies on an open request", async ({ page }) => {
    const t = await createTicket("priya", { subject: `${uid()} Keyboard keys sticking` });
    await page.goto(`/requests/${t.number}`);
    const body = `Extra detail ${uid("note")}: it's the E and R keys.`;
    await page.getByRole("textbox", { name: "Reply" }).fill(body);
    await page.getByRole("button", { name: "Send" }).click();
    await expectToast(page, "Reply sent");
    await expect(page.getByText(body)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Reply" })).toHaveValue("");
  });

  test("closes their own request with a reason", async ({ page }) => {
    const t = await createTicket("priya", { subject: `${uid()} Printer jammed` });
    await page.goto(`/requests/${t.number}`);
    await page.getByRole("button", { name: "Close request" }).click();
    const d = dialog(page, "Close this request?");
    await d.getByLabel("Reason (optional)").fill("It started working after a restart.");
    await d.getByRole("button", { name: "Close request" }).click();
    await expectToast(page, "Ticket closed");
    await expect(page.getByText("This request is closed", { exact: true })).toBeVisible();
    await expect(page.getByText("Closed by requester: It started working after a restart.")).toBeVisible();
    // No more replying or closing on a closed request.
    await expect(page.getByRole("textbox", { name: "Reply" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close request" })).toHaveCount(0);
  });

  test("reopens a request after an agent resolves it", async ({ page, as }) => {
    const t = await createTicket("priya", { subject: `${uid()} Wi-Fi drops in meeting room` });

    // An IT agent resolves it with a note.
    const agent = await as("manoj");
    await agent.goto(`/desk/tickets/${t.number}`);
    await agent.getByRole("button", { name: "Resolve" }).click();
    const d = dialog(agent, `Resolve ${ref(t.number)}`);
    await d.getByRole("textbox").fill("Replaced the access point in the meeting room.");
    await d.getByRole("button", { name: "Confirm" }).click();
    await expectToast(agent, "Ticket resolved");

    // The requester sees it as resolved and reopens it with a reason.
    await page.goto(`/requests/${t.number}`);
    await expect(page.getByText("We think this is sorted")).toBeVisible();
    await expect(page.getByText("Replaced the access point in the meeting room.")).toBeVisible();
    await page.getByRole("button", { name: "Still broken? Reopen" }).click();
    const reopen = dialog(page, "Still not fixed?");
    await reopen.getByLabel("What's still wrong?").fill("Still dropping every ten minutes.");
    await reopen.getByRole("button", { name: "Reopen request" }).click();
    await expectToast(page, "Ticket reopened");
    await expect(page.getByText("Reopened: Still dropping every ten minutes.")).toBeVisible();
    await expect(page.getByText("We think this is sorted")).toHaveCount(0);
    expect((await getTicket("priya", t.number)).status).toBe("open");
  });

  test("rates a resolved request once", async ({ page }) => {
    const t = await createTicket("priya", { subject: `${uid()} Mouse not pairing` });
    await agentSetStatus("manoj", t, "resolved", "Paired a new receiver for you.");

    await page.goto(`/requests/${t.number}`);
    await expect(page.getByText("How did we do?")).toBeVisible();
    await page.getByText("Yes, I'm happy").click();
    await page.getByLabel("Anything you'd like to add? (optional)").fill("Fast fix, thanks!");
    await page.getByRole("button", { name: "Send feedback" }).click();
    await expectToast(page, "Thanks for the feedback!");
    await expect(page.getByText("You said you were happy with how this was handled.")).toBeVisible();

    // Only once: after a reload there is no rating form any more.
    await page.reload();
    await expect(page.getByText("You said you were happy with how this was handled.")).toBeVisible();
    await expect(page.getByText("How did we do?")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);
    expect((await getTicket("priya", t.number)).csat_rating).toBe("good");
  });

  test("someone else's request number shows the not-found page", async ({ page }) => {
    const other = await createTicket("rahul", { subject: `${uid()} Rahul's private issue` });
    // Note: the HTTP status is 200, not 404 — (desk)/loading.tsx makes Next stream the page before
    // notFound() runs, which is documented Next.js behaviour. The not-found UI is what people see.
    await page.goto(`/requests/${other.number}`);
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
    await expect(page.getByText(other.subject)).toHaveCount(0);
  });
});

test.describe("requester: following", () => {
  signedInAs("kavin");

  test("the Following tab lists the payslip request kavin was added to", async ({ page }) => {
    await page.goto("/requests?tab=following");
    await expect(page.getByRole("link", { name: /Following/ })).toBeVisible();
    const item = page.getByRole("link", { name: /Payslip correction/ });
    await expect(item).toBeVisible();
    await item.click();
    await page.waitForURL(/\/requests\/\d+$/);
    await expect(page.getByRole("heading", { level: 1, name: "Payslip correction" })).toBeVisible();
    await expect(page.getByText("You're following this request")).toBeVisible();
  });
});
