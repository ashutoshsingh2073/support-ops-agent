import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HEALTH, mockFetch, renderApp } from "../test/utils";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DOCS = {
  threadId: "t-1",
  status: "complete",
  answer: "Shipping is free on orders above 499 rupees.",
  sources: [{ ref: 1, source: "shipping.md", score: 0.2 }],
  steps: ["classified as answer_from_docs", "retrieved 1 of 4 chunks above threshold", "answered from documentation"],
};

const PAUSED = {
  threadId: "t-2",
  status: "awaiting_approval",
  approval: {
    type: "approval_required",
    action: "refund",
    orderId: "A-1001",
    amountPaise: 200000,
    orderInfo: "Order A-1001: status delivered, total ₹2500.00",
    question: "Approve a refund of ₹2000.00 for A-1001?",
  },
  steps: ["classified as take_action"],
};

// ------------------------------------------------------------------ layout
describe("Layout + Dashboard", () => {
  it("shows backend online with provider and chunk count", async () => {
    mockFetch({ "GET /health": HEALTH, "GET /audit": [] });
    renderApp("/");
    expect(await screen.findByText("Backend online")).toBeInTheDocument();
    expect(screen.getByTestId("stat-chunks")).toHaveTextContent("6");
    expect(screen.getByTestId("stat-backend")).toHaveTextContent("UP");
    expect(screen.getByText("No tool calls yet")).toBeInTheDocument();
  });

  it("shows an offline banner when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    renderApp("/");
    expect(await screen.findByText("Backend offline")).toBeInTheDocument();
    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
    expect(screen.getByTestId("stat-backend")).toHaveTextContent("DOWN");
  });

  it("summarises refunds from the audit log", async () => {
    mockFetch({
      "GET /health": HEALTH,
      "GET /audit": [
        { at: new Date().toISOString(), tenantId: "acme", userId: "u1", tool: "get_order", args: { orderId: "A-1001" }, result: "Order A-1001" },
        { at: new Date().toISOString(), tenantId: "acme", userId: "u1", tool: "refund_order", args: { orderId: "A-1001", amountPaise: 200000, idempotencyKey: "k" }, result: "Refunded ₹2000.00 for order A-1001." },
      ],
    });
    renderApp("/");
    expect(await screen.findByTestId("stat-refunded")).toHaveTextContent("₹2,000.00");
    expect(screen.getByTestId("count-total")).toHaveTextContent("2");
  });

  it("renders the 404 screen for unknown routes", async () => {
    mockFetch({ "GET /health": HEALTH });
    renderApp("/nope");
    expect(screen.getByText("Nothing at this address")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ console
describe("Agent Console", () => {
  it("sends a question and renders answer, steps and sources", async () => {
    const { calls } = mockFetch({ "GET /health": HEALTH, "POST /chat": DOCS });
    renderApp("/console");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message"), "When is shipping free?");
    await user.click(screen.getByRole("button", { name: /send/i }));

    const agent = await screen.findByTestId("msg-agent");
    expect(agent).toHaveTextContent("499 rupees");
    expect(within(agent).getByLabelText("Sources")).toHaveTextContent("shipping.md");
    expect(within(agent).getByLabelText("Agent steps")).toHaveTextContent("answered from documentation");
    expect(screen.getByTestId("thread-id")).toHaveTextContent("t-1");
    expect(calls.find((c) => c.path === "/chat")!.body).toEqual({ message: "When is shipping free?" });
  });

  it("reuses the thread, shows only new steps, and hides stale sources on action turns", async () => {
    let n = 0;
    const { calls } = mockFetch({
      "GET /health": HEALTH,
      "POST /chat": () => {
        n++;
        if (n === 1) return { body: DOCS };
        return {
          body: {
            threadId: "t-1",
            status: "complete",
            answer: "Created ticket T-1000.",
            sources: DOCS.sources, // stale, as the real backend returns
            steps: [...DOCS.steps, "classified as take_action", "created a ticket"],
          },
        };
      },
    });
    renderApp("/console");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message"), "When is shipping free?{Enter}");
    await screen.findByText(/499 rupees/);
    await user.type(screen.getByLabelText("Message"), "Please raise a ticket{Enter}");
    await screen.findByText("Created ticket T-1000.");

    const agents = screen.getAllByTestId("msg-agent");
    const second = agents[1]!;
    expect(within(second).getByLabelText("Agent steps").querySelectorAll("li")).toHaveLength(2);
    expect(within(second).queryByLabelText("Sources")).toBeNull();
    expect(calls.filter((c) => c.path === "/chat")[1]!.body).toEqual({ message: "Please raise a ticket", threadId: "t-1" });
  });

  it("pauses on a large refund, locks the composer, then approves", async () => {
    const { calls } = mockFetch({
      "GET /health": HEALTH,
      "POST /chat": PAUSED,
      "POST /approve": {
        threadId: "t-2",
        status: "complete",
        answer: "Refunded ₹2000.00 for order A-1001.",
        steps: ["classified as take_action", "refund executed"],
      },
    });
    renderApp("/console");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Please refund ₹2000 for order A-1001/ }));

    const card = await screen.findByRole("region", { name: "Approval for A-1001" });
    expect(card).toHaveTextContent("₹2,000.00");
    expect(screen.getByLabelText("Message")).toBeDisabled();
    expect(screen.getByText(/THREAD PAUSED/)).toBeInTheDocument();
    expect(screen.getByLabelText("1 pending")).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(screen.getAllByTestId("msg-agent")).toHaveLength(2));
    const followUp = screen.getAllByTestId("msg-agent")[1]!;
    expect(followUp).toHaveTextContent("Refunded ₹2000.00 for order A-1001.");
    expect(followUp).toHaveTextContent("after approve");
    // only the new step, not the whole thread history
    expect(within(followUp).getByLabelText("Agent steps").querySelectorAll("li")).toHaveLength(1);
    expect(within(card).getByText("Approved")).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/approve")!.body).toEqual({ threadId: "t-2", decision: "approve" });
    expect(screen.getByLabelText("Message")).toBeEnabled();
    expect(screen.queryByLabelText("1 pending")).toBeNull();
  });

  it("shows server errors in the transcript", async () => {
    mockFetch({ "GET /health": HEALTH, "POST /chat": () => ({ status: 500, body: { error: "Internal server error" } }) });
    renderApp("/console");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message"), "hello{Enter}");
    expect(await screen.findByTestId("msg-error")).toHaveTextContent("Internal server error");
  });

  it("explains rate limiting", async () => {
    mockFetch({ "GET /health": HEALTH, "POST /chat": () => ({ status: 429, body: { error: "Too many requests" }, headers: { "Retry-After": "12" } }) });
    renderApp("/console");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message"), "hello{Enter}");
    expect(await screen.findByTestId("msg-error")).toHaveTextContent("try again in 12s");
  });
});

