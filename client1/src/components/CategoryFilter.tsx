import { Select } from "./ui";

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
    <Select aria-label="Filter by category" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All categories</option>
      {categories.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </Select>
  );
}
