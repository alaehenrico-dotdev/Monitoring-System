import { http } from "./http";

export interface SystemLogEntry {
  id: number;
  event: string;
  fromVersion: string;
  toVersion: string;
  occurredAt: string;
  user: { id: number; name: string; username: string } | null;
}

export function recordSystemLog(data: { event: string; fromVersion: string; toVersion: string }) {
  return http.post<SystemLogEntry>("/system-log", data);
}

export function listSystemLog() {
  return http.get<SystemLogEntry[]>("/system-log");
}
