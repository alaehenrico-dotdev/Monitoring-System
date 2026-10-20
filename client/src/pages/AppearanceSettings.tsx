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
  {
    value: "brutal",
    label: "Neobrutalism",
    description: "Loud and graphic, in the Ala Eh! colors: thick black outlines, hard offset shadows, flat gold headers and red actions on the original cream page. Same pages and shortcuts as Classic.",
    preview: <BrutalPreview />,
  },
  {
    value: "flat",
    label: "Flat Design",
    description: "Solid colour blocks and nothing else: no shadows, outlines or gradients. Gold header, ink tabs and table headers, red actions. Same pages and shortcuts as Classic.",
    preview: <FlatPreview />,
  },
  {
    value: "glass",
    label: "Glassmorphism",
    description: "Frosted, translucent panes with a backdrop blur floating over a soft gold, red and green glow. Same pages and shortcuts as Classic.",
    preview: <GlassPreview />,
  },
  {
    value: "card",
    label: "Card-Based UI",
    description: "Every area is its own white card on a neutral page, with soft shadows, rounded corners and tabs that look like small cards.",
    preview: <CardPreview />,
  },
  {
    value: "skeuo",
    label: "Skeuomorphism",
    description: "Things that look real: a parchment desk, a stitched leather header, embossed metal table headers, glossy push buttons and recessed fields.",
    preview: <SkeuoPreview />,
  },
  {
    value: "carbon",
    label: "Carbon Design System",
    description: "IBM Carbon: a black shell header, square grey-ruled layout, IBM Plex Sans, blue primary buttons and an underlined active tab.",
    preview: <CarbonPreview />,
  },
];

