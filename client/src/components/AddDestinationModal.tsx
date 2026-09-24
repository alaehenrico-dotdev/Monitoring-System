import { useState, type FormEvent } from "react";
import { createDeliveryDestination } from "../api/deliveryDestinations";
import type { DeliveryDestination } from "../types";
import { Button, TextInput } from "./ui";
import { Modal } from "./Modal";
import { colors } from "../theme";

/// Value of the "+ Add new destination…" <option> in a destination <select> -
/// picking it opens this modal instead of changing the selection. Shared so
/// the single-receipt and bulk selects can't drift apart.
export const ADD_DESTINATION_VALUE = "__add_destination__";

/// Quick "add a destination" dialog for the destination dropdowns on the
/// Receipts page, so a new route doesn't need a trip to the Delivery
/// Destinations admin page first. Creates it through the same endpoint that
/// page uses; typing a name that already exists just selects the existing
/// one rather than erroring (case-insensitive).
export function AddDestinationModal({
  existing,
  onClose,
  onCreated,
}: {
  existing: DeliveryDestination[];
  onClose: () => void;
  /// Called with the created (or already-existing) destination - the caller
  /// appends it to its list (if new) and selects it.
  onCreated: (destination: DeliveryDestination) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    const match = existing.find((d) => d.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (match) {
      onCreated(match);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      onCreated(await createDeliveryDestination({ name: trimmed }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add destination");
      setSaving(false);
    }
  }

  return (
    <Modal title="Add new destination" onClose={onClose} width={420}>
      <form onSubmit={handleSubmit}>
        <TextInput
          autoFocus
          aria-label="Destination name"
          placeholder="Destination name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box" }}
        />
        {error && <p style={{ color: colors.danger, fontSize: 12, margin: "8px 0 0" }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Adding…" : "Add"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
