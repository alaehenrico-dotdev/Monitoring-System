import { useEffect, useId, type CSSProperties, type ReactNode } from "react";
import {
  DEFAULT_FONT,
  DEFAULT_FONT_SIZE,
  ensureWebFont,
  FONT_FAMILIES,
  useTheme,
  type ChartLook,
  type ChartType,
  type FontFamily,
  type FontSize,
  type HeaderStyle,
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
    description: "Warm paper, dark text. Best in a bright room.",
    preview: <ModePreview dark={false} />,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Charcoal background, light text. Easier at night.",
    preview: <ModePreview dark />,
  },
];

const THEMES: Choice<UiStyle>[] = [
  {
    value: "classic",
    label: "Classic",
    description: "Gold accents on warm cream. The default look.",
    preview: <ClassicPreview />,
  },
  {
    value: "brutal",
    label: "Neobrutalism",
    description: "Bold and graphic: thick black outlines and hard shadows.",
    preview: <BrutalPreview />,
  },
  {
    value: "glass",
    label: "Glassmorphism",
    description: "Frosted, see-through panes over a soft colour glow.",
    preview: <GlassPreview />,
  },
  {
    value: "minimal",
    label: "Minimalism",
    description: "Plain and quiet: no fills, shadows or glow.",
    preview: <MinimalPreview />,
  },
  {
    value: "skeuo",
    label: "Skeuomorphism",
    description: "Real-world textures: parchment, leather, metal and glossy buttons.",
    preview: <SkeuoPreview />,
  },
  {
    value: "studio",
    label: "Studio",
    description: "Flat, editor-style look with tabs in their own strip.",
    preview: <StudioPreview />,
  },
];

/// How the pinned header and its toolbar are arranged. Independent of the theme above: the theme paints,
/// these arrange. Every layout keeps the header pinned to the top and keeps every control.
const HEADERS: Choice<HeaderStyle>[] = [
  {
    value: "standard",
    label: "Standard",
    description: "Tabs on top, then the title card, with the toolbar below.",
    preview: <HeaderPreview kind="standard" />,
  },
  {
    value: "inline",
    label: "Inline",
    description: "Title and toolbar on one line. Shows the most rows.",
    preview: <HeaderPreview kind="inline" />,
  },
  {
    value: "ribbon",
    label: "Ribbon",
    description: "A slim title with the toolbar as a full-width band.",
    preview: <HeaderPreview kind="ribbon" />,
  },
  {
    value: "dock",
    label: "Dock",
    description: "Page tabs sit below the toolbar, next to the data.",
    preview: <HeaderPreview kind="dock" />,
  },
];


/// Settings > Appearance > Charts: the drawing of the Dashboard stock-flow chart and the Daily Out chart.
const CHART_TYPE_CHOICES: Choice<ChartType>[] = [
  { value: "line", label: "Lines", description: "One smooth curve per series. The default.", preview: <ChartPreview type="line" look="classic" /> },
  { value: "bar", label: "Grouped bars", description: "Side-by-side bars for each day. Easy to compare exact days.", preview: <ChartPreview type="bar" look="classic" /> },
  { value: "stack", label: "Stacked bars", description: "Each day is a stack of equal square blocks in the series colours. The taller the stack, the more stock.", preview: <ChartPreview type="stack" look="classic" /> },
  { value: "area", label: "Area", description: "Curves with the space under them filled in.", preview: <ChartPreview type="area" look="classic" /> },
];
const CHART_LOOK_CHOICES: Choice<ChartLook>[] = [
  { value: "classic", label: "Detailed", description: "Grid lines and a dot on every reading. The default.", preview: <ChartPreview type="line" look="classic" /> },
  { value: "minimal", label: "Clean", description: "Thin marks, no grid or dots. Just the shape.", preview: <ChartPreview type="line" look="minimal" /> },
  { value: "bold", label: "Bold", description: "Thick marks and big dots. Easy to read from a distance.", preview: <ChartPreview type="line" look="bold" /> },
];

const PREVIEW_A = [14, 30, 22, 40, 34, 46];
const PREVIEW_B = [8, 16, 26, 20, 30, 24];

