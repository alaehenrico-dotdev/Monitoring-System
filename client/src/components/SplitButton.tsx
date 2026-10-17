import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronIcon } from "./icons";
import { MenuPanel, type MenuItemDef } from "./MenuBar";

export interface SplitButtonProps {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /// Set => the main action is unavailable. The button stays focusable (so the
  /// reason can be found by keyboard and screen reader) and this is its tooltip.
  disabledReason?: string;
  /// The chevron's menu: the secondary ways of doing the same thing.
  items: MenuItemDef[];
  /// Accessible name of that menu.
  menuLabel: string;
  /// "warn": the outlined amber style for a consequential action.
  tone?: "default" | "warn";
  /// A steady ring that says "this is ready" without a word (never a blink).
  attention?: boolean;
  /// Drawn on the main button next to the label, e.g. a hint like "ready".
  title?: string;
}

/**
 * A button with a chevron beside it: the main action on the left, the less common
 * variants of it in the menu on the right. Used for Finish, where "Finish day" is
 * the usual thing and "Finish through a date…" is the exception.
 *
 * Both halves are real buttons with their own focus ring. The menu is the same
 * list the menu bar uses (so the same keyboard behaviour), aligned to the right
 * edge so it opens inward from where this sits - at the end of the bar.
 */
export function SplitButton({ label, icon, onClick, disabledReason, items, menuLabel, tone = "default", attention = false, title }: SplitButtonProps) {
  // The element the menu hangs from, captured when it opens (in a handler) - null
  // means closed. Not read from the ref while rendering.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;
  const rootRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const disabled = !!disabledReason;

  function onChevronKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAnchor(rootRef.current);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setAnchor(null);
    }
  }

  return (
    <div ref={rootRef} role="group" aria-label={label} className={`ae-split ae-split--${tone}${attention ? " ae-split--attention" : ""}`}>
      <button
        type="button"
        className="ae-mb-btn ae-split-main"
        aria-disabled={disabled || undefined}
        aria-describedby={disabled ? reasonId : undefined}
        title={disabledReason ?? title}
        onClick={() => !disabled && onClick()}
      >
        {icon}
        <span>{label}</span>
      </button>
      {disabled && (
        <span id={reasonId} hidden>
          {disabledReason}
        </span>
      )}
      {items.length > 0 && (
        <button
          ref={chevronRef}
          type="button"
          className="ae-mb-btn ae-split-chevron"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${label}: more options`}
          title={`${label}: more options`}
          onClick={() => setAnchor(open ? null : rootRef.current)}
          onKeyDown={onChevronKeyDown}
        >
          <ChevronIcon />
        </button>
      )}
      {anchor && (
        <MenuPanel
          anchor={anchor}
          label={menuLabel}
          sections={[{ items }]}
          align="end"
          onClose={(restoreFocus) => {
            setAnchor(null);
            if (restoreFocus) chevronRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
