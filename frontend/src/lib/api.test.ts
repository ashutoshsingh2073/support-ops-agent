import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, dispatchFrame, rupees, streamChat } from "./api";
import { mockFetch } from "../test/utils";

const ID = { userId: "u1", tenantId: "acme" };

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("sends identity headers and JSON body", async () => {
    const { calls } = mockFetch({ "POST /chat": { threadId: "t", status: "complete", answer: "a", sources: [], steps: [] } });
    await api.chat({ userId: "u2", tenantId: "globex" }, "hi", "t-1");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/chat",
      headers: { "x-user-id": "u2", "x-tenant-id": "globex", "content-type": "application/json" },
      body: { message: "hi", threadId: "t-1" },
    });
  });

  it("omits threadId when starting a new thread", async () => {
    const { calls } = mockFetch({ "POST /chat": { threadId: "t", status: "complete", answer: "a", sources: [], steps: [] } });
    await api.chat(ID, "hi");
    expect(calls[0]!.body).toEqual({ message: "hi" });
  });

  it("surfaces the server's error message and status", async () => {
    mockFetch({ "POST /approve": () => ({ status: 409, body: { error: "This thread is not waiting for approval" } }) });
    const err = await api.approve(ID, "x", "approve").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("This thread is not waiting for approval");
  });

  it("reads Retry-After on 429", async () => {
    mockFetch({ "POST /chat": () => ({ status: 429, body: { error: "Too many requests" }, headers: { "Retry-After": "42" } }) });
    const err = await api.chat(ID, "hi").catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(42);
  });

  it("maps a network failure to a friendly error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = await api.health(ID).catch((e) => e);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Cannot reach the backend/);
  });

  it("maps a proxy 502 with no JSON body", async () => {
    mockFetch({ "GET /health": () => ({ status: 502, raw: "Bad Gateway" }) });
    const err = await api.health(ID).catch((e) => e);
    expect(err.message).toMatch(/proxy error/);
  });

  it("formats paise as rupees", () => {
    expect(rupees(200_000)).toBe("₹2,000.00");
    expect(rupees(0)).toBe("₹0.00");
  });
});

describe("SSE parsing", () => {
  it("dispatches each event type", () => {
    const h = { onSources: vi.fn(), onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    dispatchFrame('event: sources\ndata: [{"ref":1,"source":"a.md"}]', h);
    dispatchFrame('event: token\ndata: "Hi "', h);
    dispatchFrame("event: done\ndata: {}", h);
    dispatchFrame('event: error\ndata: "boom"', h);
    expect(h.onSources).toHaveBeenCalledWith([{ ref: 1, source: "a.md" }]);
    expect(h.onToken).toHaveBeenCalledWith("Hi ");
    expect(h.onDone).toHaveBeenCalled();
    expect(h.onError).toHaveBeenCalledWith("boom");
  });

  it("reassembles frames split across network chunks", async () => {
    const enc = new TextEncoder();
    const parts = ['event: sources\ndata: [{"ref":1,"sou', 'rce":"x.md"}]\n\nevent: token\nda', 'ta: "Hel"\n\nevent: token\ndata: "lo"\n\nevent: done\ndata: {}\n\n'];
    const body = new ReadableStream({
      start(c) {
        parts.forEach((p) => c.enqueue(enc.encode(p)));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const tokens: string[] = [];
    const onSources = vi.fn();
    const onDone = vi.fn();
    await streamChat(ID, "q", { onSources, onToken: (t) => tokens.push(t), onDone });
    expect(onSources).toHaveBeenCalledWith([{ ref: 1, source: "x.md" }]);
    expect(tokens.join("")).toBe("Hello");
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("throws the server's message on a 400", async () => {
    mockFetch({ "POST /chat/stream": () => ({ status: 400, body: { error: "Too small" } }) });
    await expect(streamChat(ID, "", {})).rejects.toThrow("Too small");
  });
});
