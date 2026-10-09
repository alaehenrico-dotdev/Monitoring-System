import { useRef, useState } from "react";
import { SearchIcon } from "./icons";

/// A toolbar search - an icon until it is wanted, so it doesn't take toolbar
/// room from the controls beside it. Click the icon to open the box; it stays
/// open while it has text (so an active filter is never hidden) and folds
/// back to the icon when it loses focus empty. Filters the grid it sits above
/// as the user types (see utils/search.ts for the matching logic). Sizing and
/// the open/closed animation live in index.css (.ae-search).
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const open = focused || value !== "";

  return (
    <div className={`ae-search${open ? " ae-search--open" : ""}`}>
      <button
        type="button"
        className="ae-search-toggle"
        aria-label="Search"
        aria-expanded={open}
        title={placeholder}
        onClick={() => inputRef.current?.focus()}
      >
        <SearchIcon />
      </button>
      <input
        ref={inputRef}
        className={className ? `ae-input ${className}` : "ae-input"}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label="Search"
        tabIndex={open ? 0 : -1}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          // Escape clears an active search, then folds it away.
          if (e.key !== "Escape") return;
          e.stopPropagation();
          if (value !== "") onChange("");
          e.currentTarget.blur();
        }}
      />
    </div>
  );
}
