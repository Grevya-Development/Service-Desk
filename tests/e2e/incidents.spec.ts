import type { Page } from "@playwright/test";
import { test, expect, expectToast, dialog, card, ref, signedInAs } from "./support/fixtures";
import { createTicket, declareIncident, getTicket, linkTicketToIncident, resolveAllIncidents, uid } from "./support/api";

signedInAs("manoj");

/** One incident in the "Known problems right now" banner (Home, Report an issue). */
const bannerEntry = (page: Page, title: string) =>
  page.getByRole("region", { name: "Known problems right now" }).getByRole("status").filter({ hasText: title });

test.describe("incidents", () => {
  test("agent declares an incident, posts an update and links a ticket by number", async ({ page }) => {
    const title = `${uid()} Email not syncing`;
    const t = await createTicket("priya", { subject: `${uid()} Can't receive email` });

    await page.goto("/desk/incidents");
    await expect(page.getByRole("heading", { level: 1, name: "Incidents" })).toBeVisible();
    await page.getByRole("button", { name: "Declare incident" }).click();
    const d = dialog(page, "Declare an incident");
    await d.getByLabel("Title").fill(title);
    await d.getByLabel("What people see").fill("Some people can't receive email. Use Teams chat for anything urgent.");
    await d.getByLabel(/Minor/).check();
    await d.getByRole("button", { name: "Declare incident" }).click();
    await expectToast(page, "Incident declared");
    await page.waitForURL(/\/desk\/incidents\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

    // Post an update that moves it to "Identified".
    const update = card(page, "Post an update");
    await update.getByLabel(/^Identified/).check();
    await update.getByLabel("Message").fill("Found the cause: a stuck mail queue. Clearing it now.");
    await update.getByRole("button", { name: "Post update" }).click();
    await expectToast(page, "Update posted · Identified");
    await expect(card(page, "Updates").getByText("Found the cause: a stuck mail queue. Clearing it now.")).toBeVisible();

    // Link a ticket by its number.
    const linked = card(page, /Linked tickets/);
    await linked.getByLabel("Ticket numbers").fill(ref(t.number));
    await linked.getByRole("button", { name: "Link tickets" }).click();
    await expectToast(page, "Linked 1 ticket");
    await expect(linked.getByRole("link", { name: new RegExp(`${ref(t.number)}\\s+${t.subject}`) })).toBeVisible();
    expect((await getTicket("manoj", t.number)).incident_id).not.toBeNull();
  });

  test.describe("employee view", () => {
    signedInAs("priya");

    test("sees the incident on Home and Service status and says they're affected", async ({ page }) => {
      const inc = await declareIncident("manoj", `${uid()} Wi-Fi down on floor 3`, { summary: "Wi-Fi is down on the 3rd floor. Use the 2nd floor meanwhile." });

      await page.goto("/home");
      const entry = bannerEntry(page, inc.title);
      await expect(entry).toBeVisible();
      await expect(entry.getByText("Major outage")).toBeVisible();
      const toggle = entry.getByRole("button", { name: "I'm affected — notify me" });
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await toggle.click();
      await expectToast(page, "We'll let you know as soon as it's fixed");
      await expect(entry.getByRole("button", { name: "We'll notify you" })).toHaveAttribute("aria-pressed", "true");

      await page.goto("/status");
      await expect(page.getByRole("heading", { level: 1, name: "Service status" })).toBeVisible();
      await expect(page.getByText(/services? ha(s|ve) (a )?problems? right now/)).toBeVisible();
      const incidentCard = page.locator("div.rounded-xl").filter({ has: page.getByRole("heading", { level: 2, name: inc.title }) });
      await expect(incidentCard).toBeVisible();
      const sw = incidentCard.getByRole("switch");
      // Saved from Home, so it's already on here.
      await expect(sw).toHaveAttribute("aria-checked", "true");
      await expect(sw).toContainText("You'll be notified when it's fixed");
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await expect(sw).toContainText("I'm affected — notify me when it's fixed");
      await page.reload();
      await expect(page.locator("div.rounded-xl").filter({ has: page.getByRole("heading", { level: 2, name: inc.title }) }).getByRole("switch")).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });
  });

  test("resolving with “also resolve linked tickets” resolves the linked ticket", async ({ page, as }) => {
    const inc = await declareIncident("manoj", `${uid()} SSO login failing`);
    const t = await createTicket("priya", { subject: `${uid()} Can't sign in to Jira` });
    await linkTicketToIncident("manoj", t, inc.id);

    await page.goto(`/desk/incidents/${inc.id}`);
    await expect(page.getByRole("heading", { level: 1, name: inc.title })).toBeVisible();
    await card(page, "Actions").getByRole("button", { name: "Resolve incident" }).click();
    const d = dialog(page, "Resolve incident");
    await d.getByLabel("What was fixed?").fill("SSO certificate renewed. Sign in again if you were logged out.");
    const alsoTickets = d.getByRole("checkbox", { name: /Also resolve the 1 linked open ticket/ });
    await expect(alsoTickets).toBeChecked();
    await d.getByRole("button", { name: "Resolve incident" }).click();
    await expectToast(page, "Incident resolved. 1 linked ticket was resolved too.");
    await expect(page.getByText(/^Resolved on /)).toBeVisible();

    expect((await getTicket("manoj", t.number)).status).toBe("resolved");
    const requester = await as("priya");
    await requester.goto(`/requests/${t.number}`);
    await expect(requester.getByText("We think this is sorted")).toBeVisible();
    await expect(requester.getByText("SSO certificate renewed. Sign in again if you were logged out.")).toBeVisible();
  });

  test.describe("all clear", () => {
    signedInAs("priya");

    test("Service status shows all clear when no incidents are active", async ({ page }) => {
      // Includes the seeded "VPN drops…" incident and anything earlier tests left active.
      await resolveAllIncidents();
      await page.goto("/status");
      await expect(page.getByText("All services running normally")).toBeVisible();
      await expect(page.getByRole("heading", { name: /Resolved in the last 30 days/ })).toBeVisible();

      await page.goto("/home");
      await expect(page.getByRole("heading", { level: 1, name: "How can we help today?" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Known problems right now" })).toHaveCount(0);
    });
  });
});

