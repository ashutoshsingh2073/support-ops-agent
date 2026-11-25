import { expect, test, type Page } from "@playwright/test";

/**
 * Full-stack tests against the real backend. Order matters: the backend's
 * orders, refunds, tickets and audit log live in memory for the whole run.
 *   A-1001 u1 ₹2,500 · A-1002 u1 ₹450 · A-2001 u2 ₹900
 */
test.describe.configure({ mode: "serial" });

const SHOTS = process.env.SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function ask(page: Page, text: string) {
  const before = await page.getByTestId("msg-agent").count();
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: /send/i }).click();
  await expect(page.getByTestId("msg-agent")).toHaveCount(before + 1, { timeout: 10_000 });
  return page.getByTestId("msg-agent").last();
}

async function asPersona(page: Page, name: RegExp) {
  await page.goto("/identity");
  await page.getByRole("button", { name }).click();
}

// ------------------------------------------------------------------ 01 dashboard
test("dashboard shows live backend health", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toHaveText(/Backend online/);
  await expect(page.getByText("mock mode")).toBeVisible();
  await expect(page.getByTestId("stat-chunks")).toHaveText("6");
  await expect(page.getByTestId("stat-backend")).toHaveText("UP");
  await shot(page, "01-dashboard");
});

test("offline state when the backend is unreachable", async ({ page }) => {
  await page.route("**/api/**", (r) => r.abort());
  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toHaveText(/Backend offline/);
  await expect(page.getByText("OFFLINE", { exact: true })).toBeVisible();
});

// ------------------------------------------------------------------ 02 console
test("console: grounded answer with sources and steps", async ({ page }) => {
  await page.goto("/console");
  await expect(page.getByRole("button", { name: /send/i })).toBeDisabled();
  const msg = await ask(page, "When is shipping free?");
  await expect(msg).toContainText("499");
  await expect(msg.getByLabel("Sources")).toContainText("shipping.md");
  await expect(msg.getByLabel("Agent steps")).toContainText("answered from documentation");
  await expect(page.getByTestId("thread-id")).not.toHaveText(/new/);
});

test("console: refuses rather than guessing, and handles out-of-scope", async ({ page }) => {
  await page.goto("/console");
  const refusal = await ask(page, "What is your enterprise SLA for uptime credits?");
  await expect(refusal).toContainText(/could not find|hand this to a human/i);
  const oos = await ask(page, "Tell me a joke");
  await expect(oos).toContainText("I can only help with orders");
  await expect(oos).toContainText("out of scope");
});

test("console: multi-turn keeps the thread and hides stale sources on action turns", async ({ page }) => {
  await page.goto("/console");
  await ask(page, "How do I reset my password?");
  const threadId = await page.getByTestId("thread-id").textContent();
  const ticket = await ask(page, "Please raise a ticket, order A-1002 arrived damaged");
  await expect(ticket).toContainText(/Created ticket T-\d+/);
  await expect(page.getByTestId("thread-id")).toHaveText(threadId!);
  await expect(ticket.getByLabel("Sources")).toHaveCount(0);
  // Only this turn's steps, not the whole thread's.
  await expect(ticket.getByLabel("Agent steps").locator("li")).toHaveCount(2);
  await shot(page, "02-console");
});

test("console: small refund runs without approval", async ({ page }) => {
  await page.goto("/console");
  const msg = await ask(page, "Please refund ₹200 for order A-1002");
  await expect(msg).toContainText("Refunded ₹200.00 for order A-1002.");
  await expect(msg.getByLabel("Agent steps")).toContainText("refund executed");
});

