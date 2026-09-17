import { http } from "./http";
import type { TotalStockRow } from "../types";

export function getTotalStocks(date: string) {
  return http.get<TotalStockRow[]>(`/total-stocks?date=${date}`);
}
