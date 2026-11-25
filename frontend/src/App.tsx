import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./screens/Dashboard";
import { Console } from "./screens/Console";
import { Stream } from "./screens/Stream";
import { Approvals } from "./screens/Approvals";
import { Knowledge } from "./screens/Knowledge";
import { Audit } from "./screens/Audit";
import { Identity } from "./screens/Identity";
import { NotFound } from "./screens/NotFound";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="console" element={<Console />} />
        <Route path="stream" element={<Stream />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="audit" element={<Audit />} />
        <Route path="identity" element={<Identity />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
