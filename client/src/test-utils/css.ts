import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** index.css with its `@import "./x.css"` lines inlined, in order (tests assert on the whole cascade). */
export function readAllCss(entry: string): string {
  const css = readFileSync(entry, "utf8");
  return css.replace(/@import\s+"([^"]+)";/g, (_m, rel: string) => readAllCss(join(dirname(entry), rel)));
}
