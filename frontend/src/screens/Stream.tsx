import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, streamChat, type StreamSource } from "../lib/api";
import { useStore } from "../lib/store";
import { Alert, PageHead, Sources } from "../components/ui";

type Phase = "idle" | "connecting" | "streaming" | "done" | "stopped" | "error";

export function Stream() {
  const { state } = useStore();
  const [question, setQuestion] = useState("How do I reset my password?");
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [sources, setSources] = useState<StreamSource[] | null>(null);
  const [tokens, setTokens] = useState(0);
  const [ttft, setTtft] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  async function run(e?: FormEvent) {
    e?.preventDefault();
    const q = question.trim();
    if (!q) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setText("");
    setSources(null);
    setTokens(0);
    setTtft(null);
    setElapsed(null);
    setError(null);
    setPhase("connecting");
    const start = performance.now();
    let first = true;
    let serverError = false;

    try {
      await streamChat(
        state.identity,
        q,
        {
          onSources: (s) => {
            setSources(s);
            setPhase("streaming");
          },
          onToken: (t) => {
            if (first) {
              setTtft(Math.round(performance.now() - start));
              first = false;
            }
            setText((prev) => prev + t);
            setTokens((n) => n + 1);
          },
          onDone: () => setPhase("done"),
          onError: (m) => {
            serverError = true;
            setError(m);
            setPhase("error");
          },
        },
        c.signal,
      );
      if (c.signal.aborted) setPhase("stopped");
      else if (!serverError) setPhase("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Stream failed");
      setPhase("error");
    } finally {
      setElapsed(Math.round(performance.now() - start));
    }
  }

  function stop() {
    ctrl.current?.abort();
    setPhase("stopped");
  }

  const active = phase === "connecting" || phase === "streaming";

  return (
    <>
      <PageHead
        kicker="03 / Realtime"
        title="Live"
        highlight="Stream"
        desc="Watch a grounded answer arrive word by word over Server-Sent Events. Sources are sent first, then tokens. Stop cancels the request, and the server stops generating once the connection closes."
      />

      <Alert kind="info" tag="NOTE">
        The stream endpoint answers from documentation only. It skips the classifier, so refunds and tickets will not run here.
        Use the Agent Console for actions.
      </Alert>

      <form className="panel" onSubmit={run}>
        <div className="panel-head"><h2>Question</h2></div>
        <div className="panel-body">
          <div className="field">
            <label className="label" htmlFor="stream-q">Ask the knowledge base</label>
            <input id="stream-q" className="input" value={question} maxLength={4000} onChange={(e) => setQuestion(e.target.value)} />
          </div>
          <div className="row">
            <button className="btn btn-primary btn-lg" type="submit" disabled={active || !question.trim()}>
              ▶ Stream answer
            </button>
            <button className="btn btn-red btn-lg" type="button" onClick={stop} disabled={!active}>
              ■ Stop
            </button>
          </div>
        </div>
      </form>

      <section className="panel mt-lg" aria-label="Stream output">
        <div className="panel-head">
          <h2>Output</h2>
          <span className={`badge ${phase === "done" ? "green" : phase === "error" ? "red" : active ? "yellow" : phase === "stopped" ? "orange" : ""}`} data-testid="stream-phase">
            {phase}
          </span>
        </div>
        <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="tokens-meter">
            <span>tokens: {tokens}</span>
            <span>first token: {ttft === null ? "—" : `${ttft} ms`}</span>
            <span>total: {elapsed === null ? (active ? "…" : "—") : `${elapsed} ms`}</span>
            <span>sources: {sources === null ? "—" : sources.length}</span>
          </div>
          {sources && sources.length > 0 && <Sources sources={sources} showScore={false} />}
          {sources && sources.length === 0 && phase !== "idle" && (
            <p className="mono small">No sources passed the relevance threshold.</p>
          )}
          <div className="stream-out" data-testid="stream-output">
            {text || (phase === "idle" ? <span className="placeholder">// output appears here</span> : null)}
            {active && <span className="caret" aria-hidden />}
          </div>
        </div>
      </section>
    </>
  );
}