// ------------------------------------------------------------------ approvals
describe("Approvals", () => {
  const queued = {
    approvals: [
      { id: "m1", threadId: "t-2", tenantId: "acme", userId: "u1", createdAt: new Date().toISOString(), status: "pending" as const, approval: PAUSED.approval as never },
      { id: "m2", threadId: "t-9", tenantId: "globex", userId: "u1", createdAt: new Date().toISOString(), status: "pending" as const, approval: { ...PAUSED.approval, orderId: "G-1" } as never },
    ],
  };

  it("lists only the current tenant's approvals and rejects one", async () => {
    const { calls } = mockFetch({
      "GET /health": HEALTH,
      "POST /approve": { threadId: "t-2", status: "complete", answer: "The refund was not approved. A human agent will follow up.", steps: [] },
    });
    renderApp("/approvals", queued);
    expect(screen.getByRole("region", { name: "Approval for A-1001" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Approval for G-1" })).toBeNull();

    const user = userEvent.setup();
    await user.click(within(screen.getByRole("region", { name: "Approval for A-1001" })).getByRole("button", { name: /reject/i }));
    await waitFor(() => expect(screen.getByText("Nothing waiting")).toBeInTheDocument());
    expect(calls.find((c) => c.path === "/approve")!.body).toEqual({ threadId: "t-2", decision: "reject" });

    await user.click(screen.getByRole("button", { name: /resolved \(1\)/i }));
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });

  it("marks an approval failed when the server says the thread is no longer paused", async () => {
    mockFetch({ "GET /health": HEALTH, "POST /approve": () => ({ status: 409, body: { error: "This thread is not waiting for approval" } }) });
    renderApp("/approvals", queued);
    const user = userEvent.setup();
    await user.click(within(screen.getByRole("region", { name: "Approval for A-1001" })).getByRole("button", { name: /approve/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not waiting for approval");
    await user.click(screen.getByRole("button", { name: /resolved \(1\)/i }));
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("resumes an arbitrary thread by ID", async () => {
    const { calls } = mockFetch({ "GET /health": HEALTH, "POST /approve": { threadId: "abc", status: "complete", answer: "Refunded ₹1500.00 for order A-1001.", steps: ["refund executed"] } });
    renderApp("/approvals");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Thread ID"), "abc");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Refunded ₹1500.00 for order A-1001.")).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/approve")!.body).toEqual({ threadId: "abc", decision: "approve" });
  });
});

// ------------------------------------------------------------------ knowledge
describe("Knowledge Base", () => {
  it("ingests a document for the current tenant and records it", async () => {
    const { calls } = mockFetch({ "GET /health": HEALTH, "POST /ingest": () => ({ status: 201, body: { source: "faq.md", chunks: 2 } }) });
    renderApp("/knowledge", { identity: { userId: "u1", tenantId: "globex" } });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Source name"), "faq.md");
    await user.type(screen.getByLabelText("Content"), "Hello world");
    await user.click(screen.getByRole("button", { name: /ingest/i }));
    expect(await screen.findByText(/Indexed “faq.md” as 2 chunk/)).toBeInTheDocument();
    const call = calls.find((c) => c.path === "/ingest")!;
    expect(call.headers["x-tenant-id"]).toBe("globex");
    expect(call.body).toEqual({ source: "faq.md", text: "Hello world" });
    expect(screen.getByTestId("ingest-history")).toHaveTextContent("faq.md");
  });

  it("warns before replacing a seeded document name", async () => {
    mockFetch({ "GET /health": HEALTH });
    renderApp("/knowledge");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Source name"), "shipping.md");
    expect(screen.getByTestId("replace-warning")).toHaveTextContent("across every tenant");
  });

  it("runs a retrieval test and shows sources", async () => {
    mockFetch({ "GET /health": HEALTH, "POST /chat": DOCS });
    renderApp("/knowledge");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Test question"), "When is shipping free?");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    const result = await screen.findByTestId("kb-test-result");
    expect(result).toHaveTextContent("499 rupees");
    expect(result).toHaveTextContent("shipping.md");
  });
});

// ------------------------------------------------------------------ audit
describe("Audit Log", () => {
  const rows = [
    { at: "2026-01-01T10:00:00Z", tenantId: "acme", userId: "u1", tool: "get_order", args: { orderId: "A-1001" }, result: "Order A-1001: status delivered" },
    { at: "2026-01-01T10:01:00Z", tenantId: "acme", userId: "u1", tool: "create_ticket", args: { orderId: null, reason: "broken" }, result: "Created ticket T-1000." },
  ];

  it("renders rows newest first and filters by tool and search", async () => {
    mockFetch({ "GET /health": HEALTH, "GET /audit": rows });
    renderApp("/audit");
    const table = await screen.findByTestId("audit-table");
    const body = within(table).getAllByRole("row").slice(1);
    expect(body[0]).toHaveTextContent("Created ticket T-1000.");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "get order" }));
    expect(within(screen.getByTestId("audit-table")).getAllByRole("row")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "all" }));
    await user.type(screen.getByLabelText("Search"), "zzz");
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ identity
describe("Identity", () => {
  it("switching persona changes the headers on later calls", async () => {
    const { calls } = mockFetch({ "GET /health": HEALTH, "GET /audit": [] });
    renderApp("/identity");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Globex u1/ }));
    expect(screen.getByText(/Now acting as u1 @ globex/)).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /Audit Log/ }));
    await waitFor(() => expect(calls.some((c) => c.path === "/audit")).toBe(true));
    expect(calls.find((c) => c.path === "/audit")!.headers["x-tenant-id"]).toBe("globex");
  });

  it("applies a custom identity", async () => {
    mockFetch({ "GET /health": HEALTH });
    renderApp("/identity");
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText(/User ID/));
    await user.type(screen.getByLabelText(/User ID/), "u7");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByText(/Now acting as u7 @ acme/)).toBeInTheDocument();
  });
});
