import type { ReactNode } from "react";
import { rupees, type ApprovalPayload, type Source } from "../lib/api";

export function PageHead({
  kicker,
  title,
  highlight,
  desc,
  actions,
}: {
  kicker: string;
  title: string;
  highlight?: string;
  desc?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <span className="page-kicker">{kicker}</span>
        <h1 className="page-title">
          {title} {highlight && <span className="hl">{highlight}</span>}
        </h1>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

export function Alert({ kind, tag, children }: { kind: "error" | "ok" | "info" | "warn"; tag?: string; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span className="alert-tag">{tag ?? (kind === "error" ? "ERR" : kind === "ok" ? "OK" : kind === "warn" ? "!" : "i")}</span>
      <div>{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Steps({ steps }: { steps: string[] }) {
  if (!steps.length) return null;
  return (
    <ol className="steps" aria-label="Agent steps">
      {steps.map((s, i) => (
        <li key={`${i}-${s}`}>{s}</li>
      ))}
    </ol>
  );
}

export function Sources({ sources, showScore = true }: { sources: { ref: number; source: string; score?: number }[]; showScore?: boolean }) {
  if (!sources.length) return null;
  return (
    <div className="sources" aria-label="Sources">
      {sources.map((s) => (
        <span className="source-chip" key={`${s.ref}-${s.source}`}>
          <span className="ref">[{s.ref}]</span>
          <span className="name">{s.source}</span>
          {showScore && typeof s.score === "number" && <span className="score">{s.score.toFixed(3)}</span>}
        </span>
      ))}
    </div>
  );
}

export type SourceList = Source[];

export function ApprovalCard({
  approval,
  threadId,
  status = "pending",
  outcome,
  busy,
  onDecide,
  compact,
}: {
  approval: ApprovalPayload;
  threadId: string;
  status?: "pending" | "approved" | "rejected" | "failed";
  outcome?: string;
  busy?: boolean;
  onDecide?: (d: "approve" | "reject") => void;
  compact?: boolean;
}) {
  const label =
    status === "pending" ? "Human approval required" : status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Failed";
  return (
    <section className={`approval ${status === "pending" ? "" : `done-${status}`}`} aria-label={`Approval for ${approval.orderId}`}>
      <div className="approval-head">
        <span>{label}</span>
      </div>
      <div className="approval-body">
        <div className="row">
          <span className="approval-amount">{rupees(approval.amountPaise)}</span>
          <span className="badge ink">{approval.action}</span>
          <span className="badge yellow">{approval.orderId}</span>
        </div>
        <p className="approval-q">{approval.question}</p>
        {approval.amountPaise === 0 && (
          <Alert kind="warn" tag="!">
            No amount was given in the request. Approving refunds a token ₹0.01 (backend behaviour).
          </Alert>
        )}
        {!compact && (
          <dl className="kv">
            <dt>Order</dt>
            <dd>{approval.orderInfo}</dd>
            <dt>Thread</dt>
            <dd>{threadId}</dd>
          </dl>
        )}
        {outcome && (
          <p className="mono small">
            <strong>RESULT:</strong> {outcome}
          </p>
        )}
        {status === "pending" && onDecide && (
          <div className="approval-actions">
            <button className="btn btn-green" disabled={busy} onClick={() => onDecide("approve")}>
              {busy ? <span className="spinner" aria-hidden /> : "✓"} Approve
            </button>
            <button className="btn btn-red" disabled={busy} onClick={() => onDecide("reject")}>
              ✕ Reject
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function StatusDot({ state }: { state: "live" | "down" | "wait" }) {
  return <span className={`dot ${state}`} aria-hidden />;
}

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}
