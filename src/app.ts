import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Command } from "@langchain/langgraph";
import { config } from "./config.js";
import { graph } from "./graph.js";
import { planner } from "./llm.js";
import { store } from "./rag/store.js";
import { ingestText } from "./rag/ingest.js";
import { auditLog } from "./tools.js";

export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Stand-in for real auth. A JWT middleware would populate exactly these fields;
 * every downstream query and tool call is scoped to them.
 */
function authenticate(req: Request, _res: Response, next: NextFunction) {
  req.user = {
    userId: (req.header("x-user-id") ?? "u1").slice(0, 64),
    tenantId: (req.header("x-tenant-id") ?? "acme").slice(0, 64),
  };
  next();
}

/** Fixed-window limiter. Single-process only — in production the counters live in Redis. */
const hits = new Map<string, { count: number; windowStart: number }>();
function rateLimit(limit = config.RATE_LIMIT_PER_MINUTE, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.user?.tenantId}:${req.user?.userId}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      return next();
    }
    if (++entry.count > limit) {
      res.setHeader("Retry-After", Math.ceil((entry.windowStart + windowMs - now) / 1000));
      return next(new AppError(429, "Too many requests"));
    }
    next();
  };
}

const ChatBody = z.object({
  message: z.string().min(1).max(4000),
  threadId: z.string().min(1).max(100).optional(),
});
const ApproveBody = z.object({
  threadId: z.string().min(1).max(100),
  decision: z.enum(["approve", "reject"]),
});
const IngestBody = z.object({
  source: z.string().min(1).max(200),
  text: z.string().min(1).max(500_000),
});

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(authenticate);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", provider: config.LLM_PROVIDER, chunks: store.size });
  });

  // ------------------------------------------------------ ingestion
  app.post("/ingest", rateLimit(), async (req, res) => {
    const body = IngestBody.safeParse(req.body);
    if (!body.success) throw new AppError(400, body.error.issues[0]!.message);
    const count = await ingestText(body.data.source, body.data.text, req.user!.tenantId);
    res.status(201).json({ source: body.data.source, chunks: count });
  });

  // ------------------------------------------------------ chat (JSON)
  app.post("/chat", rateLimit(), async (req, res) => {
    const body = ChatBody.safeParse(req.body);
    if (!body.success) throw new AppError(400, body.error.issues[0]!.message);

    const threadId = body.data.threadId ?? randomUUID();
    const cfg = { configurable: { thread_id: threadId } };

    const result = await graph.invoke(
      {
        question: body.data.message,
        userId: req.user!.userId,
        tenantId: req.user!.tenantId,
      },
      cfg,
    );

    // If a node called interrupt(), the run is paused and the payload is waiting
    // on the thread's state. The client shows it and calls /approve.
    const snapshot = await graph.getState(cfg);
    const pending = snapshot.tasks.find((t) => t.interrupts?.length)?.interrupts?.[0];
    if (pending) {
      return res.json({ threadId, status: "awaiting_approval", approval: pending.value, steps: result.steps });
    }

    res.json({
      threadId,
      status: "complete",
      answer: result.answer,
      sources: result.sources,
      steps: result.steps,
    });
  });

  // ------------------------------------------------------ resume after a human decides
  app.post("/approve", rateLimit(), async (req, res) => {
    const body = ApproveBody.safeParse(req.body);
    if (!body.success) throw new AppError(400, body.error.issues[0]!.message);

    const cfg = { configurable: { thread_id: body.data.threadId } };
    const snapshot = await graph.getState(cfg);
    if (!snapshot.tasks.some((t) => t.interrupts?.length)) {
      throw new AppError(409, "This thread is not waiting for approval");
    }

    const result = await graph.invoke(new Command({ resume: body.data.decision }), cfg);
    res.json({ threadId: body.data.threadId, status: "complete", answer: result.answer, steps: result.steps });
  });

  // ------------------------------------------------------ streaming answer (SSE)
  app.post("/chat/stream", rateLimit(), async (req, res) => {
    const body = ChatBody.safeParse(req.body);
    if (!body.success) throw new AppError(400, body.error.issues[0]!.message);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    // Stop generating the moment the user navigates away — otherwise we pay for
    // tokens nobody will ever read.
    // Listen on the *response*: `req`'s "close" fires as soon as the request
    // body has been read, which would abort every stream immediately.
    const controller = new AbortController();
    res.on("close", () => controller.abort());

    try {
      const hitsFound = await store.search(body.data.message, req.user!.tenantId);
      const relevant = hitsFound.filter((h) => h.score >= config.RELEVANCE_THRESHOLD);
      send("sources", relevant.map((h, i) => ({ ref: i + 1, source: h.chunk.metadata.source })));

      const context = relevant
        .map((h, i) => `[${i + 1}] (${h.chunk.metadata.source})\n${h.chunk.text}`)
        .join("\n\n");

      for await (const token of planner.stream(body.data.message, context)) {
        if (controller.signal.aborted) break;
        send("token", token);
      }
      send("done", {});
    } catch {
      if (!controller.signal.aborted) send("error", "Something went wrong");
    } finally {
      res.end();
    }
  });

  app.get("/audit", (req, res) => {
    res.json(auditLog.filter((e) => e.tenantId === req.user!.tenantId));
  });

  // ------------------------------------------------------ one error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { userId: string; tenantId: string };
    }
  }
}
