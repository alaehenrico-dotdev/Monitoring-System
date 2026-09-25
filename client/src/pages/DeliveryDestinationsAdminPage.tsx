import { useEffect, useState, type FormEvent } from "react";
import {
  createDeliveryDestination,
  deactivateDeliveryDestination,
  listDeliveryDestinations,
  updateDeliveryDestination,
} from "../api/deliveryDestinations";
import type { DeliveryDestination } from "../types";
import { Button, Field, TextInput } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageHeader } from "../components/PageHeader";
import { colors } from "../theme";
import { RowGlowScroll } from "../components/RowGlowScroll";
import { TableSkeleton } from "../components/Skeleton";

/// Section 4.3 - the Offline grid's Delivery (Out) breakdown (Western,
/// Cavite, ...) gets one editable column per destination managed here,
/// instead of a fixed list baked into the app - mirrors ProductsAdminPage
/// (Section 4.1) almost exactly, just without SKU/category/unit.
export function DeliveryDestinationsAdminPage() {
  const [destinations, setDestinations] = useState<DeliveryDestination[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingDeactivate, setPendingDeactivate] = useState<DeliveryDestination | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  function reload() {
    // includeInactive: a deactivated destination stays in this list (dimmed)
    // so it can be reactivated - same reasoning as ProductsAdminPage.
    listDeliveryDestinations({ includeInactive: true })
      .then(setDestinations)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load delivery destinations"));
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    try {
      const created = await createDeliveryDestination({ name: name.trim() });
      setName("");
      // Append locally instead of re-fetching the whole list.
      setDestinations((prev) => (prev ? [...prev, created] : [created]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add destination");
    }
  }

  function setActiveLocally(id: number, isActive: boolean) {
    setDestinations((prev) => prev?.map((d) => (d.id === id ? { ...d, isActive } : d)) ?? prev);
  }

  async function confirmDeactivate() {
    if (!pendingDeactivate) return;
    const target = pendingDeactivate;
    setError(null);
    setBusyId(target.id);
    try {
      await deactivateDeliveryDestination(target.id);
      setActiveLocally(target.id, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate destination");
    } finally {
      setBusyId(null);
      setPendingDeactivate(null);
    }
  }

  async function handleReactivate(d: DeliveryDestination) {
    setError(null);
    setBusyId(d.id);
    try {
      await updateDeliveryDestination(d.id, { isActive: true });
      setActiveLocally(d.id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reactivate destination");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Delivery Destinations"
        subtitle="Manage the delivery routes/destinations that make up Offline's Delivery (Out) breakdown (e.g. Western, Cavite). Each active destination gets its own column on the Offline Entry grid, summing into Delivery (Out) automatically. Deactivated destinations stay listed here (dimmed) so they can be reactivated."
      />

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 20 }}>
        <Field label="Destination name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cavite" />
        </Field>
        <Button type="submit" style={{ color: colors.yellow }}>Add Destination</Button>
      </form>
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {!destinations ? (
        <TableSkeleton headers={["Destination", ""]} minWidth={420} label="Loading delivery destinations…" />
      ) : (
        <RowGlowScroll>
          <table className="ae-table ae-table--left" style={{ minWidth: 420 }}>
            <thead>
              <tr>
                {["Destination", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {destinations.map((d) => (
                <tr key={d.id} style={d.isActive ? undefined : { opacity: 0.55 }}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {d.name}
                    {!d.isActive && (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: "1px 7px",
                          border: `1px solid ${colors.subtleInk}`,
                          borderRadius: 999,
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          color: colors.subtleInk,
                        }}
                      >
                        Inactive
                      </span>
                    )}
                  </td>
                  <td>
                    {d.isActive ? (
                      <Button variant="danger" size="sm" disabled={busyId === d.id} onClick={() => setPendingDeactivate(d)} style={{ color: colors.yellow }}>
                        Deactivate
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" disabled={busyId === d.id} onClick={() => handleReactivate(d)}>
                        {busyId === d.id ? "Reactivating…" : "Reactivate"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </RowGlowScroll>
      )}

      {pendingDeactivate && (
        <ConfirmDialog
          title="Deactivate destination?"
          confirmLabel="Deactivate"
          busy={busyId === pendingDeactivate.id}
          onConfirm={confirmDeactivate}
          onCancel={() => setPendingDeactivate(null)}
        >
          <p style={{ margin: "0 0 10px" }}>
            <strong>{pendingDeactivate.name}</strong> will be hidden from the Offline Entry grid's Delivery (Out) breakdown.
          </p>
          <p style={{ margin: 0, color: colors.subtleInk }}>
            Past entries are not deleted, and you can reactivate it from this list at any time.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
