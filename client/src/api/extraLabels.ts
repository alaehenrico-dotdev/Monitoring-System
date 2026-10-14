import { http } from "./http";
import type { Shift } from "../types";

export type ExtraLabelLocation = "ONLINE" | "OFFLINE";

export interface ExtraLabel {
  columnKey: string;
  slotIndex: number;
  label: string;
}

export function getExtraLabels(location: ExtraLabelLocation, date: string, shift: Shift) {
  return http.get<ExtraLabel[]>(`/extra-labels?location=${location}&date=${date}&shift=${shift}`);
}

/// A blank label clears the name.
export function saveExtraLabel(data: {
  location: ExtraLabelLocation;
  date: string;
  shift: Shift;
  columnKey: string;
  slotIndex: number;
  label: string;
}) {
  return http.put<{ label: string }>("/extra-labels", data);
}
