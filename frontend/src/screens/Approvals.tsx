import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type ApproveResponse } from "../lib/api";
import { useDecide } from "../lib/approvals";
import { useStore, useTenantApprovals } from "../lib/store";
import { Alert, ApprovalCard, Empty, PageHead, Steps, timeAgo } from "../components/ui";

type Filter = "pending" | "resolved" | "all";

export function Approvals() {
  const { state, dispatch } = useStore();
  const items = useTenantApprovals();
  const { decide, busy, error } = useDecide();
  const [filter, setFilter] = useState<Filter>("pending");

  const counts = {
    pending: items.filter((a) => a.status === "pending").length,
    resolved: items.filter((a) => a.status !== "pending").length,
    all: items.length,
  };
  const shown = items.filter((a) => (filter === "all" ? true : filter === "pending" ? a.status === "pending" : a.status !== "pending"));

  return (
    <>
      <PageHead
        kicker="04 / Human in the loop"
        title="Approval"
        highlight="Queue"
        desc={
          <>
            Refunds of ₹1,000 or more, or with no amount, pause the agent. Its state is saved on the thread, and nothing moves
            until a human decides here. Showing tenant <strong>{state.identity.tenantId}</strong>.
          </>
        }
        actions={
          <button className="btn" onClick={() => dispatch({ type: "clearResolved" })} disabled={counts.resolved === 0}>
            Clear resolved
          </button>
        }
      />

      {error && <Alert kind="error">{error}</Alert>}

      <div className="toolbar" style={{ marginBottom: 20 }}>
        <div className="seg" role="group" aria-label="Filter approvals">
          {(["pending", "resolved", "all"] as Filter[]).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f} ({counts[f]})
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <Empty title={filter === "pending" ? "Nothing waiting" : "Nothing here"}>
          Ask for a large refund in the <Link to="/console">console</Link>, for example “Please refund ₹2000 for order
          A-1001”.
        </Empty>
      ) : (
        <div className="grid grid-2">
          {shown.map((a) => (
            <div key={a.id}>
              <div className="mono small" style={{ marginBottom: 6 }}>
                raised {timeAgo(a.createdAt)} by <strong>{a.userId}</strong>
                {a.decidedAt && <> · decided {timeAgo(a.decidedAt)}</>}
              </div>
              <ApprovalCard
                approval={a.approval}
                threadId={a.threadId}
                status={a.status}
                outcome={a.outcome}
                busy={busy === a.threadId}
                onDecide={(d) => void decide(a.threadId, d)}
              />
            </div>
          ))}
        </div>
      )}

      <ManualResume />
    </>
  );
}

/** For threads paused outside this browser (curl, another tab, another operator). */
function ManualResume() {
  const { state } = useStore();
  const [threadId, setThreadId] = useState("");
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApproveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      setResult(await api.approve(state.identity, threadId.trim(), decision));
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message}${err.status ? ` (${err.status})` : ""}` : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel mt-lg" onSubmit={submit} aria-label="Resume by thread ID">
      <div className="panel-head"><h2>Resume a thread by ID</h2></div>
      <div className="panel-body">
        <p className="hint" style={{ marginBottom: 14 }}>
          For a thread paused somewhere else, such as curl, another browser or another operator. Paste its <code>threadId</code>.
        </p>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "1 1 280px", marginBottom: 0 }}>
            <label className="label" htmlFor="manual-thread">Thread ID</label>
            <input id="manual-thread" className="input" value={threadId} maxLength={100} onChange={(e) => setThreadId(e.target.value)} placeholder="e.g. 3f2b…" />
          </div>
          <div className="seg" role="group" aria-label="Decision">
            <button type="button" aria-pressed={decision === "approve"} onClick={() => setDecision("approve")}>Approve</button>
            <button type="button" aria-pressed={decision === "reject"} onClick={() => setDecision("reject")}>Reject</button>
          </div>
          <button className="btn btn-ink" disabled={busy || !threadId.trim()}>Submit</button>
        </div>
        {error && <div className="mt"><Alert kind="error">{error}</Alert></div>}
        {result && (
          <div className="mt">
            <Alert kind="ok">{result.answer}</Alert>
            <Steps steps={result.steps} />
          </div>
        )}
      </div>
    </form>
  );
}
