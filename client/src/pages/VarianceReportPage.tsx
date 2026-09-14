import { useState, type CSSProperties, type FormEvent } from "react";
import { getVarianceReport } from "../api/manualCounts";
import { Button, Field, TextInput } from "../components/ui";
import { colors } from "../theme";

interface VarianceRow {
  id: number;
  entryDate: string;
  location: string;
  systemRemainingStock: string;
  manualCount: string;
  variance: string;
  product: { id: number; name: string; category: string };
  countedBy: { name: string } | null;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/// Section 4.8 - all flagged variances across a date range, filterable by
/// product/category/location, to spot recurring problem SKUs (Section 4.4
/// calls out Toyo Mansi and Oyster Sauce A as historically the largest).
export function VarianceReportPage() {
  const [startDate, setStartDate] = useState(daysAgo(30));
  const [endDate, setEndDate] = useState(daysAgo(0));
  const [category, setCategory] = useState("");
  const [rows, setRows] = useState<VarianceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runReport(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setRows(null);
    try {
      const data = (await getVarianceReport({ startDate, endDate, category: category || undefined })) as VarianceRow[];
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Variance Report</h2>
      <form onSubmit={runReport} style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" }}>
        <Field label="From">
          <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="To">
          <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field label="Category (optional)">
          <TextInput value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Premium (Liter)" />
        </Field>
        <Button type="submit">Run report</Button>
      </form>

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {rows && (
        <>
          <p style={{ fontSize: 13, color: colors.subtleInk }}>{rows.length} flagged variance(s) found.</p>
          <div className="ae-table-scroll table-scroll">
            <table className="ae-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  {["Date", "Location", "Category", "Product", "System", "Manual Count", "Variance", "Counted By"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{r.entryDate.slice(0, 10)}</td>
                    <td>{r.location}</td>
                    <td style={{ textAlign: "left", whiteSpace: "nowrap" }}>{r.product.category}</td>
                    <td style={nameCellStyle}>{r.product.name}</td>
                    <td>{r.systemRemainingStock}</td>
                    <td>{r.manualCount}</td>
                    <td style={{ fontWeight: 700, color: Number(r.variance) < 0 ? colors.danger : colors.warningText }}>{r.variance}</td>
                    <td>{r.countedBy?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const nameCellStyle: CSSProperties = { textAlign: "left", whiteSpace: "nowrap" };
