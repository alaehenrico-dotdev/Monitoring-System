import { http } from "./http";
import type { QueueItem } from "./ops";

export interface AlertItem extends Omit<QueueItem, "kind"> {
  kind: QueueItem["kind"] | "drift";
}

export interface Alerts {
  generatedAt: string;
  total: number;
  /// Problems worth interrupting someone for (high severity).
  urgent: number;
  items: AlertItem[];
}

/// Supervisor/Admin only (the server enforces it).
export const getAlerts = () => http.get<Alerts>("/alerts");
export const getPushKey = () => http.get<{ publicKey: string | null }>("/alerts/push-key");
export const savePushSubscription = (sub: PushSubscriptionJSON) => http.post<{ success: boolean }>("/alerts/subscribe", sub);
export const removePushSubscription = (endpoint: string) => http.post<{ success: boolean }>("/alerts/unsubscribe", { endpoint });
