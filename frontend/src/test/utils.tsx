import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import type { ReactNode } from "react";
import { StoreProvider, initialState, type State } from "../lib/store";
import { HealthProvider } from "../lib/health";
import { AppRoutes } from "../App";

export type Call = { method: string; path: string; headers: Record<string, string>; body: unknown };

type Handler = (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string>; raw?: string } | undefined;

/** Install a fake fetch that routes by "METHOD /path" and records every call. */
export function mockFetch(routes: Record<string, Handler | object>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace(/^\/api/, "");
    const method = (init.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const call = { method, path, headers, body };
    calls.push(call);
    const route = routes[`${method} ${path}`];
    if (!route) return new Response(JSON.stringify({ error: `no mock for ${method} ${path}` }), { status: 404 });
    const out = typeof route === "function" ? (route as Handler)(call) : { body: route };
    if (!out) return new Response(JSON.stringify({ error: "handler returned nothing" }), { status: 500 });
    return new Response(out.raw ?? JSON.stringify(out.body ?? null), {
      status: out.status ?? 200,
      headers: { "content-type": "application/json", ...(out.headers ?? {}) },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

export function renderApp(path = "/", state?: Partial<State>) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StoreProvider initial={{ ...initialState, ...state }}>
        <HealthProvider intervalMs={0}>
          <AppRoutes />
        </HealthProvider>
      </StoreProvider>
    </MemoryRouter>,
  );
}

export function Wrap({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export const HEALTH = { status: "ok", provider: "mock", chunks: 6 };
