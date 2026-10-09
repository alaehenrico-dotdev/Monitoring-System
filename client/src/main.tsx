import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { MotionConfig } from "motion/react";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { registerServiceWorker } from "./pwa";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {/* Motion's own animations (dropdowns, pickers, toasts, sidebar, toolbar
          layout, button taps) ignore the OS "reduce motion" setting unless told
          to follow it; the CSS animations already do (index.css). "user" turns
          transform and layout animations off for those users, keeping opacity
          fades. */}
      <MotionConfig reducedMotion="user">
        <HashRouter>
          <App />
        </HashRouter>
      </MotionConfig>
    </ErrorBoundary>
  </React.StrictMode>,
);

registerServiceWorker();
