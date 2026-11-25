import { Link, useLocation } from "react-router-dom";

export function NotFound() {
  const { pathname } = useLocation();
  return (
    <div className="notfound">
      <div>
        <div className="big" aria-hidden>404</div>
        <h1 style={{ fontSize: 36, marginTop: 24 }}>Nothing at this address</h1>
        <p className="mono mt">
          <code>{pathname}</code> is not a screen.
        </p>
        <Link to="/" className="btn btn-primary btn-lg mt">← Back to dashboard</Link>
      </div>
    </div>
  );
}
