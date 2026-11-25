import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { api, ApiError, type ChatResponse } from "../lib/api";
import { useHealth } from "../lib/health";
import { useStore } from "../lib/store";
import { Alert, Empty, PageHead, Sources, Steps, timeAgo } from "../components/ui";

const MAX_CHARS = 500_000;
const SEEDED = ["accounts.md", "refunds.md", "shipping.md"];

export function Knowledge() {
  const { state, dispatch } = useStore();
  const { refresh } = useHealth();
  const [source, setSource] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const mine = state.ingests.filter((i) => i.tenantId === state.identity.tenantId);
  const replacing = source.trim() && (mine.some((i) => i.source === source.trim()) || SEEDED.includes(source.trim()));

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_CHARS * 4) {
      setError("File is too large (500,000 characters max).");
      return;
    }
    setText(await f.text());
    if (!source.trim()) setSource(f.name.slice(0, 200));
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await api.ingest(state.identity, source.trim(), text);
      dispatch({
        type: "ingest",
        record: { source: res.source, chunks: res.chunks, chars: text.length, tenantId: state.identity.tenantId, at: new Date().toISOString() },
      });
      setOk(`Indexed “${res.source}” as ${res.chunks} chunk(s) for tenant ${state.identity.tenantId}.`);
      setText("");
      setSource("");
      if (fileRef.current) fileRef.current.value = "";
      void refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ingest failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        kicker="05 / Retrieval"
        title="Knowledge"
        highlight="Base"
        desc={
          <>
            Add documents the agent can cite. Text is split on paragraph boundaries into overlapping chunks, embedded, and stored for
            tenant <strong>{state.identity.tenantId}</strong> only. Other tenants never retrieve it.
          </>
        }
      />

      <div className="grid grid-3">
        <form className="panel blue span-2" onSubmit={submit} aria-label="Ingest document">
          <div className="panel-head"><h2>Ingest a document</h2></div>
          <div className="panel-body">
            {error && <Alert kind="error">{error}</Alert>}
            {ok && <Alert kind="ok">{ok}</Alert>}
            <div className="field">
              <label className="label" htmlFor="kb-source">Source name</label>
              <input id="kb-source" className="input" value={source} maxLength={200} onChange={(e) => setSource(e.target.value)} placeholder="returns-policy.md" required />
              {replacing && (
                <span className="hint" style={{ color: "var(--ink)", fontWeight: 700 }} data-testid="replace-warning">
                  ⚠ A document with this name already exists. Re-ingesting replaces its chunks, and the backend currently does
                  this across every tenant.
                </span>
              )}
            </div>
            <div className="field">
              <label className="label" htmlFor="kb-file">Load from file (.md, .txt)</label>
              <input id="kb-file" ref={fileRef} type="file" accept=".md,.txt,.markdown,text/plain,text/markdown" onChange={onFile} className="input" />
            </div>
            <div className="field">
              <label className="label" htmlFor="kb-text">Content</label>
              <textarea id="kb-text" className="textarea" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"# Returns\n\nUnused items can be returned within 7 days…"} required />
              <span className={`hint mono ${text.length > MAX_CHARS ? "" : ""}`} style={text.length > MAX_CHARS ? { color: "var(--red)", fontWeight: 700 } : undefined}>
                {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters
              </span>
            </div>
            <button className="btn btn-primary btn-lg" disabled={busy || !source.trim() || !text.trim() || text.length > MAX_CHARS}>
              {busy ? <><span className="spinner" aria-hidden /> Indexing…</> : "⇪ Ingest"}
            </button>
          </div>
        </form>

        <section className="panel">
          <div className="panel-head"><h2>In this tenant</h2></div>
          <div className="panel-body">
            {state.identity.tenantId === "acme" && (
              <>
                <p className="label" style={{ marginBottom: 8 }}>Seeded at boot</p>
                <div className="row" style={{ marginBottom: 16 }}>
                  {SEEDED.map((s) => <span key={s} className="badge yellow">{s}</span>)}
                </div>
              </>
            )}
            <p className="label" style={{ marginBottom: 8 }}>Added from this browser</p>
            {mine.length === 0 ? (
              <p className="muted small">None yet.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }} data-testid="ingest-history">
                {mine.map((i, idx) => (
                  <li key={`${i.source}-${i.at}-${idx}`} className="row" style={{ border: "2px solid var(--ink)", padding: "6px 8px", justifyContent: "space-between" }}>
                    <strong className="mono small">{i.source}</strong>
                    <span className="mono small">{i.chunks} chunk(s) · {timeAgo(i.at)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="hint mt">The backend has no endpoint that lists documents, so this list only covers what you added here.</p>
          </div>
        </section>
      </div>

      <RetrievalTest />
    </>
  );
}

function RetrievalTest() {
  const { state } = useStore();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ChatResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      setRes(await api.chat(state.identity, q.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel mt-lg" onSubmit={run} aria-label="Test retrieval">
      <div className="panel-head"><h2>Test retrieval</h2></div>
      <div className="panel-body">
        <p className="hint" style={{ marginBottom: 12 }}>Ask a question in a fresh thread to check the agent can find and cite your document.</p>
        <div className="row">
          <label htmlFor="kb-test" className="sr-only">Test question</label>
          <input id="kb-test" className="input" style={{ flex: "1 1 300px", width: "auto" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="What does the new document say about…?" />
          <button className="btn btn-ink" disabled={busy || !q.trim()}>{busy ? "Asking…" : "Ask"}</button>
        </div>
        {error && <div className="mt"><Alert kind="error">{error}</Alert></div>}
        {res && (
          <div className="mt" data-testid="kb-test-result" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {res.status === "complete" ? (
              <>
                <div className="msg agent" style={{ maxWidth: "100%" }}>
                  <div className="msg-head"><span>Agent</span></div>
                  <div className="msg-body">{res.answer}</div>
                </div>
                {res.sources.length > 0 ? <Sources sources={res.sources} /> : <Empty title="No sources matched" />}
              </>
            ) : (
              <Alert kind="warn">That message was treated as an action and needs approval. Use the Agent Console for actions.</Alert>
            )}
            <Steps steps={res.steps} />
          </div>
        )}
      </div>
    </form>
  );
}
