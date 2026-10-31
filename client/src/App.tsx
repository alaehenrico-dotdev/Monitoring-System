import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { RealtimeProvider } from "./context/RealtimeContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { Layout } from "./components/Layout";
import { ShiftModeGate } from "./components/ShiftModeGate";
import { TopProgressBar } from "./components/TopProgressBar";
import { NoticeHost } from "./components/NoticeHost";
import { PasswordPromptHost } from "./components/PasswordPromptHost";
import { JumpscareHost } from "./components/JumpscareHost";
import { TopProgressProvider } from "./hooks/useTopProgress";
import { LoadingBlock } from "./components/Spinner";
import { LoginPage } from "./pages/LoginPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";

// Every page below `<ProtectedRoute>` is its own lazily-loaded chunk instead
// of bundled into the one main chunk every visitor downloads before they've
// even logged in - login is the one page that's NOT lazy, since it's the
// very first thing an unauthenticated visitor needs and lazy-loading it
// would just add a network round trip to the critical first-paint path for
// zero benefit. This is also what lets the PDF/CSV libraries
// (jspdf/jspdf-autotable - see utils/tablePdf.ts) actually stay out of every
// route's bundle: those are dynamically imported
// at the point of use, but that only pays off if the *page* that reaches
// them isn't itself eagerly bundled into the same chunk as everything else.
const OnlineEntryPage = lazy(() =>
  import("./pages/OnlineEntryPage").then((m) => ({
    default: m.OnlineEntryPage,
  })),
);
const OfflineEntryPage = lazy(() =>
  import("./pages/OfflineEntryPage").then((m) => ({
    default: m.OfflineEntryPage,
  })),
);
const TotalStocksPage = lazy(() =>
  import("./pages/TotalStocksPage").then((m) => ({
    default: m.TotalStocksPage,
  })),
);
const DailyOutPage = lazy(() =>
  import("./pages/DailyOutPage").then((m) => ({
    default: m.DailyOutPage,
  })),
);
const ManualCountPage = lazy(() =>
  import("./pages/ManualCountPage").then((m) => ({
    default: m.ManualCountPage,
  })),
);
const VarianceReportPage = lazy(() =>
  import("./pages/VarianceReportPage").then((m) => ({
    default: m.VarianceReportPage,
  })),
);
const DailyReportPage = lazy(() =>
  import("./pages/DailyReportPage").then((m) => ({
    default: m.DailyReportPage,
  })),
);
const ProductsAdminPage = lazy(() =>
  import("./pages/ProductsAdminPage").then((m) => ({
    default: m.ProductsAdminPage,
  })),
);
const ChangeLogPage = lazy(() =>
  import("./pages/ChangeLogPage").then((m) => ({ default: m.ChangeLogPage })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const DailyReportHistoryPage = lazy(() =>
  import("./pages/DailyReportHistoryPage").then((m) => ({
    default: m.DailyReportHistoryPage,
  })),
);
const DailyOutHistoryPage = lazy(() =>
  import("./pages/DailyOutHistoryPage").then((m) => ({
    default: m.DailyOutHistoryPage,
  })),
);
const VarianceReportHistoryPage = lazy(() =>
  import("./pages/VarianceReportHistoryPage").then((m) => ({
    default: m.VarianceReportHistoryPage,
  })),
);
const VarianceLedgerPage = lazy(() =>
  import("./pages/VarianceLedgerPage").then((m) => ({
    default: m.VarianceLedgerPage,
  })),
);
const AuditHistoryPage = lazy(() =>
  import("./pages/AuditHistoryPage").then((m) => ({
    default: m.AuditHistoryPage,
  })),
);
const AdminQueuePage = lazy(() =>
  import("./pages/AdminQueuePage").then((m) => ({ default: m.AdminQueuePage })),
);
const CorrectionsPage = lazy(() =>
  import("./pages/CorrectionsPage").then((m) => ({ default: m.CorrectionsPage })),
);
const AwaitingReleasePage = lazy(() =>
  import("./pages/AwaitingReleasePage").then((m) => ({ default: m.AwaitingReleasePage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RealtimeProvider>
          <TopProgressProvider>
            <TopProgressBar />
            <NoticeHost />
            <PasswordPromptHost />
            <JumpscareHost />
            <Suspense
              fallback={
                <LoadingBlock label="" minHeight="var(--ae-vh)" size="xxl" />
              }
            >
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />

                <Route element={<ProtectedRoute />}>
                  <Route element={<ShiftModeGate />}>
                  <Route element={<Layout />}>
                    <Route index element={<Navigate to="/online" replace />} />
                    <Route path="/online" element={<OnlineEntryPage />} />
                    <Route path="/offline" element={<OfflineEntryPage />} />
                    <Route path="/total-stocks" element={<TotalStocksPage />} />
                    <Route path="/daily-out" element={<DailyOutPage />} />
                    <Route path="/manual-count" element={<ManualCountPage />} />
                    <Route
                      path="/audit-history"
                      element={<AuditHistoryPage />}
                    />
                    {/* Every role can read the report (the server already allows it); the entry pages link here. */}
                    <Route path="/daily-report" element={<DailyReportPage />} />
                    <Route path="/corrections" element={<CorrectionsPage />} />
                    <Route path="/awaiting-release" element={<AwaitingReleasePage />} />
                    {/* Every role: Appearance is a per-browser preference. The admin tabs inside are hidden from others and the server refuses them anyway. */}
                    <Route path="/settings" element={<SettingsPage />} />

                    <Route
                      element={<ProtectedRoute allow={["SUPERVISOR_ADMIN"]} />}
                    >
                      <Route path="/dashboard" element={<DashboardPage />} />
                      <Route
                        path="/daily-report-history"
                        element={<DailyReportHistoryPage />}
                      />
                      <Route
                        path="/daily-out-history"
                        element={<DailyOutHistoryPage />}
                      />
                      <Route
                        path="/variance-report-history"
                        element={<VarianceReportHistoryPage />}
                      />
                      <Route
                        path="/variance-report"
                        element={<VarianceReportPage />}
                      />
                      <Route
                        path="/variance-ledger"
                        element={<VarianceLedgerPage />}
                      />
                      <Route path="/admin-queue" element={<AdminQueuePage />} />
                      <Route path="/change-log" element={<ChangeLogPage />} />
                      <Route path="/products" element={<ProductsAdminPage />} />
                    </Route>
                  </Route>
                  </Route>
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </TopProgressProvider>
        </RealtimeProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
