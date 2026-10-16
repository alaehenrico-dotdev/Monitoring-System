import { http } from "./http";

/// One row of a product-order template: a product and the category it sits under.
export interface OrderTemplateRow {
  category: string;
  name: string;
}

export interface SavedOrderTemplate {
  id: number;
  name: string;
  rows: OrderTemplateRow[];
  updatedAt: string;
}

/// Saved product-order templates (Supervisor/Admin). They live in the database,
/// so they are still there after a reset or rebuild.
export function listOrderTemplates() {
  return http.get<SavedOrderTemplate[]>("/order-templates");
}

/// Saves a template under a name; an existing name is replaced.
export function saveOrderTemplate(name: string, rows: OrderTemplateRow[]) {
  return http.post<SavedOrderTemplate>("/order-templates", { name, rows });
}

export function deleteOrderTemplate(id: number) {
  return http.delete<{ deleted: boolean }>(`/order-templates/${id}`);
}
