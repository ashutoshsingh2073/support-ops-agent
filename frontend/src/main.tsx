import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/archivo-black/400.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "./styles.css";
import { StoreProvider } from "./lib/store";
import { HealthProvider } from "./lib/health";
import { AppRoutes } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <HealthProvider>
          <AppRoutes />
        </HealthProvider>
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
);
