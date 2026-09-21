import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { Layout } from "./components/Layout";
import { TopBar } from "./components/TopBar";
import { TopProgressBar } from "./components/TopProgressBar";
import { TopProgressProvider } from "./hooks/useTopProgress";
import { LoadingBlock } from "./components/Spinner";
import { LoginPage } from "./pages/LoginPage";

// Every page below `<ProtectedRoute>` is its own lazily-loaded chunk instead
// of bundled into the one main chunk every visitor downloads before they've
// even logged in - login is the one page that's NOT lazy, since it's the
// very first thing an unauthenticated visitor needs and lazy-loading it
// would just add a network round trip to the critical first-paint path for
// zero benefit. This is also what lets the PDF/CSV/QR libraries
// (jspdf/jspdf-autotable/qrcode - see utils/tablePdf.ts, utils/receiptPdf.ts)
// actually stay out of every route's bundle: those are dynamically imported
// at the point of use, but that only pays off if the *page* that reaches
// them isn't itself eagerly bundled into the same chunk as everything else.
const OnlineEntryPage = lazy(() => import("./pages/OnlineEntryPage").then((m) => ({ default: m.OnlineEntryPage })));
const OfflineEntryPage = lazy(() => import("./pages/OfflineEntryPage").then((m) => ({ default: m.OfflineEntryPage })));
const TotalStocksPage = lazy(() => import("./pages/TotalStocksPage").then((m) => ({ default: m.TotalStocksPage })));
const ManualCountPage = lazy(() => import("./pages/ManualCountPage").then((m) => ({ default: m.ManualCountPage })));
const ReceiptsPage = lazy(() => import("./pages/ReceiptsPage").then((m) => ({ default: m.ReceiptsPage })));
const VarianceReportPage = lazy(() => import("./pages/VarianceReportPage").then((m) => ({ default: m.VarianceReportPage })));
const DailyReportPage = lazy(() => import("./pages/DailyReportPage").then((m) => ({ default: m.DailyReportPage })));
const ProductsAdminPage = lazy(() => import("./pages/ProductsAdminPage").then((m) => ({ default: m.ProductsAdminPage })));
const ChangeLogPage = lazy(() => import("./pages/ChangeLogPage").then((m) => ({ default: m.ChangeLogPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const DailyReportHistoryPage = lazy(() => import("./pages/DailyReportHistoryPage").then((m) => ({ default: m.DailyReportHistoryPage })));
const VarianceReportHistoryPage = lazy(() => import("./pages/VarianceReportHistoryPage").then((m) => ({ default: m.VarianceReportHistoryPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <TopProgressProvider>
          <TopProgressBar />
          <TopBar />
          <Suspense fallback={<LoadingBlock label="Loading…" minHeight="100vh" size="lg" />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />

              <Route element={<ProtectedRoute />}>
                <Route element={<Layout />}>
                  <Route index element={<Navigate to="/online" replace />} />
                  <Route path="/online" element={<OnlineEntryPage />} />
                  <Route path="/offline" element={<OfflineEntryPage />} />
                  <Route path="/total-stocks" element={<TotalStocksPage />} />
                  <Route path="/manual-count" element={<ManualCountPage />} />
                  <Route path="/receipts" element={<ReceiptsPage />} />

                  <Route element={<ProtectedRoute allow={["SUPERVISOR_ADMIN"]} />}>
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/daily-report-history" element={<DailyReportHistoryPage />} />
                    <Route path="/variance-report-history" element={<VarianceReportHistoryPage />} />
                    <Route path="/variance-report" element={<VarianceReportPage />} />
                    <Route path="/daily-report" element={<DailyReportPage />} />
                    <Route path="/change-log" element={<ChangeLogPage />} />
                    <Route path="/products" element={<ProductsAdminPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Route>
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </TopProgressProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
