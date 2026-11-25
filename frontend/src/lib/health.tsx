import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type Health } from "./api";
import { useStore } from "./store";

type HealthState = {
  health: Health | null;
  error: string | null;
  loading: boolean;
  checkedAt: Date | null;
  refresh: () => Promise<void>;
};

const HealthContext = createContext<HealthState | null>(null);

/** Polls GET /health so every screen knows whether the backend is up. */
export function HealthProvider({ children, intervalMs = 15_000 }: { children: ReactNode; intervalMs?: number }) {
  const { state } = useStore();
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const idRef = useRef(state.identity);
  idRef.current = state.identity;

  const refresh = useCallback(async () => {
    try {
      const h = await api.health(idRef.current);
      setHealth(h);
      setError(null);
    } catch (e) {
      setHealth(null);
      setError(e instanceof ApiError ? e.message : "Health check failed");
    } finally {
      setLoading(false);
      setCheckedAt(new Date());
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (intervalMs <= 0) return;
    const t = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);

  return (
    <HealthContext.Provider value={{ health, error, loading, checkedAt, refresh }}>{children}</HealthContext.Provider>
  );
}

export function useHealth() {
  const ctx = useContext(HealthContext);
  if (!ctx) throw new Error("useHealth must be used inside <HealthProvider>");
  return ctx;
}
