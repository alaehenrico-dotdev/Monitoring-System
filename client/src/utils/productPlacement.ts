import { strictNameKey } from "./importMatch";

/// Where the server puts a newly added product (products.service createProduct):
/// right after the last product of its category, or at the end for a new
/// category. Used to place it in a list already on screen the same way, so the
/// list matches what is saved without reloading it.
export function insertAfterCategory<T extends { category: string }>(list: readonly T[], item: T): T[] {
  const wanted = strictNameKey(item.category);
  let at = list.length;
  for (let i = list.length - 1; i >= 0; i--) {
    if (strictNameKey(list[i].category) === wanted) {
      at = i + 1;
      break;
    }
  }
  return [...list.slice(0, at), item, ...list.slice(at)];
}

/// The category names in `list`, each once, in the order they first appear.
export function categoriesOf(list: readonly { category: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { category } of list) {
    const key = strictNameKey(category);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(category);
  }
  return out;
}

/// The unit used by the products already in `category`, to pre-fill the form.
export function unitForCategory(list: readonly { category: string; unit: string }[], category: string): string {
  const wanted = strictNameKey(category);
  return list.find((p) => strictNameKey(p.category) === wanted)?.unit ?? "";
}