/**
 * Settings > Appearance: how the app looks on THIS browser. The color mode
 * (light/dark) and the theme (Classic, Enterprise, Neobrutalism, Flat, Glass, Card, Skeuomorphic, Carbon) are independent, remembered per
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

function BrutalPreview() {
  const ink = "#0c0c0c";
  return (
    <span style={{ display: "block", background: "#fffcf5", height: 86, borderRadius: 4, overflow: "hidden", padding: 8 }}>
      <span style={{ display: "block", background: "#f5c000", border: `2px solid ${ink}`, boxShadow: `3px 3px 0 ${ink}`, height: 20 }} />
      <span style={{ display: "flex", gap: 6, marginTop: 9 }}>
        <span style={{ display: "block", flex: 1, border: `2px solid ${ink}`, boxShadow: `3px 3px 0 ${ink}`, background: "#ffffff" }}>
          <span style={{ display: "block", height: 9, background: "#f5c000", borderBottom: `2px solid ${ink}` }} />
          <span style={{ display: "block", height: 8, background: "#ffffff", borderBottom: `1px solid ${ink}` }} />
        </span>
        <span style={{ display: "block", width: 34, height: 18, background: "#c1272d", border: `2px solid ${ink}`, boxShadow: `3px 3px 0 ${ink}` }} />
      </span>
    </span>
  );
}

function FlatPreview() {
  return (
    <span style={{ display: "block", background: "#f2eee3", height: 86, borderRadius: 4, overflow: "hidden", padding: 8 }}>
      <span style={{ display: "block", background: "#f5c000", borderRadius: 4, height: 20 }} />
      <span style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <span style={bar(30, 8, "#0c0c0c", { borderRadius: 4 })} />
        <span style={bar(30, 8, "#e4ddc9", { borderRadius: 4 })} />
        <span style={bar(30, 8, "#c1272d", { borderRadius: 4, marginLeft: "auto" })} />
      </span>
      <span style={{ display: "block", ...bar("100%", 6, "#0c0c0c", { borderRadius: 4, marginTop: 8 }) }} />
      <span style={{ display: "block", ...bar("100%", 6, "#ffffff", { borderRadius: 4, marginTop: 3 }) }} />
    </span>
  );
}

function GlassPreview() {
  const pane = { display: "block", background: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.8)", boxShadow: "0 4px 14px rgba(90,60,0,0.18)" } as const;
  return (
    <span
      style={{
        display: "block",
        height: 86,
        borderRadius: 4,
        overflow: "hidden",
        padding: 8,
        background:
          "radial-gradient(70px 50px at 8% 10%, rgba(245,192,0,0.7), transparent 70%), radial-gradient(70px 50px at 95% 15%, rgba(193,39,45,0.5), transparent 70%), radial-gradient(90px 60px at 60% 100%, rgba(47,107,60,0.45), transparent 70%), #f3e9cf",
      }}
    >
      <span style={{ ...pane, height: 20, borderRadius: 10 }} />
      <span style={{ ...pane, height: 34, borderRadius: 10, marginTop: 8 }} />
    </span>
  );
}

function CardPreview() {
  const card = { display: "block", background: "#ffffff", borderRadius: 7, boxShadow: "0 1px 2px rgba(20,18,10,0.1), 0 4px 10px -2px rgba(20,18,10,0.15)" } as const;
  return (
    <span style={{ display: "block", background: "#ecebe6", height: 86, borderRadius: 4, overflow: "hidden", padding: 8 }}>
      <span style={{ ...card, height: 20, borderTop: "3px solid #f5c000" }} />
      <span style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <span style={{ ...card, flex: 1, height: 34 }} />
        <span style={{ ...card, flex: 1, height: 34 }} />
        <span style={{ ...card, flex: 1, height: 34 }} />
      </span>
    </span>
  );
}

function SkeuoPreview() {
  return (
    <span style={{ display: "block", background: "#e9dfc6", height: 86, borderRadius: 4, overflow: "hidden", padding: 8 }}>
      <span style={{ display: "block", height: 22, borderRadius: 6, background: "linear-gradient(180deg, #4a3826, #33261a)", outline: "1px dashed rgba(253,208,35,0.6)", outlineOffset: -3, boxShadow: "0 3px 6px rgba(40,25,5,0.4)" }} />
      <span style={{ display: "block", marginTop: 7, height: 9, borderRadius: 2, background: "linear-gradient(180deg, #f5ecd0, #d6c8a2)", boxShadow: "inset 0 1px 0 #fff, inset 0 -1px 0 #a89668" }} />
      <span style={{ display: "flex", gap: 6, marginTop: 7 }}>
        <span style={{ display: "block", width: 34, height: 14, borderRadius: 5, background: "linear-gradient(180deg, #e0454b, #c1272d 50%, #9e1f24 51%, #b3242a)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45), 0 2px 3px rgba(0,0,0,0.35)" }} />
        <span style={{ display: "block", width: 34, height: 14, borderRadius: 5, background: "linear-gradient(180deg, #ffe36b, #f5c000 50%, #dba500 51%, #eab400)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 2px 3px rgba(0,0,0,0.3)" }} />
      </span>
    </span>
  );
}

function CarbonPreview() {
  return (
    <span style={{ display: "block", background: "#f4f4f4", height: 86, borderRadius: 4, overflow: "hidden" }}>
      <span style={{ display: "block", height: 16, background: "#161616" }} />
      <span style={{ display: "flex", gap: 8, padding: "5px 8px 0", background: "#ffffff", borderBottom: "1px solid #e0e0e0" }}>
        <span style={{ display: "block", width: 26, height: 7, borderBottom: "2px solid #0f62fe", background: "#e0e0e0", borderRadius: 0 }} />
        <span style={bar(26, 5, "#c6c6c6", { borderRadius: 0 })} />
      </span>
      <span style={{ display: "block", padding: "6px 8px" }}>
        <span style={{ display: "block", ...bar("100%", 7, "#e0e0e0", { borderRadius: 0 }) }} />
        <span style={{ display: "block", ...bar("100%", 6, "#ffffff", { borderRadius: 0, marginTop: 1 }) }} />
        <span style={{ display: "block", ...bar(34, 9, "#0f62fe", { borderRadius: 0, marginTop: 6 }) }} />
      </span>
    </span>
  );
}
