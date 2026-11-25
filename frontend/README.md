# Support Ops — Frontend

A brutalist control room for the Support Ops Agent API in the parent folder.
React 19 + TypeScript + Vite + React Router. No UI framework; the styling is
hand-written in `src/styles.css`.

```bash
# terminal 1, project root
npm run dev                 # backend on http://localhost:3000

# terminal 2
cd frontend
npm install
npm run dev                 # UI on http://localhost:5173
```

The backend sends no CORS headers, so Vite proxies `/api/*` to `http://localhost:3000`.
Set `BACKEND_URL` to point the proxy somewhere else. For a production build
(`npm run build`), serve `dist/` behind a reverse proxy that maps `/api` to
the backend, or build with `VITE_API_BASE=https://api.example.com`.

## Screens

| Route | Screen | Backend calls |
|---|---|---|
| `/` | Dashboard | `GET /health`, `GET /audit` |
| `/console` | Agent Console | `POST /chat`, `POST /approve` |
| `/stream` | Live Stream | `POST /chat/stream` (SSE) |
| `/approvals` | Approval Queue | `POST /approve` |
| `/knowledge` | Knowledge Base | `POST /ingest`, `POST /chat` |
| `/audit` | Audit Log | `GET /audit` |
| `/identity` | Identity | sets `x-user-id` and `x-tenant-id` on every call |

## Tests

```bash
npm test            # 33 unit + component tests (Vitest, jsdom, mocked fetch)
npm run test:e2e    # 20 end-to-end tests: real Chromium, real backend
```

The E2E suite starts its own backend on :3100 and UI on :5174, so it never
touches a dev server you already have running.
