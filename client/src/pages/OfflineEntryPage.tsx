import { useEffect, useState } from "react";
import { StockGrid, type GridRow } from "../components/StockGrid";
import { getOfflineGrid, saveOfflineEntry } from "../api/offlineStock";
import { useAuth } from "../context/AuthContext";
import { Field, TextInput } from "../components/ui";
import { colors } from "../theme";

const columns = [
  { key: "openingStock", label: "Stocks (Opening)", editable: false },
  { key: "stockInOlToOff", label: "Stocks In (Ol→Off)", editable: true },
  { key: "stockOutOffToOl", label: "Stocks Out (Off→Ol)", editable: true },
  { key: "offlineStock", label: "Offline Stocks", editable: false },
  { key: "productionIn", label: "Production (In)", editable: true },
  { key: "deliveryOut", label: "Delivery (Out)", editable: true },
  { key: "backloads", label: "Backloads", editable: true },
  { key: "remainingStock", label: "Remaining Stocks", editable: false },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function OfflineEntryPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = user?.role === "OFFLINE_ENCODER" || user?.role === "SUPERVISOR_ADMIN";

  useEffect(() => {
    setRows(null);
    getOfflineGrid(date)
      .then((data) => setRows(data as unknown as GridRow[]))
      .catch((e) => setError(e.message));
  }, [date]);

  // One round trip per edit instead of two - the save endpoint already
  // returns the recalculated row.
  async function handleCommit(productId: number, key: string, value: number) {
    setError(null);
    try {
      const saved = await saveOfflineEntry(productId, date, { [key]: value });
      setRows((prev) =>
        prev?.map((r) => (r.product.id === productId ? { ...r, entry: saved as unknown as typeof r.entry, isSaved: true } : r)) ?? prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Daily Offline Stock Monitoring</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk }}>
        Stocks In/Out transfers here mirror automatically onto the Online table (Section 4.3).
      </p>
      <Field label="Date" style={{ marginBottom: 16, maxWidth: 180 }}>
        <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%" }} />
      </Field>
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {!rows ? <p>Loading…</p> : <StockGrid rows={rows} columns={columns} onCommit={handleCommit} readOnly={!canEdit} />}
      {!canEdit && <p style={{ fontSize: 12, color: colors.subtleInk, marginTop: 8 }}>Read-only: your role can view but not edit Offline entries.</p>}
    </div>
  );
}
