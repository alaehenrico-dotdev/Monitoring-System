import { useState } from "react";
import { Select, TextInput } from "./ui";

const NEW = "__new__";

/**
 * Picks a product's category from the ones that already exist, or starts a new
 * one. A category is just text on each product, so typing it freehand is how
 * "Class A (Gallon)" and "CLASS A (GALLON)" ended up as two groups that look the
 * same - choosing from the list prevents that. The server also joins a typed
 * category to an existing one regardless of case and spacing.
 */
export function CategoryField({
  categories,
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel = "Category",
}: {
  categories: readonly string[];
  /// The chosen category, or what is typed for a new one ("" = nothing yet).
  value: string;
  onChange: (category: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  // Whether "New category…" was picked. A value that is not in the list (typed,
  // or pre-filled) is a new category too, whatever this says.
  const [creating, setCreating] = useState(false);
  const isNew = creating || (value !== "" && !categories.includes(value));

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <Select
        aria-label={ariaLabel}
        value={isNew ? NEW : value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === NEW) {
            setCreating(true);
            onChange("");
          } else {
            setCreating(false);
            onChange(e.target.value);
          }
        }}
        style={{ width: "auto", minWidth: 160, maxWidth: 260 }}
      >
        <option value="">Choose a category…</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value={NEW}>+ New category…</option>
      </Select>
      {isNew && (
        <TextInput
          aria-label="New category name"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="New category name"
          maxLength={100}
          style={{ width: 180 }}
        />
      )}
    </span>
  );
}
