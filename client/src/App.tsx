import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { OnlineEntryPage } from "./pages/OnlineEntryPage";
import { OfflineEntryPage } from "./pages/OfflineEntryPage";
import { TotalStocksPage } from "./pages/TotalStocksPage";
import { ManualCountPage } from "./pages/ManualCountPage";
import { ReceiptsPage } from "./pages/ReceiptsPage";
import { VarianceReportPage } from "./pages/VarianceReportPage";
import { DailyReportPage } from "./pages/DailyReportPage";
import { ProductsAdminPage } from "./pages/ProductsAdminPage";
import { ChangeLogPage } from "./pages/ChangeLogPage";

export default function App() {
  return (
    <AuthProvider>
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
              <Route path="/variance-report" element={<VarianceReportPage />} />
              <Route path="/daily-report" element={<DailyReportPage />} />
              <Route path="/change-log" element={<ChangeLogPage />} />
              <Route path="/products" element={<ProductsAdminPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