test("console + approvals: large refund pauses, is approved from the queue, and is audited", async ({ page }) => {
  await page.goto("/console");
  await ask(page, "Please refund ₹2000 for order A-1001");
  const card = page.getByRole("region", { name: "Approval for A-1001" });
  await expect(card).toContainText("₹2,000.00");
  await expect(card).toContainText("status delivered, total ₹2500.00");
  await expect(page.getByLabel("Message")).toBeDisabled();
  await expect(page.getByLabel("1 pending")).toBeVisible();
  await shot(page, "03-console-approval");

  await page.getByRole("link", { name: /Approvals/ }).first().click();
  await expect(page).toHaveURL(/\/approvals/);
  const queued = page.getByRole("region", { name: "Approval for A-1001" });
  await shot(page, "04-approvals");
  await queued.getByRole("button", { name: /approve/i }).click();
  await expect(page.getByText("Nothing waiting")).toBeVisible();
  await page.getByRole("button", { name: /^resolved \(/i }).click();
  await expect(page.getByRole("region", { name: "Approval for A-1001" })).toContainText("Refunded ₹2000.00 for order A-1001.");

  // Console reflects the decision and is unlocked.
  await page.getByRole("link", { name: /Agent Console/ }).click();
  await expect(page.getByRole("region", { name: "Approval for A-1001" })).toContainText("Approved");
  await expect(page.getByLabel("Message")).toBeEnabled();

  await page.goto("/audit");
  await expect(page.getByTestId("audit-table")).toContainText("Refunded ₹2000.00 for order A-1001.");
});

test("console: rejecting a refund moves no money", async ({ page }) => {
  await page.goto("/console");
  await ask(page, "Please refund ₹1500 for order A-1001");
  await page.getByRole("region", { name: "Approval for A-1001" }).getByRole("button", { name: /reject/i }).click();
  const follow = page.getByTestId("msg-agent").last();
  await expect(follow).toContainText("The refund was not approved");
  await expect(follow).toContainText("after reject");

  await page.goto("/audit");
  await expect(page.getByTestId("audit-table")).not.toContainText("₹1500.00");
});

test("console: a user cannot refund someone else's order", async ({ page }) => {
  await asPersona(page, /Customer u2/);
  await page.goto("/console");
  await ask(page, "Please refund ₹1200 for order A-1001");
  const card = page.getByRole("region", { name: "Approval for A-1001" });
  await expect(card).toContainText("not found for this account");
  await card.getByRole("button", { name: /approve/i }).click();
  await expect(page.getByTestId("msg-agent").last()).toContainText("could not complete that refund");
  await expect(card).toContainText("Failed");
});

test("console: refund with no amount warns about the ₹0.01 behaviour", async ({ page }) => {
  await page.goto("/console");
  await ask(page, "Please refund order A-1002");
  const card = page.getByRole("region", { name: "Approval for A-1002" });
  await expect(card).toContainText("₹0.00");
  await expect(card).toContainText("refunds a token ₹0.01");
  await page.getByRole("button", { name: /new conversation/i }).click();
  await expect(page.getByLabel("Message")).toBeEnabled();
});

// ------------------------------------------------------------------ 03 stream
test("stream: sources first, then tokens, then done", async ({ page }) => {
  await page.goto("/stream");
  await page.getByLabel("Ask the knowledge base").fill("How do I reset my password?");
  await page.getByRole("button", { name: /stream answer/i }).click();
  await expect(page.getByTestId("stream-phase")).toHaveText("streaming");
  await expect(page.getByTestId("stream-phase")).toHaveText("done", { timeout: 10_000 });
  await expect(page.getByTestId("stream-output")).toContainText("Forgot password");
  await expect(page.getByLabel("Sources")).toContainText("accounts.md");
  await expect(page.getByText(/tokens: [1-9]\d*/)).toBeVisible();
  await shot(page, "05-stream");
});

test("stream: stop cancels mid-answer", async ({ page }) => {
  await page.goto("/stream");
  await page.getByLabel("Ask the knowledge base").fill("How long does a refund take to reach my bank?");
  await page.getByRole("button", { name: /stream answer/i }).click();
  await expect(page.getByTestId("stream-phase")).toHaveText("streaming");
  await page.getByRole("button", { name: /stop/i }).click();
  await expect(page.getByTestId("stream-phase")).toHaveText("stopped");
  const partial = (await page.getByTestId("stream-output").textContent()) ?? "";
  await page.waitForTimeout(800);
  expect(await page.getByTestId("stream-output").textContent()).toBe(partial);
});

// ------------------------------------------------------------------ 04 approvals
test("approvals: resuming an unknown thread shows the 409", async ({ page }) => {
  await page.goto("/approvals");
  await page.getByLabel("Thread ID", { exact: true }).fill("does-not-exist");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("alert")).toContainText("This thread is not waiting for approval (409)");
});

