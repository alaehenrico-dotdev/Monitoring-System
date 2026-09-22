import { deliveryDestinationRepository } from "../repositories/deliveryDestinationRepository";
import { HttpError } from "../utils/HttpError";
import { recordChange } from "./changeLog.service";

const TABLE = "DeliveryDestination";

export async function listDeliveryDestinations(includeInactive = false) {
  return deliveryDestinationRepository.findAll(includeInactive);
}

export async function createDeliveryDestination(data: { name: string }, changedById?: number) {
  const existing = await deliveryDestinationRepository.findByName(data.name);
  if (existing) throw HttpError.conflict(`Delivery destination "${data.name}" already exists`);

  const destination = await deliveryDestinationRepository.create({ name: data.name });
  await recordChange({ tableName: TABLE, recordId: destination.id, action: "CREATE", changedById, newValue: destination });
  return destination;
}

export async function updateDeliveryDestination(
  id: number,
  data: Partial<{ name: string; isActive: boolean; sortOrder: number }>,
  changedById?: number
) {
  const existing = await deliveryDestinationRepository.findById(id);
  if (!existing) throw HttpError.notFound("Delivery destination not found");

  if (data.name && data.name !== existing.name) {
    const duplicate = await deliveryDestinationRepository.findByName(data.name);
    if (duplicate) throw HttpError.conflict(`Delivery destination "${data.name}" already exists`);
  }

  const updated = await deliveryDestinationRepository.update(id, data);
  await recordChange({ tableName: TABLE, recordId: id, action: "UPDATE", changedById, oldValue: existing, newValue: updated });
  return updated;
}

/// Delivery destinations are never hard-deleted - past Offline entries
/// reference this id (OfflineEntryDelivery), so retire it instead (same
/// reasoning as deactivateProduct).
export async function deactivateDeliveryDestination(id: number, changedById?: number) {
  return updateDeliveryDestination(id, { isActive: false }, changedById);
}
