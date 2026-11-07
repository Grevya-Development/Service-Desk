/**
 * Demo data for the Service Desk (teams' agents, catalog, articles, assets, tickets).
 * Wipes and recreates desk demo data only; never touches People Success tables.
 *
 *   npm run db:seed                       # local database from .env.local
 *   node scripts/seed.mjs --allow-remote  # required for a non-local SUPABASE_DB_URL
 */
import postgres from "postgres";

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error("Set SUPABASE_DB_URL");
const local = /127\.0\.0\.1|localhost/.test(url);
if (!local && !process.argv.includes("--allow-remote")) {
  console.error("Refusing to seed a remote database without --allow-remote");
  process.exit(1);
}
const sql = postgres(url, { max: 1, ssl: local ? false : "require", onnotice: () => {} });

const DAY = 864e5;
const ago = (days, hour = 11, min = 0) => {
  const d = new Date(Date.now() - days * DAY);
  // hour/min in IST
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour - 5, min - 30);
  return new Date(Math.min(t, Date.now() - 30 * 60000)).toISOString();
};
const addMin = (iso, m) => new Date(Date.parse(iso) + m * 60000).toISOString();
const dateOnly = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

try {
  const emp = Object.fromEntries((await sql`select id, email from public.employees`).map((e) => [e.email.split("@")[0], e.id]));
  const need = ["priya", "kavin", "manoj", "lakshmi", "arvind", "hr", "divya", "admin", "rahul", "sneha", "aisha", "rohan", "meera", "neha", "fatima", "karthik", "deepak"];
  for (const k of need) if (!emp[k]) throw new Error(`Missing People Success demo employee ${k}@grevya.com — run the People Success seed first`);

  const teams = Object.fromEntries((await sql`select id, key from servicedesk.teams`).map((t) => [t.key, t.id]));
  if (!teams.it || !teams.hr) throw new Error("Run migrations first");
  const cats = {};
  for (const c of await sql`select id, team_id, name from servicedesk.categories`) cats[`${c.team_id === teams.it ? "it" : "hr"}:${c.name}`] = c.id;
  const locs = Object.fromEntries((await sql`select id, name from public.locations`).map((l) => [l.name, l.id]));
  const loc = (name) => locs[name] ?? Object.values(locs)[0] ?? null;

  await sql.begin(async (tx) => {
    // ---- reset desk demo data -------------------------------------------
    await tx`delete from servicedesk.notifications`;
    await tx`delete from servicedesk.incidents`;
    await tx`delete from servicedesk.canned_responses`;
    await tx`delete from servicedesk.agent_profiles`;
    await tx`delete from servicedesk.tickets`;
    await tx`delete from servicedesk.kb_articles`;
    await tx`delete from servicedesk.catalog_items`;
    await tx`delete from servicedesk.assets`;
    await tx`delete from servicedesk.team_members`;
    await tx`delete from public.notifications where link like 'http://localhost:3200%'`;

    await tx`update servicedesk.settings set value = ${tx.json(local ? "http://localhost:3200" : "")} where key = 'app_url'`;

    // ---- team members ------------------------------------------------------
    const members = [
      [teams.it, emp.admin, "lead"],
      [teams.it, emp.arvind, "lead"],
      [teams.it, emp.manoj, "agent"],
      [teams.it, emp.lakshmi, "agent"],
      [teams.hr, emp.hr, "lead"],
      [teams.hr, emp.divya, "agent"],
    ];
    for (const [t, e, r] of members) await tx`insert into servicedesk.team_members (team_id, employee_id, role, created_at) values (${t}, ${e}, ${r}, ${ago(60)})`;

    // ---- catalog -----------------------------------------------------------
    const itemFields = {};
    const item = async (team, cat, name, description, icon, approval, priority, days, fields, sort) => {
      const [r] = await tx`insert into servicedesk.catalog_items (team_id, category_id, name, description, icon, approval, default_priority, expected_days, fields, sort_order)
        values (${teams[team]}, ${cats[`${team}:${cat}`] ?? null}, ${name}, ${description}, ${icon}, ${approval}, ${priority}, ${days}, ${tx.json(fields)}, ${sort}) returning id`;
      return r.id;
    };
    const CI = {
      laptop: await item("it", "Hardware", "New or replacement laptop", "Get a new laptop, or replace one that is old, slow or damaged.", "laptop", "manager", "medium", 5, [
        { key: "laptop_type", label: "Which laptop do you need?", type: "select", required: true, options: ["Standard 14\" (Office work)", "Developer 16\" (32 GB RAM)", "MacBook Pro 14\""] },
        { key: "reason", label: "Why do you need it?", type: "textarea", required: true, help: "e.g. new joiner, current laptop is 4+ years old, battery swollen" },
        { key: "needed_by", label: "Needed by", type: "date" },
      ], 1),
      software: await item("it", "Software", "Install software", "Request an app or tool to be installed on your laptop.", "software", "none", "low", 1, [
        { key: "software", label: "Software name", type: "text", required: true },
        { key: "licence", label: "It needs a paid licence", type: "checkbox" },
        { key: "reason", label: "What will you use it for?", type: "textarea", required: true },
      ], 2),
      access: await item("it", "Access & Accounts", "Access to a tool or system", "Get access to Jira, GitHub, AWS, Figma or another company system.", "key-round", "team_lead", "medium", 1, [
        { key: "system", label: "System", type: "select", required: true, options: ["Jira", "GitHub", "AWS Console", "Figma", "Salesforce", "Google Workspace admin"] },
        { key: "level", label: "Access level", type: "select", required: true, options: ["Read only", "Contributor", "Admin"] },
        { key: "justification", label: "Why do you need this access?", type: "textarea", required: true },
      ], 3),
      onboarding: await item("it", "Hardware", "New joiner IT setup", "Laptop, accounts and access for someone joining your team.", "user-plus", "none", "high", 3, [
        { key: "joiner", label: "Joiner's full name", type: "text", required: true },
        { key: "start_date", label: "Start date", type: "date", required: true },
        { key: "role", label: "Role", type: "text", required: true },
        { key: "extra_monitor", label: "Needs an extra monitor", type: "checkbox" },
      ], 4),
      vpn: await item("it", "Network & VPN", "VPN access", "Work securely from home or while travelling.", "shield-check", "none", "medium", 1, [
        { key: "device", label: "Device", type: "select", required: true, options: ["Company laptop", "Company phone"] },
      ], 5),
      verification: await item("hr", "Documents & Letters", "Employment verification letter", "A signed letter confirming your employment, for banks, visas or landlords.", "file-text", "none", "medium", 2, [
        { key: "purpose", label: "Purpose", type: "select", required: true, options: ["Bank / loan", "Visa", "Rental agreement", "Other"] },
        { key: "addressed_to", label: "Addressed to", type: "text", help: "Leave blank for 'To whom it may concern'" },
      ], 1),
      salary_cert: await item("hr", "Payroll", "Salary certificate", "Certificate showing your current salary breakup.", "credit-card", "none", "low", 2, [
        { key: "months", label: "For how many months?", type: "select", required: true, options: ["Last 3 months", "Last 6 months", "Last 12 months"] },
      ], 2),
      payslip_fix: await item("hr", "Payroll", "Payslip correction", "Something on your payslip looks wrong.", "badge-check", "none", "high", 3, [
        { key: "month", label: "Payslip month", type: "date", required: true },
        { key: "issue", label: "What looks wrong?", type: "textarea", required: true },
      ], 3),
    };

    // ---- knowledge base ----------------------------------------------------
    const article = async (team, cat, slug, title, summary, body, tags, views, status = "published", visibility = "everyone", author = emp.arvind) => {
      await tx`insert into servicedesk.kb_articles (team_id, category_id, slug, title, summary, body, tags, status, visibility, author_id, updated_by, view_count, published_at, created_at, updated_at)
        values (${teams[team]}, ${cats[`${team}:${cat}`] ?? null}, ${slug}, ${title}, ${summary}, ${body}, ${tags}, ${status}, ${visibility}, ${author}, ${author}, ${views},
                ${status === "published" ? ago(20) : null}, ${ago(30)}, ${ago(Math.floor(Math.random() * 20))})`;
    };
    await article("it", "Network & VPN", "connect-to-the-office-vpn", "Connect to the office VPN", "Install GlobalProtect and sign in with your Grevya account to reach internal tools from home.",
      "## Before you start\n- You need **VPN access** (request it from the [service catalog](/catalog)).\n- Use your company laptop.\n\n## Steps\n1. Open **Self Service** and install *GlobalProtect*.\n2. Enter the portal address `vpn.grevya.com`.\n3. Sign in with your Grevya email and password.\n4. Approve the sign-in on your phone.\n\n## Still not working?\n- Restart your laptop and try again.\n- Check that your home Wi-Fi works without VPN.\n- If it still fails, [report an issue](/requests/new?team=it) and include a screenshot of the error.",
      ["vpn", "remote", "network"], 342);
    await article("it", "Access & Accounts", "reset-your-grevya-password", "Reset your Grevya password", "Forgot your password or it expired? Reset it yourself in two minutes.",
      "1. Go to the Grevya sign-in page and click **Forgot password?**\n2. Enter your work email.\n3. Open the reset link we email you (check spam).\n4. Choose a new password with at least 12 characters.\n\n> Your password is the same for People Success, the Service Desk and email.\n\nLocked out after too many attempts? Wait 15 minutes, or ask IT to unlock your account.",
      ["password", "login", "account"], 518);
    await article("it", "Email & Collaboration", "set-up-email-on-your-phone", "Set up work email on your phone", "Add your Grevya mailbox to the Gmail or Outlook app on iOS and Android.",
      "## Android / iPhone\n1. Install the **Gmail** or **Outlook** app.\n2. Add account → Google → sign in with your work email.\n3. Accept the device management prompt (it only manages work data).\n\nCalendar and contacts sync automatically.",
      ["email", "mobile", "phone"], 187);
    await article("it", "Hardware", "printer-not-working", "Printer not working? Try this first", "Most printer problems are fixed by these three checks.",
      "- Make sure you're on the **office Wi-Fi** (not Guest).\n- Remove and re-add the printer `GRV-BLR-PRN-01` from *Settings → Printers*.\n- Clear stuck jobs: open the print queue and cancel everything.\n\nIf the printer shows an error on its screen, take a photo and [report an issue](/requests/new?team=it).",
      ["printer", "office"], 96);
    await article("it", "Software", "request-new-software", "How to get new software installed", "Free tools are usually installed the same day; paid licences need a quick check.",
      "Use **Install software** in the [service catalog](/catalog). Tell us what the tool is for.\n\n- Free and approved apps: installed within 1 working day.\n- Paid licences: IT checks budget with your manager first.\n\nPlease don't install unapproved software yourself — it can put company data at risk.",
      ["software", "install", "licence"], 141);
    await article("it", "Hardware", "laptop-care-and-replacement", "Laptop care and replacement policy", "When laptops are replaced, and what to do if yours is damaged or lost.",
      "## Replacement\nLaptops are replaced every **4 years**, or sooner if repair isn't worth it.\n\n## Damage or loss\n1. Report it **the same day** via [Report an issue](/requests/new?team=it).\n2. For theft, also file a police report.\n\nIT will lend you a spare laptop while yours is repaired.",
      ["laptop", "policy", "hardware"], 77);
    await article("it", "Access & Accounts", "agents-handling-access-requests", "Agents: handling access requests", "Checklist for IT agents granting tool access.",
      "1. Confirm the approval on the ticket.\n2. Grant the **lowest** access level that works.\n3. Add the user to the right group, never to individual permissions.\n4. Reply with what was granted and resolve.",
      ["internal", "access"], 23, "published", "agents");
    await article("hr", "Leave & Attendance", "how-leave-balance-is-calculated", "How your leave balance is calculated", "Casual, sick and earned leave: how much you get and how it carries forward.",
      "- **Casual leave:** 8 days, no carry forward.\n- **Sick leave:** 8 days, no carry forward.\n- **Earned leave:** 15 days, carry forward up to 30.\n\nYour live balance is on the Leave page in People Success.",
      ["leave", "balance", "policy"], 264, "published", "everyone", emp.hr);
    await article("hr", "Payroll", "download-payslip-and-form-16", "Download your payslip and Form 16", "Payslips are published on the last working day of the month.",
      "1. Open **People Success → Payroll → Payslips**.\n2. Pick the month and click **Download PDF**.\n\nForm 16 is published by **15 June** every year under *Payroll → Tax documents*.\n\nSomething wrong on your payslip? Use **Payslip correction** in the [service catalog](/catalog).",
      ["payslip", "form16", "tax"], 389, "published", "everyone", emp.hr);
    await article("hr", "Payroll", "update-bank-details", "Update your bank details", "Change the account your salary is paid into.",
      "Raise an HR request with a **cancelled cheque** or bank statement attached. Changes made before the **20th** apply to that month's salary.",
      ["bank", "salary"], 58, "published", "everyone", emp.divya);
    await article("hr", "Policies", "hybrid-work-guidelines-draft", "Hybrid work guidelines (draft)", "Draft — not yet published.", "Work in progress.", ["hybrid"], 0, "draft", "everyone", emp.hr);

    // ---- assets ------------------------------------------------------------
    const asset = async (tag, name, type, mfr, model, serial, assigned, location, purchasedDaysAgo, cost, warrantyDays, status = null, notes = null) => {
      const [r] = await tx`insert into servicedesk.assets (asset_tag, name, type, manufacturer, model, serial_number, assigned_to, location_id, purchase_date, purchase_cost, vendor, warranty_until, status, notes, created_at)
        values (${tag}, ${name}, ${type}, ${mfr}, ${model}, ${serial}, ${assigned}, ${loc(location)}, ${dateOnly(-purchasedDaysAgo)}, ${cost}, ${"Redington India"}, ${dateOnly(warrantyDays)},
                ${status ?? (assigned ? "assigned" : "in_stock")}, ${notes}, ${ago(purchasedDaysAgo)}) returning id`;
      return r.id;
    };
    const A = {
      priyaMac: await asset("GRV-LT-0007", "MacBook Pro 14\" (M3 Pro)", "laptop", "Apple", "MacBook Pro 14 M3 Pro", "C02XK1JHMD6R", emp.priya, "Bangalore", 420, 214900, 310),
      priyaMon: await asset("GRV-MN-0031", "Dell 27\" monitor", "monitor", "Dell", "P2723DE", "CN0K5J7R", emp.priya, "Bangalore", 400, 28500, 20),
      kavinMac: await asset("GRV-LT-0003", "MacBook Pro 16\" (M3 Max)", "laptop", "Apple", "MacBook Pro 16 M3 Max", "C02YL2KHMD7T", emp.kavin, "Bangalore", 500, 329900, 230),
      rahulTp: await asset("GRV-LT-0012", "ThinkPad T14 Gen 4", "laptop", "Lenovo", "T14 Gen 4", "PF4ABCD1", emp.rahul, "Bangalore", 300, 124000, 430),
      snehaTp: await asset("GRV-LT-0013", "ThinkPad T14 Gen 4", "laptop", "Lenovo", "T14 Gen 4", "PF4ABCD2", emp.sneha, "Bangalore", 300, 124000, 430),
      aishaDell: await asset("GRV-LT-0021", "Dell Latitude 5440", "laptop", "Dell", "Latitude 5440", "8XQ2LM3", emp.aisha, "Chennai", 1500, 78000, -40, null, "Battery health 61% — due for replacement"),
      rohanDell: await asset("GRV-LT-0022", "Dell Latitude 5440", "laptop", "Dell", "Latitude 5440", "8XQ2LM4", emp.rohan, "Mumbai", 700, 78000, 360),
      meeraHp: await asset("GRV-LT-0030", "HP EliteBook 840", "laptop", "HP", "EliteBook 840 G10", "5CG3XY12", emp.meera, "Bangalore", 200, 98000, 530),
      nehaMac: await asset("GRV-LT-0009", "MacBook Air 13\"", "laptop", "Apple", "MacBook Air M2", "C02ZM3LHQ6L4", emp.neha, "Bangalore", 650, 114900, 80),
      spare1: await asset("GRV-LT-0040", "ThinkPad T14 Gen 4 (spare)", "laptop", "Lenovo", "T14 Gen 4", "PF4ABCD9", null, "Bangalore", 120, 124000, 610),
      spare2: await asset("GRV-MN-0040", "Dell 24\" monitor", "monitor", "Dell", "P2422H", "CN0H8K2P", null, "Bangalore", 90, 16500, 640),
      repair: await asset("GRV-LT-0018", "ThinkPad X1 Carbon", "laptop", "Lenovo", "X1 Carbon Gen 11", "PF3XYZ77", emp.fatima, "Bangalore", 800, 165000, 15, "in_repair", "Keyboard replacement at Lenovo service centre"),
      phone: await asset("GRV-PH-0004", "iPhone 15 (test device)", "phone", "Apple", "iPhone 15", "F2LXK9QPN7", emp.manoj, "Bangalore", 260, 79900, 470),
      figma: await asset("GRV-SW-0002", "Figma Professional (5 seats)", "software_license", "Figma", "Professional", null, null, "Bangalore", 180, 72000, 185),
    };

    // ---- tickets -----------------------------------------------------------
    const tickets = [];
    // Same "- **Label:** value" list the catalog form generates, so answers aren't shown twice.
    const answersMarkdown = (fields, answers) =>
      fields
        .filter((f) => f.key in answers)
        .map((f) => {
          const v = answers[f.key];
          const shown =
            typeof v === "boolean" ? (v ? "Yes" : "No")
            : f.type === "date" ? new Date(`${v}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
            : String(v);
          return `- **${f.label.replace(/\*/g, "")}:** ${shown}`;
        })
        .join("\n");
    const ticket = async (t) => {
      if (t.item && t.form && itemFields[t.item]) t.description = answersMarkdown(itemFields[t.item], t.form);
      const row = {
        team_id: teams[t.team],
        category_id: cats[`${t.team}:${t.category}`] ?? null,
        catalog_item_id: t.item ?? null,
        requester_id: emp[t.requester],
        created_by: emp[t.creator ?? t.requester],
        assignee_id: t.assignee ? emp[t.assignee] : null,
        asset_id: t.asset ?? null,
        type: t.item ? "request" : "incident",
        subject: t.subject,
        description: t.description,
        form_data: t.form ? tx.json(t.form) : null,
        priority: t.priority,
        status: t.status,
        source: t.item ? "catalog" : t.creator ? "agent" : "portal",
        resolved_at: t.resolvedAfter != null ? addMin(t.at, t.resolvedAfter) : null,
        closed_at: t.status === "closed" ? addMin(t.at, (t.resolvedAfter ?? 60) + 7 * 1440) : null,
        pending_since: t.status === "pending" ? addMin(t.at, t.pendingAfter ?? 120) : null,
        csat_rating: t.csat ?? null,
        csat_comment: t.csatComment ?? null,
        csat_at: t.csat ? addMin(t.at, (t.resolvedAfter ?? 60) + 90) : null,
        created_at: t.at,
      };
      const [r] = await tx`insert into servicedesk.tickets ${tx(row)} returning id, number`;
      tickets.push({ ...t, id: r.id, number: r.number });
      for (const m of t.messages ?? []) {
        await tx`insert into servicedesk.ticket_messages (ticket_id, author_id, body, internal, created_at)
                 values (${r.id}, ${emp[m.by]}, ${m.body}, ${m.internal ?? false}, ${addMin(t.at, m.after)})`;
      }
      if (t.approve) {
        await tx`update servicedesk.approvals set status = ${t.approve.ok ? "approved" : "rejected"}, comment = ${t.approve.comment ?? null},
                 decided_by = ${emp[t.approve.by]}, decided_at = ${addMin(t.at, t.approve.after)} where ticket_id = ${r.id}`;
        await tx`update servicedesk.tickets set approval_status = ${t.approve.ok ? "approved" : "rejected"}, approved_at = ${t.approve.ok ? addMin(t.at, t.approve.after) : null} where id = ${r.id}`;
      }
      return r;
    };

    await ticket({ team: "it", category: "Network & VPN", requester: "priya", assignee: "manoj", priority: "high", status: "open", at: ago(0, 9, 50),
      subject: "VPN disconnects every few minutes", description: "Since this morning GlobalProtect drops every 5–10 minutes when I'm on a video call. Home Wi-Fi works fine otherwise.",
      messages: [{ by: "manoj", after: 25, body: "Thanks Priya. Can you tell me which GlobalProtect version you're on? (*Settings → About*)" }, { by: "priya", after: 40, body: "It says 6.1.4." }, { by: "manoj", after: 55, body: "Known issue with 6.1.4 on macOS 15 — pushing 6.2.1 to your laptop now.", internal: true }] });
    await ticket({ team: "it", category: "Hardware", requester: "priya", assignee: "lakshmi", priority: "medium", status: "pending", asset: A.priyaMon, at: ago(2, 14, 10), pendingAfter: 200,
      subject: "Monitor flickers when connected over USB-C", description: "The Dell monitor flickers every few seconds when I connect it with the USB-C cable. HDMI is fine.",
      messages: [{ by: "lakshmi", after: 45, body: "Could you try the spare USB-C cable from the IT desk and let me know if it still flickers?" }] });
    await ticket({ team: "it", category: "Hardware", item: CI.laptop, requester: "priya", priority: "medium", status: "new", at: ago(0, 10, 30),
      subject: "New or replacement laptop – Developer 16\" (32 GB RAM)", description: "**Which laptop do you need?** Developer 16\" (32 GB RAM)\n\n**Why do you need it?** Local LLM fine-tuning runs out of memory on 18 GB.",
      form: { laptop_type: "Developer 16\" (32 GB RAM)", reason: "Local LLM fine-tuning runs out of memory on 18 GB.", needed_by: dateOnly(14) } });
    await ticket({ team: "it", category: "Software", item: CI.software, requester: "priya", assignee: "manoj", priority: "low", status: "resolved", at: ago(9, 11, 0), resolvedAfter: 240, csat: "good", csatComment: "Quick, thanks!",
      subject: "Install software – Docker Desktop", description: "**Software name** Docker Desktop\n\n**What will you use it for?** Running local inference containers.",
      form: { software: "Docker Desktop", licence: false, reason: "Running local inference containers." },
      messages: [{ by: "manoj", after: 30, body: "Installed via Self Service — please restart once." }, { by: "priya", after: 50, body: "Works, thank you!" }] });
    await ticket({ team: "it", category: "Access & Accounts", item: CI.access, requester: "rahul", priority: "medium", status: "new", at: ago(1, 16, 0),
      subject: "Access to a tool or system – AWS Console", description: "**System** AWS Console\n\n**Access level** Contributor\n\n**Why?** Deploying the RAG demo for the client pilot.",
      form: { system: "AWS Console", level: "Contributor", justification: "Deploying the RAG demo for the client pilot." } });
    await ticket({ team: "it", category: "Access & Accounts", item: CI.access, requester: "sneha", assignee: "lakshmi", priority: "medium", status: "open", at: ago(3, 12, 0),
      subject: "Access to a tool or system – GitHub", description: "**System** GitHub\n\n**Access level** Contributor\n\n**Why?** Joining the evals repo.",
      form: { system: "GitHub", level: "Contributor", justification: "Joining the evals repo." }, approve: { ok: true, by: "arvind", after: 60, comment: "Approved." } });
    await ticket({ team: "it", category: "Email & Collaboration", requester: "aisha", priority: "urgent", status: "new", at: ago(0, 9, 35),
      subject: "Can't send email — 'mailbox full' error", description: "Every email bounces with *mailbox full*. I have client proposals due today.", });
    await ticket({ team: "it", category: "Hardware", requester: "aisha", assignee: "manoj", priority: "high", status: "open", asset: A.aishaDell, at: ago(4, 10, 0),
      subject: "Laptop battery lasts under an hour", description: "Battery drains from 100% to 0 in about 50 minutes, even on battery saver.",
      messages: [{ by: "manoj", after: 600, body: "Battery health is 61%. Ordering a replacement battery; ETA 3 working days." }] });
    await ticket({ team: "it", category: "Software", requester: "rohan", assignee: "lakshmi", priority: "medium", status: "open", at: ago(6, 15, 0),
      subject: "Salesforce keeps logging me out", description: "Salesforce asks me to sign in again every 10 minutes in Chrome." });
    await ticket({ team: "it", category: "Network & VPN", requester: "meera", assignee: "manoj", priority: "low", status: "resolved", at: ago(12, 11, 30), resolvedAfter: 300, csat: "bad", csatComment: "Took a while to get a reply.",
      subject: "Guest Wi-Fi password for client visit", description: "Need the guest Wi-Fi password for a client visiting tomorrow.",
      messages: [{ by: "manoj", after: 290, body: "Guest password for this week: `Grevya-Guest-48`." }] });
    await ticket({ team: "it", category: "Hardware", item: CI.onboarding, requester: "kavin", assignee: "lakshmi", priority: "high", status: "closed", at: ago(20, 10, 0), resolvedAfter: 1500, csat: "good",
      subject: "New joiner IT setup – Ishaan Verma", description: "**Joiner** Ishaan Verma\n\n**Start date** next Monday\n\n**Role** AI Engineer",
      form: { joiner: "Ishaan Verma", start_date: dateOnly(-13), role: "AI Engineer", extra_monitor: true },
      messages: [{ by: "lakshmi", after: 120, body: "Laptop imaged and accounts created. Collect from the IT desk on day one." }] });
    await ticket({ team: "it", category: "Other", requester: "neha", creator: "manoj", assignee: "manoj", priority: "medium", status: "open", asset: A.nehaMac, at: ago(1, 11, 15),
      subject: "Figma desktop app crashes on launch", description: "Reported in person at the IT desk. Crashes right after the splash screen." });
    await ticket({ team: "it", category: "Software", item: CI.software, requester: "fatima", priority: "low", status: "closed", at: ago(5, 13, 0), approve: null,
      subject: "Install software – Cursor", description: "**Software name** Cursor\n\n**Licence** yes", form: { software: "Cursor", licence: true, reason: "AI pair programming" },
      messages: [{ by: "arvind", after: 90, body: "We use GitHub Copilot company-wide; closing this one — ping me if Copilot doesn't cover your use case." }] });
    await ticket({ team: "it", category: "Hardware", item: CI.laptop, requester: "rohan", priority: "medium", status: "closed", at: ago(8, 12, 0),
      subject: "New or replacement laptop – MacBook Pro 14\"", description: "**Which laptop?** MacBook Pro 14\"\n\n**Why?** Prefer macOS.",
      form: { laptop_type: "MacBook Pro 14\"", reason: "Prefer macOS." }, approve: { ok: false, by: "karthik", after: 240, comment: "Current laptop is only 2 years old — let's revisit next year." } });

    await ticket({ team: "hr", category: "Payroll", item: CI.payslip_fix, requester: "priya", assignee: "divya", priority: "high", status: "open", at: ago(1, 10, 0),
      subject: "Payslip correction", description: "**Payslip month** October\n\n**What looks wrong?** Internet allowance (₹1,500) is missing.",
      form: { month: dateOnly(-30), issue: "Internet allowance (₹1,500) is missing." },
      messages: [{ by: "divya", after: 90, body: "Thanks Priya — checking with payroll. It should be added as arrears in November." }] });
    await ticket({ team: "hr", category: "Documents & Letters", item: CI.verification, requester: "rahul", assignee: "divya", priority: "medium", status: "resolved", at: ago(6, 11, 0), resolvedAfter: 900,
      subject: "Employment verification letter – Visa", description: "**Purpose** Visa\n\n**Addressed to** Consulate General of Germany",
      form: { purpose: "Visa", addressed_to: "Consulate General of Germany" },
      messages: [{ by: "divya", after: 880, body: "Your signed letter is ready — collect it from the HR desk or download it from People Success → Letters." }] });
    await ticket({ team: "hr", category: "Leave & Attendance", requester: "sneha", priority: "medium", status: "new", at: ago(0, 11, 45),
      subject: "Comp-off from last Saturday not credited", description: "I worked on Saturday for the release, but the comp-off isn't showing in my balance." });
    await ticket({ team: "hr", category: "Policies", requester: "fatima", assignee: "hr", priority: "low", status: "pending", at: ago(3, 15, 0), pendingAfter: 300,
      subject: "Can interns join the health insurance plan?", description: "Is there a way for interns to opt into the group health insurance?",
      messages: [{ by: "hr", after: 280, body: "Interns can opt in at a subsidised premium. Would you like to cover dependants too?" }] });

    // ---- reply templates ---------------------------------------------------
    const templates = [
      ["it", "Need more details", "Hi {{first_name}}, thanks for raising {{ticket}}. Could you share a screenshot of the error and when it started? That helps us fix it faster.\n\n{{agent_name}}"],
      ["it", "Restart and try again", "Hi {{first_name}}, please restart your laptop and try again. If it still happens, reply here and we'll take a closer look.\n\n{{agent_name}}"],
      ["it", "Fixed — please confirm", "Hi {{first_name}}, we've fixed this. Could you check and confirm it works for you? If not, just reply and we'll reopen it.\n\n{{agent_name}}"],
      ["hr", "Letter is ready", "Hi {{first_name}}, your letter for {{ticket}} is ready. Download it from People Success → Letters, or collect the signed copy from the HR desk.\n\n{{agent_name}}"],
      ["hr", "Checking with payroll", "Hi {{first_name}}, thanks — we're checking this with payroll and will update {{ticket}} within two working days.\n\n{{agent_name}}"],
    ];
    for (const [team, title, body] of templates) {
      await tx`insert into servicedesk.canned_responses (team_id, title, body, created_by) values (${teams[team]}, ${title}, ${body}, ${team === "it" ? emp.arvind : emp.hr})`;
    }

    // ---- an active incident with a linked ticket and an affected employee -----
    const [inc] = await tx`insert into servicedesk.incidents (team_id, title, summary, status, severity, created_by, started_at)
      values (${teams.it}, ${"VPN drops for some people working from home"}, ${"Some people on GlobalProtect 6.1.4 are being disconnected every few minutes. We're rolling out a fix — no need to raise a new ticket."}, ${"identified"}, ${"minor"}, ${emp.manoj}, ${ago(0, 10, 0)}) returning id`;
    await tx`insert into servicedesk.incident_updates (incident_id, status, body, author_id, created_at)
      values (${inc.id}, ${"identified"}, ${"Cause found: a bug in GlobalProtect 6.1.4 on macOS 15. Version 6.2.1 is being pushed to affected laptops."}, ${emp.manoj}, ${ago(0, 11, 0)})`;
    const vpn = tickets.find((t) => t.subject.startsWith("VPN disconnects"));
    if (vpn) await tx`update servicedesk.tickets set incident_id = ${inc.id} where id = ${vpn.id}`;
    await tx`insert into servicedesk.incident_subscribers (incident_id, employee_id) values (${inc.id}, ${emp.rahul})`;

    // ---- a follower (manager CC'd on a payslip question) ----------------------
    const payslip = tickets.find((t) => t.subject === "Payslip correction");
    if (payslip) await tx`insert into servicedesk.ticket_followers (ticket_id, employee_id, added_by) values (${payslip.id}, ${emp.kavin}, ${emp.priya})`;
  });

  // ---- realistic first-response stamps and SLA state ------------------------
  await sql`
    update servicedesk.tickets t set first_responded_at = m.first_at
    from (select tm.ticket_id, min(tm.created_at) as first_at from servicedesk.ticket_messages tm
          join servicedesk.tickets tk on tk.id = tm.ticket_id
          where not tm.internal and tm.author_id <> tk.requester_id group by tm.ticket_id) m
    where m.ticket_id = t.id`;
  await sql`update servicedesk.tickets set first_responded_at = null
            where id not in (select tm.ticket_id from servicedesk.ticket_messages tm join servicedesk.tickets tk on tk.id = tm.ticket_id where not tm.internal and tm.author_id <> tk.requester_id)`;
  await sql`
    update servicedesk.tickets set
      response_breached = coalesce(first_responded_at > first_response_due, false),
      resolution_breached = coalesce(resolved_at > resolution_due, false),
      sla_paused_minutes = 0`;
  await sql`delete from servicedesk.notifications`;

  const [{ count: imported }] = await sql`select servicedesk.import_hr_helpdesk() as count`;
  const [{ count: changed }] = await sql`select servicedesk.run_sla_checks() as count`;
  const [{ n }] = await sql`select count(*)::int as n from servicedesk.tickets`;
  console.log(`Seeded ${n} tickets (${imported} imported from the HR helpdesk), SLA checks touched ${changed}.`);
  console.log("Logins (password Grevya@123): priya@ employee · kavin@ manager/approver · manoj@ lakshmi@ IT agents · arvind@ IT lead · hr@ HR lead · divya@ HR agent · admin@ desk admin");
} catch (e) {
  console.error("Seed failed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
