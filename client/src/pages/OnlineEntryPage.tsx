import { useEffect, useState } from "react";
import { StockGrid, type GridRow } from "../components/StockGrid";
import { getOnlineGrid, saveOnlineEntry } from "../api/onlineStock";
import { useAuth } from "../context/AuthContext";
import { Field, TextInput } from "../components/ui";
import { colors } from "../theme";

const columns = [
  { key: "openingStock", label: "Stocks (Opening)", editable: false },
  { key: "stockInOffToOl", label: "Stocks In (Off→Ol)", editable: true },
  { key: "stockOutOlToOff", label: "Stocks Out (Ol→Off)", editable: true },
  { key: "onlineStock", label: "Online Stocks", editable: false },
  { key: "productionIn", label: "Production (In)", editable: true },
  { key: "fulfillmentOut", label: "Fulfillment (Out)", editable: true },
  { key: "rts", label: "RTS", editable: true },
  { key: "remainingStock", label: "Remaining Stocks", editable: false },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function OnlineEntryPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = user?.role === "ONLINE_ENCODER" || user?.role === "SUPERVISOR_ADMIN";

  useEffect(() => {
    setRows(null);
    getOnlineGrid(date)
      .then((data) => setRows(data as unknown as GridRow[]))
      .catch((e) => setError(e.message));
  }, [date]);

  // The save endpoint already returns the fully-recalculated row, so a
  // single edit only needs one round trip - merge that row into local state
  // instead of re-fetching all ~60 products' worth of grid data every time
  // a cell is committed.
  async function handleCommit(productId: number, key: string, value: number) {
    setError(null);
    try {
      const saved = await saveOnlineEntry(productId, date, { [key]: value });
      setRows((prev) =>
        prev?.map((r) => (r.product.id === productId ? { ...r, entry: saved as unknown as typeof r.entry, isSaved: true } : r)) ?? prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Daily Online Stock Monitoring</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk }}>
        Stocks In/Out transfers entered here mirror automatically onto the Offline table (Section 4.3).
      </p>
      <Field label="Date" style={{ marginBottom: 16, maxWidth: 180 }}>
        <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%" }} />
      </Field>
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {!rows ? <p>Loading…</p> : <StockGrid rows={rows} columns={columns} onCommit={handleCommit} readOnly={!canEdit} />}
      {!canEdit && <p style={{ fontSize: 12, color: colors.subtleInk, marginTop: 8 }}>Read-only: your role can view but not edit Online entries.</p>}
    </div>
  );
}
