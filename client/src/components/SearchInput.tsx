import { SearchIcon } from "./icons";

/// A toolbar search box - icon inset on the left, filters the grid it sits
/// above as the user types (see utils/search.ts for the matching logic).
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /// Extra class on the <input> itself.
  className?: string;
}) {
  return (
    <div
      style={{ position: "relative", display: "flex", alignItems: "center" }}
    >
      <span
        className="ae-search-icon"
        style={{
          position: "absolute",
          left: 10,
          display: "flex",
          pointerEvents: "none",
        }}
      >
        <SearchIcon />
      </span>
      <input
        className={className ? `ae-input ${className}` : "ae-input"}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search"
        style={{ paddingLeft: 30 }}
      />
    </div>
  );
}
