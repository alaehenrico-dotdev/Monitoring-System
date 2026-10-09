/// Turns a change_log row's whole-row JSON snapshots into something a person
/// can read: friendly field names and a one-line "what changed". Lives on the
/// server so the Change Log page and its CSV export describe a change the
/// same way.

/// Fields that identify the record rather than describe a figure on it - they
/// are shown as the row's label (see changeLog.service's context), not as a
/// change.
const IDENTITY_FIELDS = new Set([
  "id",
  "publishedById",
  "createdAt",
  "updatedAt",
  "productId",
  "entryDate",
  "shift",
  "location",
  "encodedById",
  "countedById",
]);

const FIELD_LABELS: Record<string, string> = {
  openingStock: "Opening stock",
  stockInOffToOl: "Stock in (Offline → Online)",
  stockOutOlToOff: "Stock out (Online → Offline)",
  onlineStock: "Online stock",
  productionIn: "Production in",
  fulfillmentOut: "Fulfillment out",
  rts: "RTS",
  remainingStock: "Remaining stock",
  stockInOlToOff: "Stock in (Online → Offline)",
  stockOutOffToOl: "Stock out (Offline → Online)",
  offlineStock: "Offline stock",
  deliveryOut: "Delivery out",
  delivery1: "Delivery 1",
  delivery2: "Delivery 2",
  delivery3: "Delivery 3",
  delivery4: "Delivery 4",
  delivery5: "Delivery 5",
  backloads: "Backloads",
  upsellOut: "Upsell out",
  systemRemainingStock: "System remaining stock",
  manualCount: "Manual count",
  variance: "Variance",
  sku: "SKU",
  username: "Username",
  role: "Role",
  remarks: "Remarks",
  publishedAt: "Publication",
  name: "Name",
  category: "Category",
  unit: "Unit",
  isActive: "Active",
  sortOrder: "Sort order",
  lowStockThreshold: "Low stock threshold",
};

/// Figures the system works out from the ones a person types. They move on
/// every edit, so they are listed after the typed figure in a summary.
const CALCULATED_FIELDS = new Set(["onlineStock", "offlineStock", "deliveryOut", "remainingStock", "variance", "systemRemainingStock"]);

export function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  // Extra-column keys and anything added later: "someFieldName" -> "Some field name".
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function formatValue(value: unknown, key?: string): string {
  // A publication stamp reads as its state, not as a timestamp.
  if (key === "publishedAt") return value ? "Published" : "Not published";
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))) {
    // Decimal columns arrive as "12.00" - show 12, keep 12.5.
    return String(Number(value));
  }
  return String(value);
}

export interface FieldChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

function sameValue(a: unknown, b: unknown, key?: string): boolean {
  return formatValue(a, key) === formatValue(b, key);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/// Only the fields that actually changed, typed figures first.
export function diffChanges(oldValue: unknown, newValue: unknown): FieldChange[] {
  const oldObj = asObject(oldValue);
  const newObj = asObject(newValue);
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  const out: FieldChange[] = [];
  for (const key of keys) {
    if (IDENTITY_FIELDS.has(key)) continue;
    if (sameValue(oldObj[key], newObj[key], key)) continue;
    out.push({ key, label: fieldLabel(key), before: formatValue(oldObj[key], key), after: formatValue(newObj[key], key) });
  }
  return out.sort((a, b) => Number(CALCULATED_FIELDS.has(a.key)) - Number(CALCULATED_FIELDS.has(b.key)));
}

const MAX_SHOWN = 3;

function joinShown(parts: string[]): string {
  const shown = parts.slice(0, MAX_SHOWN).join("; ");
  return parts.length > MAX_SHOWN ? `${shown}; +${parts.length - MAX_SHOWN} more` : shown;
}

/// One line, e.g. "Manual count 12 → 10".
export function summarizeChange(action: "CREATE" | "UPDATE" | "DELETE", oldValue: unknown, newValue: unknown): string {
  if (action === "CREATE") {
    // A new row leaves dozens of columns at their 0 default; only the figures
    // actually entered are worth listing.
    const set = diffChanges(null, newValue).filter((c) => c.after !== "0" && c.after !== "—");
    return set.length ? `Created · ${joinShown(set.map((c) => `${c.label} ${c.after}`))}` : "Created";
  }
  if (action === "DELETE") {
    const had = diffChanges(oldValue, null).filter((c) => c.before !== "0" && c.before !== "—");
    return had.length ? `Deleted · ${joinShown(had.map((c) => `${c.label} ${c.before}`))}` : "Deleted";
  }
  const changes = diffChanges(oldValue, newValue);
  return changes.length ? joinShown(changes.map((c) => `${c.label} ${c.before} → ${c.after}`)) : "No field changes recorded";
}
