import { useState, type FormEvent } from "react";
import { useStore } from "../lib/store";
import { Alert, PageHead } from "../components/ui";

export const PERSONAS = [
  { userId: "u1", tenantId: "acme", name: "Customer u1", note: "Owns orders A-1001 (₹2,500) and A-1002 (₹450). Sees the seeded help centre." },
  { userId: "u2", tenantId: "acme", name: "Customer u2", note: "Owns order A-2001 (₹900). Same tenant, different user. Cannot touch u1's orders." },
  { userId: "u1", tenantId: "globex", name: "Globex u1", note: "A different tenant with an empty knowledge base. Shows tenant isolation." },
];

export function Identity() {
  const { state, dispatch } = useStore();
  const [userId, setUserId] = useState(state.identity.userId);
  const [tenantId, setTenantId] = useState(state.identity.tenantId);
  const [msg, setMsg] = useState<string | null>(null);

  function apply(id: { userId: string; tenantId: string }) {
    dispatch({ type: "identity", identity: id });
    setUserId(id.userId);
    setTenantId(id.tenantId);
    setMsg(`Now acting as ${id.userId} @ ${id.tenantId}. The console conversation was reset.`);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    apply({ userId: userId.trim().slice(0, 64), tenantId: tenantId.trim().slice(0, 64) });
  }

  return (
    <>
      <PageHead
        kicker="07 / Who am I"
        title="Identity"
        highlight="Switch"
        desc={
          <>
            The backend reads identity from the <code>x-user-id</code> and <code>x-tenant-id</code> headers, which stand in for a
            JWT. Every retrieval, tool call and audit query is scoped to them. Switch here to test isolation.
          </>
        }
      />

      {msg && <Alert kind="ok">{msg}</Alert>}

      <section className="grid grid-3" aria-label="Personas">
        {PERSONAS.map((p) => {
          const active = p.userId === state.identity.userId && p.tenantId === state.identity.tenantId;
          return (
            <button key={`${p.tenantId}-${p.userId}`} className="persona" aria-pressed={active} onClick={() => apply(p)}>
              <span className="persona-name">{p.name}</span>
              <span className="row">
                <span className="badge ink">{p.tenantId}</span>
                <span className="badge pink">{p.userId}</span>
                {active && <span className="badge green">active</span>}
              </span>
              <span className="small">{p.note}</span>
            </button>
          );
        })}
      </section>

      <div className="grid grid-2 mt-lg">
        <form className="panel" onSubmit={submit} aria-label="Custom identity">
          <div className="panel-head"><h2>Custom identity</h2></div>
          <div className="panel-body">
            <div className="field">
              <label className="label" htmlFor="id-user">User ID (x-user-id)</label>
              <input id="id-user" className="input" value={userId} maxLength={64} onChange={(e) => setUserId(e.target.value)} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="id-tenant">Tenant ID (x-tenant-id)</label>
              <input id="id-tenant" className="input" value={tenantId} maxLength={64} onChange={(e) => setTenantId(e.target.value)} required />
            </div>
            <button className="btn btn-primary" disabled={!userId.trim() || !tenantId.trim()}>Apply</button>
          </div>
        </form>

        <section className="panel pink">
          <div className="panel-head"><h2>Local data</h2></div>
          <div className="panel-body">
            <p style={{ marginBottom: 14 }}>
              This browser stores the console transcript, the approval queue and your ingest history. The backend keeps its own
              in-memory state, which is wiped when the server restarts.
            </p>
            <dl className="kv" style={{ marginBottom: 16 }}>
              <dt>Messages</dt><dd>{state.messages.length}</dd>
              <dt>Approvals</dt><dd>{state.approvals.length}</dd>
              <dt>Ingests</dt><dd>{state.ingests.length}</dd>
            </dl>
            <button
              className="btn btn-red"
              onClick={() => {
                if (window.confirm("Clear the transcript, approval queue and ingest history in this browser?")) {
                  dispatch({ type: "reset" });
                  setMsg("Local data cleared.");
                }
              }}
            >
              Clear local data
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