/// A tiny chart with the choice's own drawing (fixed colours, like the other previews).
function ChartPreview({ type, look }: { type: ChartType; look: ChartLook }) {
  const w = 120;
  const h = 56;
  const step = w / PREVIEW_A.length;
  const px = (i: number) => step * i + step / 2;
  const py = (v: number) => h - v;
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${px(i)} ${py(v)}`).join(" ");
  const stroke = look === "bold" ? 3.5 : look === "minimal" ? 1.2 : 2;
  const colors2 = ["#d4a000", "#2f6b3c"];
  return (
    <span style={{ display: "block", background: "#fffcf5", height: 86, borderRadius: 4, padding: 8 }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none" aria-hidden>
        {look !== "minimal" && [0.33, 0.66].map((f) => <line key={f} x1="0" x2={w} y1={h * f} y2={h * f} stroke="#e7dfc9" strokeWidth="1" />)}
        <line x1="0" x2={w} y1={h - 0.5} y2={h - 0.5} stroke="#c9c0a8" strokeWidth="1" />
        {type === "stack"
          ? PREVIEW_A.map((a0, i) => {
              // Equal square blocks, one per fixed amount, the first series at the bottom.
              const blocks = [...Array(Math.round(a0 / 5)).fill(0), ...Array(Math.round(PREVIEW_B[i] / 5)).fill(1)];
              return (
                <g key={i}>
                  {blocks.map((c, n) => (
                    <rect key={n} x={px(i) - 9} y={h - (n + 1) * 3.4} width="18" height="2.4" fill={colors2[c]} />
                  ))}
                </g>
              );
            })
          : type === "bar"
          ? [PREVIEW_A, PREVIEW_B].map((vals, s) =>
              vals.map((v, i) => <rect key={`${s}-${i}`} x={px(i) - 8 + s * 8} y={py(v)} width="7" height={v} fill={colors2[s]} />),
            )
          : [PREVIEW_A, PREVIEW_B].map((vals, s) => (
              <g key={s}>
                {type === "area" && <path d={`${line(vals)} L${px(vals.length - 1)} ${h} L${px(0)} ${h} Z`} fill={colors2[s]} opacity={look === "bold" ? 0.28 : 0.16} />}
                <path d={line(vals)} fill="none" stroke={colors2[s]} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round" />
                {look !== "minimal" && vals.map((v, i) => <circle key={i} cx={px(i)} cy={py(v)} r={look === "bold" ? 3.2 : 2} fill={colors2[s]} />)}
              </g>
            ))}
      </svg>
    </span>
  );
}

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
 * (light/dark), the theme (Classic, Neobrutalism, Glass, Minimalism, Skeuomorphic, Studio), the header
 * layout (Standard, Compact, Floating, Centered) and the font are independent, remembered per
 * browser (ThemeContext), apply immediately, and change only how things are
 * drawn and arranged - never the pages, the controls or the data - which is why every role can
 * reach them, unlike the other Settings tabs.
 */
export function AppearanceSettings() {
  const { theme, setTheme, uiStyle, setUiStyle, headerStyle, setHeaderStyle, chartType, setChartType, chartLook, setChartLook } = useTheme();
  return (
    <div className="ae-appearance" style={{ width: "100%", maxWidth: 1400, margin: "0 auto", display: "grid", gap: 16 }}>
      <ChoiceGroup legend="Color mode" choices={MODES} value={theme} onChange={setTheme} />
      <ChoiceGroup legend="Theme" choices={THEMES} value={uiStyle} onChange={setUiStyle} />
      <ChoiceGroup legend="Header and toolbar" choices={HEADERS} value={headerStyle} onChange={setHeaderStyle} />
      <ChoiceGroup legend="Chart type" choices={CHART_TYPE_CHOICES} value={chartType} onChange={setChartType} />
      <ChoiceGroup legend="Chart look" choices={CHART_LOOK_CHOICES} value={chartLook} onChange={setChartLook} />
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
  // so a screen reader says "Classic" or "Minimalism", not the whole paragraph
  // (which can mention the other option).
  const groupId = useId();
  return (
    <fieldset style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
      <legend style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, padding: 0, color: colors.ink }}>{legend}</legend>
      {/* auto-fill, not auto-fit: a group of two keeps card-sized cards instead of stretching across the
          page, and wide screens fit five or six to a row so the tab needs little scrolling. */}
      <div className="ae-choice-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(200px, 100%), 1fr))", gap: 12 }}>
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
              <span id={`${groupId}-${c.value}-title`} className="ae-choice-title" style={{ display: "block", fontWeight: 600, marginTop: 6 }}>
                {c.label}
              </span>
              <span id={`${groupId}-${c.value}-desc`} className="ae-choice-desc" style={{ display: "block", fontSize: 12, lineHeight: 1.4, color: colors.subtleInk, marginTop: 2 }}>
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

function ClassicPreview() {
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

function StudioPreview() {
  const gold = "#b8860b";
  return (
    <span style={{ display: "block", background: "#fbfaf7", height: 86, borderRadius: 4, overflow: "hidden", border: "1px solid #dcd8cc" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, height: 24, padding: "0 8px", background: "#f1efe8", borderBottom: "1px solid #dcd8cc" }}>
        <span style={bar(48, 6, "#1a1a1a", { borderRadius: 1 })} />
        <span style={bar(30, 12, gold, { borderRadius: 3, marginLeft: "auto" })} />
      </span>
      <span style={{ display: "flex", alignItems: "flex-end", gap: 3, padding: "6px 8px 0", background: "#f1efe8", borderBottom: `1px solid ${gold}` }}>
        <span style={{ display: "block", width: 30, height: 12, background: "#fbfaf7", border: `1px solid ${gold}`, borderBottom: 0, borderRadius: "4px 4px 0 0", marginBottom: -1 }} />
        <span style={{ display: "block", width: 30, height: 10, borderRadius: "4px 4px 0 0", ...{ background: "#e4e0d4" } }} />
        <span style={{ display: "block", width: 30, height: 10, borderRadius: "4px 4px 0 0", ...{ background: "#e4e0d4" } }} />
      </span>
      <span style={{ display: "block", padding: "7px 8px" }}>
        <span style={{ display: "block", ...bar("100%", 5, "#ebe8de", { borderRadius: 1 }) }} />
        <span style={{ display: "block", ...bar("70%", 5, "#ebe8de", { borderRadius: 1, marginTop: 5 }) }} />
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


/// A tiny drawing of one header layout: the page tabs, the title card and the toolbar row, in neutral
/// colours so it shows the ARRANGEMENT whatever theme is on.
function HeaderPreview({ kind }: { kind: HeaderStyle }) {
  const ink = "#2b2b2b";
  const soft = "#cfcfca";
  const gold = "#d4a000";
  const page = "#f7f6f1";
  const card = "#ffffff";
  const line = "#d9d8d0";
  const dot = (size: number): CSSProperties => ({ width: size, height: size, borderRadius: "50%", background: gold, flex: "none" });
  const tabs = (extra: CSSProperties = {}) => (
    <span style={{ display: "flex", gap: 5, alignItems: "center", ...extra }}>
      <span style={bar(22, 3, ink)} />
      <span style={bar(22, 3, soft)} />
      <span style={bar(22, 3, soft)} />
      <span style={bar(22, 3, soft)} />
    </span>
  );
  const toolbar = (justify: CSSProperties["justifyContent"] = "flex-start") => (
    <span style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: justify }}>
      <span style={bar(16, 5, soft)} />
      <span style={bar(16, 5, soft)} />
      <span style={bar(26, 5, soft)} />
      <span style={bar(18, 7, gold, { borderRadius: 3 })} />
    </span>
  );
  const frame: CSSProperties = { display: "block", background: page, height: 86, borderRadius: 4, overflow: "hidden", border: `1px solid ${line}` };

  const lines = (
    <>
      <span style={{ display: "block", ...bar("100%", 5, "#e8e7e0", { marginTop: 5 }) }} />
      <span style={{ display: "block", ...bar("80%", 5, "#e8e7e0", { marginTop: 4 }) }} />
    </>
  );
  const titleRow = (
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={dot(11)} />
      <span style={bar(52, 6, ink)} />
    </span>
  );
  if (kind === "inline") {
    return (
      <span style={{ ...frame, padding: "6px 6px" }}>
        {tabs({ marginBottom: 5 })}
        <span style={{ display: "flex", alignItems: "center", gap: 5, borderBottom: `1px solid ${line}`, padding: "2px 0 5px" }}>
          <span style={dot(9)} />
          <span style={bar(30, 6, ink)} />
          <span style={{ display: "flex", flex: 1, justifyContent: "center" }}>{toolbar()}</span>
          <span style={bar(14, 6, soft, { borderRadius: 3 })} />
        </span>
        {lines}
      </span>
    );
  }
  if (kind === "ribbon") {
    return (
      <span style={{ ...frame, padding: "6px 6px" }}>
        {tabs({ marginBottom: 5 })}
        <span style={{ display: "block", background: card, border: `1px solid ${line}`, borderRadius: 3, padding: "4px 5px 0", overflow: "hidden" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={dot(9)} />
            <span style={bar(40, 5, ink)} />
            <span style={{ ...bar(14, 6, soft, { borderRadius: 3 }), marginLeft: "auto" }} />
          </span>
          <span style={{ display: "block", margin: "4px -5px 0", padding: "3px 5px", background: "#efeee8", borderTop: `1px solid ${line}`, borderBottom: `1px solid ${line}` }}>{toolbar()}</span>
        </span>
        {lines}
      </span>
    );
  }
  if (kind === "dock") {
    return (
      <span style={{ ...frame, padding: "6px 6px" }}>
        <span style={{ display: "block", background: card, border: `1px solid ${line}`, borderRadius: 3, padding: "4px 5px 5px" }}>
          {titleRow}
          <span style={{ display: "block", marginTop: 4 }}>{toolbar()}</span>
        </span>
        {tabs({ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${line}` })}
        {lines}
      </span>
    );
  }
  return (
    <span style={{ ...frame, padding: "6px 6px" }}>
      {tabs({ marginBottom: 5 })}
      <span style={{ display: "flex", alignItems: "flex-start", gap: 6, background: card, border: `1px solid ${line}`, borderRadius: 4, padding: "5px 6px" }}>
        <span style={dot(15)} />
        <span style={{ display: "block", flex: 1 }}>
          <span style={{ display: "block", ...bar(60, 6, ink) }} />
          <span style={{ display: "block", marginTop: 5 }}>{toolbar()}</span>
        </span>
      </span>
      <span style={{ display: "block", ...bar("100%", 5, "#e8e7e0", { marginTop: 6 }) }} />
      <span style={{ display: "block", ...bar("80%", 5, "#e8e7e0", { marginTop: 4 }) }} />
    </span>
  );
}
