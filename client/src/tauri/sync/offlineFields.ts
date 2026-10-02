/// The Online<->Offline transfer fields - per your instruction, these are
/// disabled while offline (not staged/merged at all), since a transfer is a
/// single real-world event that has to mirror correctly onto the OTHER
/// table in the same instant (see dailyOnlineStock.service.ts's
/// mirrorTransferToOffline) - something only the always-connected server can
/// actually guarantee. Every other field on these two tables is a
/// genuinely independent event (production, fulfillment, deliveries, etc.)
/// and stays editable offline. Shared by the page-level column-disabling
/// (OnlineEntryPage/OfflineEntryPage) and the api/*.ts save fallbacks' own
/// defensive check.
export const ONLINE_TRANSFER_FIELDS = ["stockInOffToOl", "stockOutOlToOff"] as const;
export const OFFLINE_TRANSFER_FIELDS = ["stockInOlToOff", "stockOutOffToOl"] as const;
