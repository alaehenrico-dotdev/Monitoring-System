import { Dropdown } from "./Dropdown";

/// A toolbar dropdown that narrows the grid/table above it to one category
/// at a time - sits beside SearchInput (see OnlineEntryPage, OfflineEntryPage,
/// TotalStocksPage, ManualCountPage) as a second, exact-match filter
/// alongside its free-text search, rather than replacing it.
export function CategoryFilter({
  categories,
  value,
  onChange,
}: {
  categories: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Dropdown
      aria-label="Filter by category"
      value={value}
      onChange={onChange}
      options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c, label: c }))]}
    />
  );
}
