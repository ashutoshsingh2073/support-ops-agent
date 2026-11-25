import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { seenSteps, useDecide } from "../lib/approvals";
import { useStore, type ChatMessage } from "../lib/store";
import { Alert, ApprovalCard, PageHead, Sources, Steps } from "../components/ui";

export const SAMPLE_PROMPTS: { tag: string; text: string }[] = [
  { tag: "Docs answer", text: "When is shipping free?" },
  { tag: "Docs answer", text: "How do I reset my password?" },
  { tag: "Refusal", text: "What is your enterprise SLA for uptime credits?" },
  { tag: "Small refund (auto)", text: "Please refund ₹200 for order A-1002" },
  { tag: "Large refund (approval)", text: "Please refund ₹2000 for order A-1001" },
  { tag: "Ticket", text: "Please raise a ticket, order A-1002 arrived damaged" },
  { tag: "Out of scope", text: "Tell me a joke" },
];

export function Console() {
  const { state, dispatch } = useStore();
  const { decide, busy: deciding, error: decideError } = useDecide();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const approvalsById = new Map(state.approvals.map((a) => [a.id, a]));
  const pendingHere = state.approvals.find((a) => a.threadId === state.threadId && a.status === "pending");

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [state.messages.length, sending]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending || pendingHere) return;
    setInput("");
    setSending(true);
    const now = new Date().toISOString();
    dispatch({ type: "message", message: { id: crypto.randomUUID(), role: "user", text: message, at: now } });

    try {
      const res = await api.chat(state.identity, message, state.threadId ?? undefined);
      if (!state.threadId) dispatch({ type: "thread", threadId: res.threadId });
      // Brand-new threads start at zero; existing threads carry earlier steps.
      const newSteps = res.steps.slice(state.threadId ? seenSteps(state.messages) : 0);
      const route = newSteps.find((s) => s.startsWith("classified as "))?.replace("classified as ", "");
      const id = crypto.randomUUID();

      if (res.status === "awaiting_approval") {
        dispatch({
          type: "message",
          message: { id, role: "agent", text: res.approval.question, at: new Date().toISOString(), steps: newSteps, sources: [], route, approval: res.approval },
        });
        dispatch({
          type: "addApproval",
          item: {
            id,
            threadId: res.threadId,
            tenantId: state.identity.tenantId,
            userId: state.identity.userId,
            approval: res.approval,
            createdAt: new Date().toISOString(),
            status: "pending",
          },
        });
      } else {
        // `sources` is not reset on action turns server-side, so only show
        // them when this turn actually retrieved.
        const retrieved = newSteps.some((s) => s.startsWith("retrieved"));
        dispatch({
          type: "message",
          message: { id, role: "agent", text: res.answer, at: new Date().toISOString(), steps: newSteps, sources: retrieved ? res.sources : [], route },
        });
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 429
            ? `Rate limited — try again in ${e.retryAfter ?? 60}s.`
            : e.message
          : "Something went wrong";
      dispatch({ type: "message", message: { id: crypto.randomUUID(), role: "error", text: msg, at: new Date().toISOString() } });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <>
      <PageHead
        kicker="02 / Converse"
        title="Agent"
        highlight="Console"
        desc="Talk to the agent. Questions are answered from the knowledge base with numbered sources. Refunds and tickets run as tools, and large refunds pause here for your decision."
        actions={
          <button
            className="btn"
            onClick={() => dispatch({ type: "newConversation" })}
            disabled={sending || state.messages.length === 0}
          >
            + New conversation
          </button>
        }
      />

      <div className="chat-layout">
        <section className="panel chat-panel" aria-label="Conversation">
          <div className="panel-head">
            <h2>Thread</h2>
            <span className="badge mono" data-testid="thread-id" title="Thread ID">
              {state.threadId ?? "new — created on first message"}
            </span>
          </div>

          <div className="chat-log" ref={logRef} aria-live="polite" data-testid="chat-log">
            {state.messages.length === 0 && (
              <div className="empty" style={{ margin: "auto 0" }}>
                <h3>Say something</h3>
                <p className="muted">Pick a sample prompt on the right, or type your own below.</p>
              </div>
            )}
            {state.messages.map((m) => (
              <Message
                key={m.id}
                m={m}
                approval={approvalsById.get(m.id)}
                busy={deciding !== null}
                onDecide={(d) => {
                  const a = approvalsById.get(m.id);
                  if (a) void decide(a.threadId, d);
                }}
              />
            ))}
            {sending && (
              <div className="msg agent" aria-label="Agent is thinking">
                <div className="msg-head"><span>Agent</span></div>
                <div className="msg-body row"><span className="spinner" aria-hidden /> working…</div>
              </div>
            )}
          </div>

          {decideError && (
            <div style={{ padding: "0 16px" }}>
              <Alert kind="error">{decideError}</Alert>
            </div>
          )}
          {pendingHere && (
            <div className="mono small" style={{ padding: "8px 16px", background: "var(--pink)", borderTop: "3px solid var(--ink)" }}>
              THREAD PAUSED — approve or reject above, or start a new conversation.
            </div>
          )}
          <form className="composer" onSubmit={onSubmit}>
            <label htmlFor="chat-input" className="sr-only">Message</label>
            <input
              id="chat-input"
              ref={inputRef}
              className="input"
              placeholder={pendingHere ? "Waiting for a decision…" : "Ask a question or request a refund…"}
              value={input}
              maxLength={4000}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending || !!pendingHere}
              autoComplete="off"
            />
            <button className="btn btn-primary" type="submit" disabled={sending || !input.trim() || !!pendingHere}>
              Send ↵
            </button>
          </form>
        </section>

        <aside className="grid" style={{ gap: 20 }}>
          <section className="panel yellow">
            <div className="panel-head"><h3>Try these</h3></div>
            <div className="panel-body prompt-list">
              {SAMPLE_PROMPTS.map((p) => (
                <button key={p.text} className="prompt-btn" onClick={() => void send(p.text)} disabled={sending || !!pendingHere}>
                  <span className="tag">{p.tag}</span>
                  {p.text}
                </button>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h3>Acting as</h3></div>
            <div className="panel-body">
              <dl className="kv">
                <dt>User</dt><dd>{state.identity.userId}</dd>
                <dt>Tenant</dt><dd>{state.identity.tenantId}</dd>
              </dl>
              <Link to="/identity" className="btn btn-sm mt">Switch →</Link>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function Message({
  m,
  approval,
  busy,
  onDecide,
}: {
  m: ChatMessage;
  approval?: import("../lib/store").PendingApproval;
  busy: boolean;
  onDecide: (d: "approve" | "reject") => void;
}) {
  const time = new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (m.role === "user") {
    return (
      <div className="msg user" data-testid="msg-user">
        <div className="msg-head"><span>You</span><span>{time}</span></div>
        <div className="msg-body">{m.text}</div>
      </div>
    );
  }
  if (m.role === "error") {
    return (
      <div className="msg error" role="alert" data-testid="msg-error">
        <div className="msg-head"><span>Error</span><span>{time}</span></div>
        <div className="msg-body">{m.text}</div>
      </div>
    );
  }
  return (
    <div className="msg agent" data-testid="msg-agent">
      <div className="msg-head">
        <span>Agent {m.route && <>· {m.route.replace(/_/g, " ")}</>}{m.decision && <> · after {m.decision}</>}</span>
        <span>{time}</span>
      </div>
      {m.approval ? (
        <div style={{ padding: 12 }}>
          <ApprovalCard
            approval={m.approval}
            threadId={approval?.threadId ?? ""}
            status={approval?.status ?? "pending"}
            outcome={approval?.outcome}
            busy={busy}
            onDecide={onDecide}
          />
        </div>
      ) : (
        <div className="msg-body">{m.text}</div>
      )}
      {(m.steps.length > 0 || m.sources.length > 0) && (
        <div className="msg-meta">
          <Steps steps={m.steps} />
          <Sources sources={m.sources} />
        </div>
      )}
    </div>
  );
}
