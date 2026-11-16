import { SparklesIcon } from "./icons";
import { Button } from "./ui";
import { colors } from "../theme";
import type { AiFallback } from "../utils/aiFallback";

/// The quiet placeholder shown where an AI answer would have been when the AI cannot respond: the
/// spark, one calm sentence, an optional smaller line, and Try again. Deliberately not red and not an
/// alert - the page around it is fine, and nothing the person did went wrong. (The header search
/// has its own version inside its dark panel: QuickJump.tsx.)
export function AiNotice({ note, onRetry, busy }: { note: AiFallback; onRetry?: () => void; busy?: boolean }) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        margin: "8px 0",
        padding: "8px 10px",
        borderRadius: 4,
        border: `1px solid ${colors.border}`,
        background: colors.paperAlt,
        color: colors.ink,
        fontSize: "calc(12.5px * var(--ae-fs, 1))",
        lineHeight: 1.5,
      }}
    >
      <span style={{ flexShrink: 0, marginTop: 2, display: "inline-flex" }}>
        <SparklesIcon />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {note.text}
        {note.detail && <span style={{ display: "block", marginTop: 2, color: colors.subtleInk, fontSize: "calc(11.5px * var(--ae-fs, 1))" }}>{note.detail}</span>}
      </span>
      {onRetry && note.retry && (
        <Button type="button" size="sm" variant="ghost" onClick={onRetry} disabled={busy}>
          Try again
        </Button>
      )}
    </div>
  );
}
