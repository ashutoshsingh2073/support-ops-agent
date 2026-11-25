import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useHealth } from "../lib/health";
import { useStore, useTenantApprovals } from "../lib/store";
import { StatusDot } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/console", label: "Agent Console" },
  { to: "/stream", label: "Live Stream" },
  { to: "/approvals", label: "Approvals", badge: "approvals" as const },
  { to: "/knowledge", label: "Knowledge Base" },
  { to: "/audit", label: "Audit Log" },
  { to: "/identity", label: "Identity" },
];

export function Layout() {
  const { health, error, loading } = useHealth();
  const { state } = useStore();
  const pending = useTenantApprovals().filter((a) => a.status === "pending").length;
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  const dot = loading ? "wait" : health ? "live" : "down";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Link to="/" style={{ textDecoration: "none" }}>
            <span className="brand-mark">Support//Ops</span>
            <span className="brand-sub">Agent control room</span>
          </Link>
          <button
            className="btn btn-sm btn-ink menu-toggle"
            aria-expanded={open}
            aria-controls="main-nav"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
        <nav id="main-nav" className={`nav ${open ? "open" : ""}`} aria-label="Main">
          {NAV.map((n, i) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              <span>
                <span className="nav-num">{String(i + 1).padStart(2, "0")}</span>
                {n.label}
              </span>
              {n.badge === "approvals" && pending > 0 && (
                <span className="nav-count" aria-label={`${pending} pending`}>
                  {pending}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          Provider: <strong>{health?.provider ?? "—"}</strong>
          <br />
          Indexed chunks: <strong>{health?.chunks ?? "—"}</strong>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="topbar-left">
            <span className="badge" data-testid="backend-status">
              <StatusDot state={dot} />
              {loading ? "Checking…" : health ? "Backend online" : "Backend offline"}
            </span>
            {health && <span className="badge cyan">{health.provider} mode</span>}
            {!loading && error && <span className="small mono">{error}</span>}
          </div>
          <div className="topbar-right">
            {pending > 0 && (
              <Link to="/approvals" className="badge pink" style={{ textDecoration: "none" }}>
                {pending} awaiting approval
              </Link>
            )}
            <Link to="/identity" className="id-chip" title="Change identity">
              <span>{state.identity.tenantId}</span>
              <span>{state.identity.userId}</span>
            </Link>
          </div>
        </div>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
