import { Component, type ErrorInfo, type ReactNode } from "react";
import { colors, fonts } from "../theme";
import { reportClientError } from "../utils/errorReporter";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level fault boundary (mounted once, around the whole app - see
 * main.tsx). React error boundaries have no hook equivalent, so this has to
 * be a class component. Without this, any uncaught render error anywhere in
 * the tree white-screens the entire app for whoever's using it (a warehouse
 * encoder mid-entry, a supervisor mid-report) with nothing but a blank page
 * and no way back except a manual reload.
 *
 * The fallback shows a plain, generic message and a reload button only -
 * never `error.stack`/`error.message` verbatim, which can echo back
 * internal file paths or (if the error originated from a failed fetch) raw
 * server/DB text. The real detail goes to the console for whoever's
 * actually debugging it, not onto the screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info.componentStack);
    reportClientError("boundary", error);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          fontFamily: fonts.body,
          minHeight: "var(--ae-vh)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 24,
          textAlign: "center",
          background: colors.paper,
          color: colors.ink,
        }}
      >
        <h1 style={{ margin: 0, fontSize: "calc(20px * var(--ae-fs, 1))" }}>Something went wrong.</h1>
        <p
          style={{
            margin: 0,
            maxWidth: 420,
            fontSize: "calc(13.5px * var(--ae-fs, 1))",
            color: colors.subtleInk,
          }}
        >
          This page ran into an unexpected error. Reloading usually fixes it -
          if it keeps happening, let a supervisor know what you were doing when
          it showed up.
        </p>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            marginTop: 6,
            padding: "9px 20px",
            fontSize: "calc(13.5px * var(--ae-fs, 1))",
            fontFamily: "inherit",
            fontWeight: 600,
            color: colors.black,
            background: colors.yellow,
            border: "none",
            // Pill, matching .ae-btn - every button in the app is this shape.
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
