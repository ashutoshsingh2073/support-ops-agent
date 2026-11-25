import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApp } from "../src/app.js";
import { ingestDirectory } from "../src/rag/ingest.js";

const here = dirname(fileURLToPath(import.meta.url));
const app = createApp();

beforeAll(async () => {
  await ingestDirectory(join(here, "..", "data", "kb"));
});

describe("health", () => {
  it("reports the provider and index size", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.chunks).toBeGreaterThan(0);
  });
});

describe("validation", () => {
  it("rejects an empty message with 400", async () => {
    const res = await request(app).post("/chat").send({ message: "" });
    expect(res.status).toBe(400);
  });
});

describe("RAG", () => {
  it("answers from the knowledge base with sources", async () => {
    const res = await request(app).post("/chat").send({ message: "When is shipping free?" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("complete");
    expect(res.body.answer).toMatch(/499/);
    expect(res.body.sources.length).toBeGreaterThan(0);
  });

  it("refuses to guess when nothing relevant is retrieved", async () => {
    const res = await request(app)
      .post("/chat")
      .send({ message: "What is your enterprise SLA for uptime credits?" });
    expect(res.body.answer).toMatch(/could not find|hand this to a human/i);
  });
});

describe("human in the loop", () => {
  it("pauses a large refund and completes it after approval", async () => {
    const first = await request(app).post("/chat").send({ message: "Refund ₹2000 for order A-1001" });
    expect(first.body.status).toBe("awaiting_approval");
    expect(first.body.approval.action).toBe("refund");

    const approved = await request(app)
      .post("/approve")
      .send({ threadId: first.body.threadId, decision: "approve" });
    expect(approved.body.answer).toMatch(/Refunded/);
  });

  it("does not refund when a human rejects", async () => {
    const first = await request(app).post("/chat").send({ message: "Refund ₹1500 for order A-1002" });
    const rejected = await request(app)
      .post("/approve")
      .send({ threadId: first.body.threadId, decision: "reject" });
    expect(rejected.body.answer).toMatch(/not approved/i);
  });

  it("returns 409 when approving a thread that is not waiting", async () => {
    const res = await request(app)
      .post("/approve")
      .send({ threadId: "does-not-exist", decision: "approve" });
    expect(res.status).toBe(409);
  });
});

describe("tenant isolation", () => {
  it("does not leak another tenant's documents", async () => {
    await request(app)
      .post("/ingest")
      .set("x-tenant-id", "globex")
      .send({ source: "secret.md", text: "The Globex launch code is 12345." });

    const acme = await request(app)
      .post("/chat")
      .set("x-tenant-id", "acme")
      .send({ message: "What is the Globex launch code?" });

    expect(JSON.stringify(acme.body)).not.toMatch(/12345/);
  });
});

describe("authorisation", () => {
  it("will not touch an order belonging to another user", async () => {
    const res = await request(app)
      .post("/chat")
      .set("x-user-id", "u1")
      .send({ message: "Refund ₹900 for order A-2001" });
    const body = JSON.stringify(res.body);
    expect(body).toMatch(/not found|Approve a refund/);

    if (res.body.status === "awaiting_approval") {
      const done = await request(app)
        .post("/approve")
        .send({ threadId: res.body.threadId, decision: "approve" });
      expect(done.body.answer).toMatch(/could not complete|not found/i);
    }
  });
});
