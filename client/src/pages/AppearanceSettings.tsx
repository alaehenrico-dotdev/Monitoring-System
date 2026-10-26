import { useEffect, useId, type CSSProperties, type ReactNode } from "react";
import {
  DEFAULT_FONT,
  DEFAULT_FONT_SIZE,
  ensureWebFont,
  FONT_FAMILIES,
  useTheme,
  type FontFamily,
  type FontSize,
  type Theme,
  type UiStyle,
} from "../context/ThemeContext";
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
    value: "minimal",
    label: "Minimalism",
    description: "Only what is information: no fills, shadows or glow. Plain text on a quiet page, hairline rules, ink buttons and a muted-to-dark text scale. Same pages and shortcuts as Classic.",
    preview: <MinimalPreview />,
  },
  {
    value: "skeuo",
    label: "Skeuomorphism",
    description: "Things that look real: a parchment desk, a stitched leather header, embossed metal table headers, glossy push buttons and recessed fields.",
    preview: <SkeuoPreview />,
  },
  {
    value: "aurora",
    label: "Aurora",
    description: "A modern indigo-to-violet-to-pink gradient on the header, buttons, active tab and category bars, over cool soft surfaces. Every corner is 4px. Same pages and shortcuts as Classic.",
    preview: <AuroraPreview />,
  },
  {
    value: "plus",
    label: "Classic Plus",
    description: "Classic, refined: the same cream and charcoal with brand gold, but a clearer frosted header and soft layered shadows instead of glow. Same pages and shortcuts as Classic.",
    preview: <PlusPreview />,
  },
];


