/// Quick picks, in the same pastel family as the grid's in/out/delivery tones
/// (see TONE_COLOR in StockGrid) so any of them keeps the brand-ink label
/// readable; the native picker beside them covers everything else.
const COLOR_PRESETS = [
  "#9DB0FF", // blue
  "#F59A9A", // red
  "#F7A8CC", // pink
  "#F9C784", // orange
  "#F6E58D", // yellow
  "#A8E6A1", // green
  "#8FDCD3", // teal
  "#C9B6F2", // purple
  "#D4D4D4", // gray
];

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The color picker at the foot of the grid right-click menus (column headers
 * and category rows): preset swatches plus a native color input styled as one
 * more swatch. Presets apply and close the menu; the native picker applies
 * live and leaves it open.
 */
export function ColorSwatches({
  heading,
  subject,
  current,
  onChange,
  onClose,
}: {
  /// Small caption above the swatches, e.g. "Header color".
  heading: string;
  /// What is being colored, for the swatches' accessible names.
  subject: string;
  /// The current color (custom or default), if any.
  current?: string;
  onChange: (hex: string) => void;
  onClose: () => void;
}) {
  const cur = (current ?? "").toLowerCase();
  return (
    <div className="ae-col-menu-colors" role="group" aria-label={heading}>
      <div className="ae-col-menu-colors-label">{heading}</div>
      <div className="ae-col-menu-swatches">
        {COLOR_PRESETS.map((hex) => (
          <button
            key={hex}
            type="button"
            className={
              "ae-col-swatch" +
              (cur === hex.toLowerCase() ? " ae-col-swatch--on" : "")
            }
            style={{ background: hex }}
            title={hex}
            aria-label={`Set ${subject} to ${hex}`}
            aria-pressed={cur === hex.toLowerCase()}
            onClick={() => {
              onChange(hex);
              onClose();
            }}
          />
        ))}
        <label
          className="ae-col-swatch ae-col-swatch--custom"
          title="Pick any color"
        >
          <input
            type="color"
            value={HEX.test(cur) ? cur : "#9db0ff"}
            aria-label={`Custom ${subject}`}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
