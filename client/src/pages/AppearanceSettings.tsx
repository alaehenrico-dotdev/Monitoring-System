import { useId, type CSSProperties, type ReactNode } from "react";
import { useTheme, type Theme, type UiStyle } from "../context/ThemeContext";
import { colors } from "../theme";

interface Choice<T extends string> {
  value: T;
  label: string;
  description: string;
  preview: ReactNode;
}

const MODES: Choice<Theme>[] = [
  {
    value: "light",
    label: "Light",
    description: "Warm paper background with dark text. Best in a bright room.",
    preview: <ModePreview dark={false} />,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Charcoal background with light text. Easier on the eyes at night.",
    preview: <ModePreview dark />,
  },
];

const THEMES: Choice<UiStyle>[] = [
  {
    value: "classic",
    label: "Classic",
    description: "The glass header with gold accents, warm cream surfaces and the Ala Eh! seal behind the page. The look you have been using.",
    preview: <ThemePreview enterprise={false} />,
  },
  {
    value: "enterprise",
    label: "Enterprise",
    description: "A more formal business look: an ink-black header with a gold rule, flat ruled tables and square controls. Same pages and shortcuts as Classic.",
    preview: <ThemePreview enterprise />,
  },
];

/**
 * Settings > Appearance: how the app looks on THIS browser. The color mode
 * (light/dark) and the theme (Classic/Enterprise) are independent, remembered per
 * browser (ThemeContext), apply immediately, and change only how things are
 * drawn - never the pages, the controls or the data - which is why every role can
 * reach them, unlike the other Settings tabs.
 */
export function AppearanceSettings() {
  const { theme, setTheme, uiStyle, setUiStyle } = useTheme();
  return (
    <div style={{ width: "100%", maxWidth: 880, margin: "0 auto", display: "grid", gap: 22 }}>
      <ChoiceGroup legend="Color mode" choices={MODES} value={theme} onChange={setTheme} />
      <ChoiceGroup legend="Theme" choices={THEMES} value={uiStyle} onChange={setUiStyle} />
      <p style={{ margin: 0, fontSize: 12.5, color: colors.subtleInk }}>
        These are saved in this browser only. Another computer, or another person signing in here after you, keeps their own choice.
      </p>
    </div>
  );
}

function ChoiceGroup<T extends string>({
  legend,
  choices,
  value,
  onChange,
}: {
  legend: string;
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  // The radio is named by its title alone and described by the sentence under it,
  // so a screen reader says "Classic" or "Enterprise", not the whole paragraph
  // (which can mention the other option).
  const groupId = useId();
  return (
    <fieldset style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
      <legend style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, padding: 0, color: colors.ink }}>{legend}</legend>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: 14 }}>
        {choices.map((c) => {
          const selected = c.value === value;
          return (
            <label key={c.value} className={`ae-choice-card${selected ? " ae-choice-card--selected" : ""}`}>
              <input
                type="radio"
                name={legend}
                value={c.value}
                checked={selected}
                onChange={() => onChange(c.value)}
                aria-labelledby={`${groupId}-${c.value}-title`}
                aria-describedby={`${groupId}-${c.value}-desc`}
              />
              <span className="ae-choice-card-preview" aria-hidden>
                {c.preview}
              </span>
              <span id={`${groupId}-${c.value}-title`} style={{ display: "block", fontWeight: 600, marginTop: 8 }}>
                {c.label}
              </span>
              <span id={`${groupId}-${c.value}-desc`} style={{ display: "block", fontSize: 12.5, color: colors.subtleInk, marginTop: 2 }}>
                {c.description}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------- previews
   Tiny drawings of each choice. They use fixed colors on purpose: they show how
   the option LOOKS, not how the current theme looks. */

const bar = (w: string | number, h: number, color: string, extra: CSSProperties = {}): CSSProperties => ({ width: w, height: h, background: color, borderRadius: 2, ...extra });

function ModePreview({ dark }: { dark: boolean }) {
  const page = dark ? "#1a1a1a" : "#fffcf5";
  const card = dark ? "#262626" : "#ffffff";
  const ink = dark ? "#e5e5e5" : "#241d14";
  return (
    <span style={{ display: "block", background: page, padding: 10, height: 86, borderRadius: 4 }}>
      <span style={{ display: "block", background: card, border: `1px solid ${dark ? "#3a3a3a" : "#e7dfc9"}`, borderRadius: 3, padding: 8, height: "100%" }}>
        <span style={{ display: "block", ...bar("55%", 7, ink) }} />
        <span style={{ display: "block", ...bar("85%", 5, dark ? "#555" : "#c9c0a8", { marginTop: 7 }) }} />
        <span style={{ display: "block", ...bar("40%", 8, "#f5c000", { marginTop: 9 }) }} />
      </span>
    </span>
  );
}

function ThemePreview({ enterprise }: { enterprise: boolean }) {
  if (!enterprise) {
    return (
      <span style={{ display: "block", background: "#fffcf5", padding: 8, height: 86, borderRadius: 4 }}>
        <span style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <span style={bar(26, 4, "#c9c0a8")} />
          <span style={bar(26, 4, "#f5c000")} />
          <span style={bar(26, 4, "#c9c0a8")} />
        </span>
        <span style={{ display: "block", background: "rgba(245,192,0,0.18)", border: "1px solid #d4a000", borderRadius: 6, height: 22 }} />
        <span style={{ display: "block", ...bar("100%", 5, "#e7dfc9", { marginTop: 8 }) }} />
        <span style={{ display: "block", ...bar("100%", 5, "#e7dfc9", { marginTop: 5 }) }} />
        <span style={{ display: "block", ...bar("100%", 5, "#e7dfc9", { marginTop: 5 }) }} />
      </span>
    );
  }
  return (
    <span style={{ display: "block", background: "#f4f2ec", height: 86, borderRadius: 4, overflow: "hidden" }}>
      <span style={{ display: "flex", gap: 6, padding: "5px 8px", background: "#ffffff", borderBottom: "1px solid #d6cfbb" }}>
        <span style={bar(26, 4, "#b9b19a", { borderRadius: 0 })} />
        <span style={bar(26, 4, "#d4a000", { borderRadius: 0 })} />
        <span style={bar(26, 4, "#b9b19a", { borderRadius: 0 })} />
      </span>
      <span style={{ display: "block", background: "#0c0c0c", borderBottom: "3px solid #f5c000", height: 20 }} />
      <span style={{ display: "block", padding: "6px 8px" }}>
        <span style={{ display: "block", ...bar("100%", 6, "#ece6d4", { borderRadius: 0 }) }} />
        <span style={{ display: "block", ...bar("100%", 5, "#ffffff", { marginTop: 3, border: "1px solid #d6cfbb", borderRadius: 0 }) }} />
        <span style={{ display: "block", ...bar("100%", 5, "#ffffff", { marginTop: 2, border: "1px solid #d6cfbb", borderRadius: 0 }) }} />
      </span>
    </span>
  );
}