// ------------------------------------------------------------------ 05 knowledge
test("knowledge: ingest for one tenant, retrieve it, and it stays invisible to another", async ({ page }) => {
  await asPersona(page, /Globex u1/);
  await page.goto("/knowledge");
  await page.getByLabel("Source name").fill("globex-hours.md");
  await page.getByLabel("Content").fill("# Support hours\n\nGlobex support hours are 9am to 5pm IST, Monday to Friday.");
  await page.getByRole("button", { name: /ingest/i }).click();
  await expect(page.getByText(/Indexed “globex-hours.md” as 1 chunk/)).toBeVisible();
  await expect(page.getByTestId("ingest-history")).toContainText("globex-hours.md");

  await page.getByLabel("Test question").fill("What are the Globex support hours?");
  await page.getByRole("button", { name: "Ask" }).click();
  const res = page.getByTestId("kb-test-result");
  await expect(res).toContainText("9am to 5pm");
  await expect(res.getByLabel("Sources")).toContainText("globex-hours.md");
  await shot(page, "06-knowledge");

  await asPersona(page, /Customer u1/);
  await page.goto("/knowledge");
  await page.getByLabel("Test question").fill("What are the Globex support hours?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByTestId("kb-test-result")).not.toContainText("9am to 5pm");
});

test("knowledge: file upload fills the form", async ({ page }) => {
  await page.goto("/knowledge");
  await page.getByLabel(/Load from file/).setInputFiles({ name: "warranty.md", mimeType: "text/markdown", buffer: Buffer.from("# Warranty\n\nAll devices carry a 1 year warranty.") });
  await expect(page.getByLabel("Source name")).toHaveValue("warranty.md");
  await expect(page.getByLabel("Content")).toHaveValue(/1 year warranty/);
});

// ------------------------------------------------------------------ 06 audit
test("audit: filters by tool and is scoped to the tenant", async ({ page }) => {
  await page.goto("/audit");
  const table = page.getByTestId("audit-table");
  await expect(table).toContainText("refund_order");
  await expect(table).toContainText("create_ticket");
  await page.getByRole("button", { name: "create ticket" }).click();
  await expect(table).not.toContainText("refund_order");
  await page.getByRole("button", { name: "all" }).click();
  await shot(page, "07-audit");

  await asPersona(page, /Globex u1/);
  await page.goto("/audit");
  await expect(page.getByText("Log is empty")).toBeVisible();
});

// ------------------------------------------------------------------ 07 identity
test("identity: survives a reload and drives the headers", async ({ page }) => {
  await page.goto("/identity");
  await page.getByLabel(/User ID/).fill("u42");
  await page.getByLabel(/Tenant ID/).fill("initech");
  await page.getByRole("button", { name: "Apply" }).click();
  await shot(page, "08-identity");
  await page.reload();
  await expect(page.locator(".id-chip")).toContainText("initech");
  await expect(page.locator(".id-chip")).toContainText("u42");

  const req = page.waitForRequest((r) => r.url().includes("/api/audit"));
  await page.goto("/audit");
  expect((await req).headers()["x-tenant-id"]).toBe("initech");
});

// ------------------------------------------------------------------ misc
test("404 page", async ({ page }) => {
  await page.goto("/definitely-not-here");
  await expect(page.getByText("Nothing at this address")).toBeVisible();
  await page.getByRole("link", { name: /back to dashboard/i }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("mobile: menu toggles and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/console", "/stream", "/approvals", "/knowledge", "/audit", "/identity"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await page.getByRole("link", { name: /Live Stream/ }).click();
  await expect(page).toHaveURL(/\/stream/);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await shot(page, "09-mobile");
});

test("no console errors while touring every screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  for (const path of ["/", "/console", "/stream", "/approvals", "/knowledge", "/audit", "/identity"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(errors).toEqual([]);
});
