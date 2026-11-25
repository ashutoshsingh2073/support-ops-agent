# Support Ops Agent

A support assistant API that answers questions from a knowledge base **with citations**, takes actions through tools, and **stops for human approval before it moves money**.

Built with TypeScript, Express, LangGraph.js and Zod. It runs with **no API key and no network** in mock mode, so you can clone it and see every path working in under a minute.

```bash
npm install
npm test        # 9 tests
npm run eval    # evaluation harness with quality thresholds
npm run dev     # http://localhost:3000
```

---

## Why this exists

Most LLM demos stop at "chat with your documents". The hard parts in production are the ones after that:

| Problem | What this does about it |
|---|---|
| The model invents answers | Retrieval with a relevance threshold; below it the agent refuses and offers a handoff instead of guessing |
| You can't tell where an answer came from | Every answer returns numbered sources with similarity scores |
| An agent with tools can do real damage | Refunds above a configurable limit pause the graph for a human; the run resumes only after approval |
| A retry refunds twice | Every money-moving tool call carries an idempotency key |
| One customer sees another's data | Tenant filtering happens in the retrieval query and in every tool, never in the prompt |
| A prompt change silently breaks things | An eval dataset runs in CI and fails the build if routing accuracy drops below 80% |

## Architecture

```
POST /chat
   │
   ▼
classify ──┬── answer_from_docs ─▶ retrieve ─▶ generate ─▶ END
           │                       (tenant-filtered, threshold)
           ├── take_action ──────▶ act ─┬─ small refund / ticket ─▶ END
           │                            └─ large refund ─▶ interrupt() ──▶ paused
           └── out_of_scope ─────────────────────────────────────────────▶ END
                                                                             │
POST /approve  ──  Command({ resume: "approve" })  ─────────────────────────┘
```

State, nodes and conditional edges are a LangGraph `StateGraph`. A `MemorySaver`
checkpointer stores one state history per `thread_id`, which is what makes both
multi-turn memory and the pause/resume flow work. In production that becomes the
Postgres checkpointer — same interface.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Provider and number of indexed chunks |
| POST | `/chat` | Ask a question or request an action. Returns an answer, or `awaiting_approval` with the approval payload |
| POST | `/approve` | Resume a paused thread with `approve` or `reject` |
| POST | `/chat/stream` | Same answer, streamed token by token over SSE |
| POST | `/ingest` | Add a document to the tenant's knowledge base |
| GET | `/audit` | Every tool call made for this tenant |

Identity comes from the `x-user-id` and `x-tenant-id` headers — the place a JWT
middleware would populate in a real deployment.

### Try it

```bash
# Grounded answer with sources
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"When is shipping free?"}' | jq

# Refuses rather than guessing
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"What is your enterprise SLA for uptime credits?"}' | jq .answer

# Human-in-the-loop: this pauses
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"Please refund ₹2000 for order A-1001"}' | jq

# …then resume it with the threadId from the response
curl -s localhost:3000/approve -H 'content-type: application/json' \
  -d '{"threadId":"<id>","decision":"approve"}' | jq

# Streaming
curl -N localhost:3000/chat/stream -H 'content-type: application/json' \
  -d '{"message":"How do I reset my password?"}'
```

## Mock mode

`LLM_PROVIDER=mock` (the default) swaps two implementations behind interfaces:

- `Planner` → a rule-based classifier instead of `withStructuredOutput`
- `Embedder` → deterministic hash embeddings instead of `text-embedding-3-small`

Everything else — the graph, retrieval, threshold, tools, approval, idempotency,
tenant isolation, SSE — is the same code in both modes. Set `LLM_PROVIDER=openai`
and add a key to run it for real.

This is the dependency-inversion principle doing something useful: the agent
depends on the interfaces, so tests and CI need no API key, no network and no spend.

## Evaluation

```
$ npm run eval

Evaluation results
------------------
Examples         : 14
Routing accuracy : 100%
Groundedness     : 88%
Correct refusals : 100%
```

`evals/dataset.json` holds the examples; `evals/run.ts` scores routing,
groundedness and correct refusals, then exits non-zero if routing drops below
80%, so CI blocks the regression.

One example fails on groundedness in mock mode — the keyword-based mock answerer
picks the wrong sentence for "how long does a refund take". That is left in on
purpose: it is the harness catching a real weakness, which is what an eval suite
is for. With real embeddings and a real model it passes.

## Tests

`npm test` covers the paths that matter rather than line count:

- a grounded answer returns the expected fact and its sources
- an unanswerable question is refused, not guessed
- a large refund pauses, and completes only after approval
- a rejected refund does not move money
- approving a thread that is not paused returns 409
- one tenant's question cannot retrieve another tenant's document
- a user cannot refund an order belonging to someone else

## Deployment

Multi-stage `Dockerfile` (non-root, healthcheck, ~200 MB), `docker-compose.yml`,
and a GitHub Actions pipeline that runs typecheck → tests → **evals** → build,
then builds the image tagged with the commit SHA.

```bash
docker compose up --build
```

## What I would add next

- Postgres + pgvector instead of the in-memory store (the `VectorStore` interface
  already matches the query shape; the SQL is in a comment in `src/rag/store.ts`)
- The Postgres checkpointer so a restart doesn't lose paused threads
- BullMQ workers for ingestion so large uploads don't block the request
- Reranking after retrieval, and hybrid keyword + vector search
- LangSmith tracing (env vars are in `.env.example`) and online evaluators on sampled traffic