const FONT_CHOICES: Choice<FontFamily>[] = [
  { value: "inter", label: "Inter", description: "The default: clean and easy to read at small sizes.", preview: <FontPreview family="'Inter', system-ui, sans-serif" /> },
  { value: "hyperlegible", label: "Atkinson Hyperlegible", description: "Designed for low vision: every letter is easy to tell apart.", preview: <FontPreview family="'Atkinson Hyperlegible', system-ui, sans-serif" /> },
  { value: "plex", label: "IBM Plex Sans", description: "A neutral, slightly technical sans-serif.", preview: <FontPreview family="'IBM Plex Sans', system-ui, sans-serif" /> },
  { value: "system", label: "System", description: "The font your device already uses. Nothing to download.", preview: <FontPreview family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" /> },
  { value: "serif", label: "Serif", description: "A traditional book-style face.", preview: <FontPreview family="Georgia, Cambria, 'Times New Roman', serif" /> },
  { value: "mono", label: "Monospace", description: "Every character the same width, so figures line up.", preview: <FontPreview family="ui-monospace, 'Cascadia Mono', Consolas, monospace" /> },
];

const SIZE_STEPS: Record<FontSize, number> = { sm: 0.92, md: 1, lg: 1.1, xl: 1.2 };
const SIZE_CHOICES: Choice<FontSize>[] = [
  { value: "sm", label: "Small", description: "Fits more on the screen.", preview: <SizePreview step="sm" /> },
  { value: "md", label: "Default", description: "The standard size.", preview: <SizePreview step="md" /> },
  { value: "lg", label: "Large", description: "Easier to read from a distance.", preview: <SizePreview step="lg" /> },
  { value: "xl", label: "Extra large", description: "The biggest step.", preview: <SizePreview step="xl" /> },
];

function FontPreview({ family }: { family: string }) {
  return (
    <span style={{ display: "block", background: "var(--ae-surface)", color: "var(--ae-text)", padding: "10px 12px", height: 62, borderRadius: 4, fontFamily: family }}>
      <span style={{ display: "block", fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>Aa 123</span>
      <span style={{ display: "block", fontSize: 12, marginTop: 4, color: "var(--ae-text-muted)" }}>Ala Eh! Stock 1,284.50</span>
    </span>
  );
}

function SizePreview({ step }: { step: FontSize }) {
  return (
    <span style={{ display: "flex", alignItems: "center", background: "var(--ae-surface)", color: "var(--ae-text)", padding: "0 12px", height: 62, borderRadius: 4 }}>
      <span style={{ fontSize: 14 * SIZE_STEPS[step], fontWeight: 600, lineHeight: 1.2 }}>Stock on hand: 1,284</span>
    </span>
  );
}

/// Settings > Appearance > Font: the typeface and the text size, per browser like
/// the theme. The text size scales the interface; the data tables keep their own
/// View > Zoom.
function FontSettings() {
  const { fontFamily, setFontFamily, fontSize, setFontSize, resetFont } = useTheme();
  // The two downloadable faces are fetched here so their previews are real.
  useEffect(() => {
    FONT_FAMILIES.forEach(ensureWebFont);
  }, []);
  const isDefault = fontFamily === DEFAULT_FONT && fontSize === DEFAULT_FONT_SIZE;
  return (
    <>
      <ChoiceGroup legend="Font" choices={FONT_CHOICES} value={fontFamily} onChange={setFontFamily} />
      <ChoiceGroup legend="Text size" choices={SIZE_CHOICES} value={fontSize} onChange={setFontSize} />
      <p style={{ margin: 0, fontSize: 12.5, color: colors.subtleInk }}>
        Text size changes the menus, forms and pages. The data tables keep their own size: use View, then Zoom, on the page.
      </p>
      <div>
        <button type="button" className="ae-btn ae-btn-secondary ae-btn-sm" onClick={resetFont} disabled={isDefault}>
          Reset font to default
        </button>
      </div>
    </>
  );
}

/**
 * Settings > Appearance: how the app looks on THIS browser. The color mode
 * (light/dark) and the theme (Classic, Enterprise, Neobrutalism, Flat, Glass, Minimalism, Skeuomorphic, Aurora, Classic Plus) and the font are independent, remembered per
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
      <FontSettings />
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

function MinimalPreview() {
  const rule = "1px solid #e6e6e3";
  return (
    <span style={{ display: "block", background: "#ffffff", height: 86, borderRadius: 4, overflow: "hidden", padding: "10px 10px", border: rule }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={bar(64, 7, "#1a1a1a", { borderRadius: 1 })} />
        <span style={bar(28, 5, "#c9c9c4", { borderRadius: 1 })} />
        <span style={bar(28, 5, "#c9c9c4", { borderRadius: 1 })} />
        <span style={bar(32, 12, "#1a1a1a", { borderRadius: 3, marginLeft: "auto" })} />
      </span>
      <span style={{ display: "block", borderBottom: rule, marginTop: 8 }} />
      <span style={{ display: "block", ...bar("100%", 5, "#efefec", { borderRadius: 1, marginTop: 8 }) }} />
      <span style={{ display: "block", borderBottom: rule, marginTop: 6 }} />
      <span style={{ display: "block", ...bar("70%", 5, "#efefec", { borderRadius: 1, marginTop: 7 }) }} />
      <span style={{ display: "block", borderBottom: rule, marginTop: 6 }} />
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

function PlusPreview() {
  const lift = "0 6px 14px -4px rgba(31,26,18,0.22), 0 1px 2px rgba(31,26,18,0.1)";
  return (
    <span style={{ display: "block", background: "#faf7f0", padding: 8, height: 86, borderRadius: 4 }}>
      <span
        style={{
          display: "block",
          height: 24,
          borderRadius: 8,
          background: "linear-gradient(180deg, rgba(255,255,255,0.9), rgba(255,253,247,0.6))",
          border: "1px solid rgba(255,255,255,0.8)",
          boxShadow: `inset 0 1px 0 #fff, 0 0 0 1px rgba(31,26,18,0.08), ${lift}`,
        }}
      />
      <span style={{ display: "block", ...bar("100%", 18, "#ffffff", { marginTop: 10, borderRadius: 6, border: "1px solid #e4dcc6", boxShadow: "0 3px 8px -2px rgba(31,26,18,0.14)" }) }} />
      <span style={{ display: "block", ...bar(34, 8, "#f5c000", { marginTop: 8, borderRadius: 4 }) }} />
    </span>
  );
}

function AuroraPreview() {
  const grad = "linear-gradient(120deg, #4f46e5, #7c3aed 55%, #c026d3)";
  return (
    <span style={{ display: "block", background: "radial-gradient(90px 60px at 0% 0%, rgba(99,102,241,0.25), transparent 70%), radial-gradient(90px 60px at 100% 0%, rgba(217,70,239,0.2), transparent 70%), #f5f5fd", height: 86, borderRadius: 4, padding: 8 }}>
      <span style={{ display: "block", height: 22, borderRadius: 4, background: grad, boxShadow: "0 6px 14px -6px rgba(79,70,229,0.6)" }} />
      <span style={{ display: "block", ...bar("100%", 20, "#ffffff", { marginTop: 8, borderRadius: 4, border: "1px solid #dcdbf0", boxShadow: "0 3px 8px -3px rgba(30,27,75,0.2)" }) }} />
      <span style={{ display: "block", ...bar(34, 9, "#4f46e5", { marginTop: 8, borderRadius: 4, background: grad }) }} />
    </span>
  );
}
