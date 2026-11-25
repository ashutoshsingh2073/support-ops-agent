import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, rupees, type AuditEntry } from "../lib/api";
import { useHealth } from "../lib/health";
import { useStore, useTenantApprovals } from "../lib/store";
import { Alert, Empty, PageHead, timeAgo } from "../components/ui";

export function summarise(audit: AuditEntry[]) {
  const refunds = audit.filter((e) => e.tool === "refund_order");
  const refundedPaise = refunds.reduce((sum, e) => sum + (Number(e.args?.amountPaise) || 0), 0);
  return {
    total: audit.length,
    refunds: refunds.length,
    refundedPaise,
    tickets: audit.filter((e) => e.tool === "create_ticket").length,
    lookups: audit.filter((e) => e.tool === "get_order").length,
  };
}

export function Dashboard() {
  const { state } = useStore();
  const { health, error: healthError, loading, refresh } = useHealth();
  const approvals = useTenantApprovals();
  const pending = approvals.filter((a) => a.status === "pending");
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAudit(await api.audit(state.identity));
      setAuditError(null);
    } catch (e) {
      setAuditError(e instanceof ApiError ? e.message : "Could not load audit log");
    }
  }, [state.identity]);

  useEffect(() => {
    void load();
  }, [load]);

  const s = summarise(audit ?? []);
  const recent = [...(audit ?? [])].reverse().slice(0, 6);

  return (
    <>
      <PageHead
        kicker="01 / Overview"
        title="Control"
        highlight="Room"
        desc={
          <>
            Live state of the support agent for tenant <strong>{state.identity.tenantId}</strong>. Answers come from the
            knowledge base with citations; refunds of ₹1,000 or more stop and wait for a human.
          </>
        }
        actions={
          <>
            <button className="btn" onClick={() => { void refresh(); void load(); }}>
              ↻ Refresh
            </button>
            <Link to="/console" className="btn btn-primary">
              Open console →
            </Link>
          </>
        }
      />

      {!loading && healthError && (
        <Alert kind="error" tag="OFFLINE">
          {healthError} Start it with <code>npm run dev</code> in the project root.
        </Alert>
      )}
      {auditError && !healthError && <Alert kind="error">{auditError}</Alert>}

      <section className="grid grid-4" aria-label="Key numbers">
        <div className={`stat ${health ? "green" : "pink"}`}>
          <span className="stat-label">Backend</span>
          <span className="stat-value" data-testid="stat-backend">{loading ? "…" : health ? "UP" : "DOWN"}</span>
          <span className="stat-foot">provider: {health?.provider ?? "—"}</span>
        </div>
        <div className="stat yellow">
          <span className="stat-label">Indexed chunks</span>
          <span className="stat-value" data-testid="stat-chunks">{health?.chunks ?? "—"}</span>
          <span className="stat-foot">all tenants, in-memory store</span>
        </div>
        <div className="stat pink">
          <span className="stat-label">Awaiting approval</span>
          <span className="stat-value" data-testid="stat-pending">{pending.length}</span>
          <span className="stat-foot">
            <Link to="/approvals">review queue →</Link>
          </span>
        </div>
        <div className="stat cyan">
          <span className="stat-label">Refunded</span>
          <span className="stat-value" data-testid="stat-refunded">{rupees(s.refundedPaise)}</span>
          <span className="stat-foot">{s.refunds} refund call(s)</span>
        </div>
      </section>

      <section className="grid grid-3 mt-lg">
        <div className="panel span-2">
          <div className="panel-head">
            <h2>Recent tool calls</h2>
            <Link to="/audit" className="btn btn-sm">Full log →</Link>
          </div>
          <div className="panel-body">
            {audit === null && !auditError ? (
              <p className="mono">Loading…</p>
            ) : recent.length === 0 ? (
              <Empty title="No tool calls yet">
                Ask the agent to refund an order or raise a ticket in the <Link to="/console">console</Link>.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="brut">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>User</th>
                      <th>Tool</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((e, i) => (
                      <tr key={`${e.at}-${i}`}>
                        <td className="mono small">{timeAgo(e.at)}</td>
                        <td className="mono">{e.userId}</td>
                        <td><ToolBadge tool={e.tool} /></td>
                        <td>{e.result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="panel yellow">
          <div className="panel-head">
            <h2>Tool counts</h2>
          </div>
          <div className="panel-body">
            <dl className="kv" style={{ fontSize: 15, gap: "10px 18px" }}>
              <dt>Total calls</dt>
              <dd data-testid="count-total">{s.total}</dd>
              <dt>Order lookups</dt>
              <dd>{s.lookups}</dd>
              <dt>Refunds</dt>
              <dd>{s.refunds}</dd>
              <dt>Tickets</dt>
              <dd>{s.tickets}</dd>
              <dt>Pending</dt>
              <dd>{pending.length}</dd>
              <dt>Resolved</dt>
              <dd>{approvals.length - pending.length}</dd>
            </dl>
          </div>
        </div>
      </section>

      <section className="panel mt-lg">
        <div className="panel-head">
          <h2>How a request flows</h2>
        </div>
        <div className="panel-body">
          <div className="flow" aria-label="Agent graph">
            <span className="node" style={{ background: "var(--ink)", color: "var(--yellow)" }}>POST /chat</span>
            <span className="arrow">→</span>
            <span className="node">classify</span>
            <span className="arrow">→</span>
            <span className="node" style={{ background: "var(--cyan)" }}>retrieve → generate</span>
            <span className="mono">|</span>
            <span className="node" style={{ background: "var(--yellow)" }}>act</span>
            <span className="arrow">→</span>
            <span className="node" style={{ background: "var(--pink)" }}>interrupt (≥ ₹1,000)</span>
            <span className="arrow">→</span>
            <span className="node" style={{ background: "var(--green)" }}>POST /approve</span>
            <span className="mono">|</span>
            <span className="node">out_of_scope</span>
          </div>
          <div className="row mt">
            <Link to="/console" className="btn btn-sm">Ask a question</Link>
            <Link to="/stream" className="btn btn-sm">Stream an answer</Link>
            <Link to="/knowledge" className="btn btn-sm">Add a document</Link>
            <Link to="/identity" className="btn btn-sm">Switch identity</Link>
          </div>
        </div>
      </section>
    </>
  );
}

export function ToolBadge({ tool }: { tool: string }) {
  const color = tool === "refund_order" ? "pink" : tool === "create_ticket" ? "yellow" : tool === "get_order" ? "cyan" : "";
  return <span className={`badge ${color}`}>{tool}</span>;
}
