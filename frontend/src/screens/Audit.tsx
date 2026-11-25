import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type AuditEntry } from "../lib/api";
import { useStore } from "../lib/store";
import { Alert, Empty, PageHead } from "../components/ui";
import { summarise, ToolBadge } from "./Dashboard";
import { rupees } from "../lib/api";

const TOOLS = ["all", "get_order", "refund_order", "create_ticket"] as const;

export function Audit() {
  const { state } = useStore();
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tool, setTool] = useState<(typeof TOOLS)[number]>("all");
  const [query, setQuery] = useState("");
  const [auto, setAuto] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.audit(state.identity));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load audit log");
    } finally {
      setLoading(false);
    }
  }, [state.identity]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [auto, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...(rows ?? [])]
      .reverse()
      .filter((r) => tool === "all" || r.tool === tool)
      .filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q));
  }, [rows, tool, query]);

  const s = summarise(rows ?? []);

  function exportJson() {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${state.identity.tenantId}-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHead
        kicker="06 / Accountability"
        title="Audit"
        highlight="Log"
        desc={
          <>
            Every tool call the agent made for tenant <strong>{state.identity.tenantId}</strong>: order lookups, refunds and
            tickets, with arguments and results. Idempotent replays return the cached result and are not logged again.
          </>
        }
        actions={
          <>
            <button className="btn" onClick={exportJson} disabled={filtered.length === 0}>⤓ Export JSON</button>
            <button className="btn btn-primary" onClick={() => void load()} disabled={loading}>
              {loading ? <span className="spinner" aria-hidden /> : "↻"} Refresh
            </button>
          </>
        }
      />

      {error && <Alert kind="error">{error}</Alert>}

      <section className="grid grid-4" style={{ marginBottom: 24 }}>
        <div className="stat"><span className="stat-label">Entries</span><span className="stat-value">{s.total}</span></div>
        <div className="stat cyan"><span className="stat-label">Lookups</span><span className="stat-value">{s.lookups}</span></div>
        <div className="stat pink"><span className="stat-label">Refunds</span><span className="stat-value">{s.refunds}</span><span className="stat-foot">{rupees(s.refundedPaise)}</span></div>
        <div className="stat yellow"><span className="stat-label">Tickets</span><span className="stat-value">{s.tickets}</span></div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Filter by tool">
              {TOOLS.map((t) => (
                <button key={t} aria-pressed={tool === t} onClick={() => setTool(t)}>{t.replace("_", " ")}</button>
              ))}
            </div>
            <label htmlFor="audit-q" className="sr-only">Search</label>
            <input id="audit-q" className="input" placeholder="Search user, order, result…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <label className="row mono small" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> AUTO-REFRESH 5S
          </label>
        </div>
        <div className="table-wrap">
          {rows === null && !error ? (
            <p className="panel-body mono">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="panel-body">
              <Empty title={rows && rows.length ? "No matches" : "Log is empty"}>
                {rows && rows.length ? "Try a different filter." : "Tool calls appear here once the agent looks up, refunds or tickets an order."}
              </Empty>
            </div>
          ) : (
            <table className="brut" data-testid="audit-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Tool</th>
                  <th>Args</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={`${r.at}-${i}`}>
                    <td className="mono small" style={{ whiteSpace: "nowrap" }}>
                      {new Date(r.at).toLocaleString()}
                    </td>
                    <td className="mono">{r.userId}</td>
                    <td><ToolBadge tool={r.tool} /></td>
                    <td><pre className="args">{JSON.stringify(r.args, null, 1)}</pre></td>
                    <td>{r.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
