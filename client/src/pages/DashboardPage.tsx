import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { getTotalStocks } from "../api/totalStocks";
import { listProducts } from "../api/products";
import { listReceipts } from "../api/receipts";
import { colors } from "../theme";

const shortcuts = [
  { to: "/online", label: "Online Entry", description: "Record online stock movements." },
  { to: "/offline", label: "Offline Entry", description: "Record offline stock movements." },
  { to: "/total-stocks", label: "Total Stocks", description: "Review combined stock balances." },
  { to: "/receipts", label: "Receipts", description: "Create and review sales receipts." },
  { to: "/daily-report", label: "Daily Report", description: "Open the Daily Report for any date." },
  { to: "/variance-report", label: "Variance Report", description: "Open the Variance Report for a date range." },
];

export function DashboardPage() {
  const [analytics, setAnalytics] = useState<{ activeProducts: number; totalRemaining: number; todayReceipts: number; varianceFlags: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([listProducts(), getTotalStocks(today), listReceipts({ date: today })])
      .then(([products, stocks, receipts]) => {
        setAnalytics({
          activeProducts: products.filter((product) => product.isActive).length,
          totalRemaining: stocks.reduce((sum, row) => sum + Number(row.totalRemainingStock || 0), 0),
          todayReceipts: receipts.length,
          varianceFlags: stocks.filter((row) => Number(row.totalVariance || 0) !== 0).length,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load dashboard analytics"));
  }, []);

  return (
    <div>
      <h2 style={{ margin: "-8px 0 0px" }}>Dashboard</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 8px" }}>
        Choose a workspace to continue managing inventory and sales activity.
      </p>
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        {[
          ["Active Products", analytics ? analytics.activeProducts.toLocaleString() : "—"],
          ["Total Remaining", analytics ? analytics.totalRemaining.toLocaleString() : "—"],
          ["Today’s Receipts", analytics ? analytics.todayReceipts.toLocaleString() : "—"],
          ["Variance Flags", analytics ? analytics.varianceFlags.toLocaleString() : "—"],
        ].map(([label, value]) => (
          <div key={label} style={{ padding: 16, borderRadius: 8, background: colors.blackSoft, color: colors.yellow }}>
            <strong style={{ display: "block", fontSize: 22 }}>{value}</strong>
            <span style={{ fontSize: 12, color: colors.cream }}>{label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        {shortcuts.map((shortcut) => (
          <Link
            key={shortcut.to}
            to={shortcut.to}
            style={{
              display: "block",
              padding: 18,
              border: "none",
              borderRadius: 0,
              background: colors.yellow,
              color: colors.black,
              textDecoration: "none",
              boxShadow: "0 1px 3px rgba(20, 17, 13, 0.06)",
            }}
          >
            <strong style={{ display: "block", marginBottom: 6 }}>{shortcut.label}</strong>
            <span style={{ fontSize: 13, color: colors.black }}>{shortcut.description}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
