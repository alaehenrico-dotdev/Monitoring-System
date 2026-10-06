import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { registerServiceWorker } from "./pwa";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);

registerServiceWorker();

if (import.meta.env.MODE === "tauri") {
  import("./tauri/updater").then(({ checkForUpdates }) => checkForUpdates());
  import("./tauri/appInfo").then(({ setWindowTitleWithVersion }) =>
    setWindowTitleWithVersion(),
  );
}
