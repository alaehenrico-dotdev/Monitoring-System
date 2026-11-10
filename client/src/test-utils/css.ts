import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** index.css with its `@import "./x.css"` lines inlined, in order (tests assert on the whole cascade). */
export function readAllCss(entry: string): string {
  // Line endings differ by checkout (CRLF on Windows); the tests assert on LF.
  const css = readFileSync(entry, "utf8").replace(/\r\n/g, "\n");
  return css.replace(/@import\s+"([^"]+)";/g, (_m, rel: string) => readAllCss(join(dirname(entry), rel)));
}
