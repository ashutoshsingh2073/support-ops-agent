/**
 * Typed client for the Support Ops Agent backend.
 * Every shape here mirrors src/app.ts, src/graph.ts and src/tools.ts on the server.
 */

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export type Identity = { userId: string; tenantId: string };

export type Health = { status: string; provider: "mock" | "openai" | string; chunks: number };

export type Source = { ref: number; source: string; score: number };

export type ApprovalPayload = {
  type: "approval_required";
  action: "refund";
  orderId: string;
  amountPaise: number;
  orderInfo: string;
  question: string;
};

export type ChatComplete = {
  threadId: string;
  status: "complete";
  answer: string;
  sources: Source[];
  steps: string[];
};

export type ChatAwaiting = {
  threadId: string;
  status: "awaiting_approval";
  approval: ApprovalPayload;
  steps: string[];
};

export type ChatResponse = ChatComplete | ChatAwaiting;

export type ApproveResponse = {
  threadId: string;
  status: "complete";
  answer: string;
  steps: string[];
};

export type IngestResponse = { source: string; chunks: number };

export type AuditEntry = {
  at: string;
  tenantId: string;
  userId: string;
  tool: "get_order" | "refund_order" | "create_ticket" | string;
  args: Record<string, unknown>;
  result: string;
};

export type StreamSource = { ref: number; source: string };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function headers(id: Identity, json = true): HeadersInit {
  const h: Record<string, string> = { "x-user-id": id.userId, "x-tenant-id": id.tenantId };
  if (json) h["content-type"] = "application/json";
  return h;
}

async function request<T>(path: string, id: Identity, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers: headers(id, init.body !== undefined) });
  } catch {
    throw new ApiError(0, "Cannot reach the backend. Is it running on port 3000?");
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const serverMsg = (data as { error?: unknown } | null)?.error;
    const msg: string =
      (typeof serverMsg === "string" && serverMsg) ||
      (res.status === 502 || res.status === 504
        ? "Backend is not responding (proxy error). Is it running on port 3000?"
        : `Request failed with status ${res.status}`);
    const ra = res.headers.get("Retry-After");
    throw new ApiError(res.status, msg, ra ? Number(ra) : undefined);
  }
  return data as T;
}

export const api = {
  health: (id: Identity) => request<Health>("/health", id),

  chat: (id: Identity, message: string, threadId?: string) =>
    request<ChatResponse>("/chat", id, {
      method: "POST",
      body: JSON.stringify(threadId ? { message, threadId } : { message }),
    }),

  approve: (id: Identity, threadId: string, decision: "approve" | "reject") =>
    request<ApproveResponse>("/approve", id, {
      method: "POST",
      body: JSON.stringify({ threadId, decision }),
    }),

  ingest: (id: Identity, source: string, text: string) =>
    request<IngestResponse>("/ingest", id, {
      method: "POST",
      body: JSON.stringify({ source, text }),
    }),

  audit: (id: Identity) => request<AuditEntry[]>("/audit", id),
};

export type StreamHandlers = {
  onSources?: (sources: StreamSource[]) => void;
  onToken?: (token: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

/**
 * POST /chat/stream speaks Server-Sent Events. EventSource only does GET, so we
 * read the body with fetch and parse the `event:` / `data:` frames ourselves.
 */
export async function streamChat(
  id: Identity,
  message: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/chat/stream`, {
      method: "POST",
      headers: headers(id),
      body: JSON.stringify({ message }),
      signal,
    });
  } catch {
    if (signal?.aborted) return;
    throw new ApiError(0, "Cannot reach the backend. Is it running on port 3000?");
  }

  if (!res.ok || !res.body) {
    let msg = `Request failed with status ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        dispatchFrame(frame, handlers);
      }
    }
    if (buffer.trim()) dispatchFrame(buffer, handlers);
  } catch (err) {
    if (signal?.aborted) return;
    throw err;
  }
}

export function dispatchFrame(frame: string, h: StreamHandlers) {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return;
  let data: unknown;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }
  if (event === "sources") h.onSources?.(data as StreamSource[]);
  else if (event === "token") h.onToken?.(String(data));
  else if (event === "done") h.onDone?.();
  else if (event === "error") h.onError?.(String(data));
}

export const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
