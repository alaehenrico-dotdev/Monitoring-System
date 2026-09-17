import { SearchIcon } from "./icons";
import { colors } from "../theme";

/// A toolbar search box - icon inset on the left, filters the grid it sits
/// above as the user types (see utils/search.ts for the matching logic).
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <span style={{ position: "absolute", left: 9, color: colors.subtleInk, display: "flex", pointerEvents: "none" }}>
        <SearchIcon />
      </span>
      <input
        className="ae-input"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search"
        style={{ paddingLeft: 28, width: 280 }}
      />
    </div>
  );
}
