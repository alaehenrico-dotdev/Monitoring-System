/// Makes whatever the model sent back fit the places it is shown: plain text, as short sentences or a
/// list with "- " bullets.
///
/// The prompts ask for exactly that, but a model (the smaller free fallback ones most of all) sometimes
/// answers with the JSON it was given, a fenced code block, or markdown the screen does not render
/// (**bold**, # headings, `code`). This is the safety net behind the prompts, so the person never sees
/// braces and field names. It only rewrites an answer that IS JSON or carries markdown marks; prose is
/// left exactly as written.

const MAX_CHARS = 2_500;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/// totalOut -> "total out", absVariance -> "abs variance", days_left -> "days left".
export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
}

/// A value for a sentence: numbers as they are, null as "none", nested data flattened.
function scalar(v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(scalar).join(", ");
  if (isRecord(v)) return Object.entries(v).map(([k, x]) => `${humanizeKey(k)} ${scalar(x)}`).join(", ");
  return String(v);
}

/// Names a row for the start of its bullet: its name (and SKU) when it has one.
function rowTitle(row: Record<string, unknown>): string | null {
  const name = typeof row.name === "string" ? row.name : typeof row.title === "string" ? row.title : null;
  if (!name) return null;
  return typeof row.sku === "string" && row.sku ? `${name} (${row.sku})` : name;
}

function describeRow(row: Record<string, unknown>): string {
  const title = rowTitle(row);
  const rest = Object.entries(row).filter(([k]) => !(title && ["name", "title", "sku"].includes(k)));
  const body = rest.map(([k, v]) => `${humanizeKey(k)} ${scalar(v)}`).join(", ");
  return title ? (body ? `${title}: ${body}` : title) : body;
}

/// JSON data as plain lines: an object is one "label: value" line per field, a list of rows is one bullet each.
export function describeJson(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((v) => `- ${isRecord(v) ? describeRow(v) : scalar(v)}`).join("\n");
  }
  if (isRecord(value)) {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      if (Array.isArray(v) && v.some(isRecord)) {
        lines.push(`${humanizeKey(k)}:`);
        lines.push(describeJson(v));
      } else if (isRecord(v)) {
        lines.push(`${humanizeKey(k)}: ${scalar(v)}`);
      } else {
        lines.push(`${humanizeKey(k)}: ${scalar(v)}`);
      }
    }
    return lines.join("\n");
  }
  return scalar(value);
}

/// The text inside a ``` fence, when the whole answer is one fenced block (optionally labelled json).
function unfence(text: string): string {
  const m = /^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i.exec(text.trim());
  return m ? m[1].trim() : text;
}

function stripMarkdown(text: string): string {
  return (
    text
      // Bullets of any kind become "- ".
      .replace(/^[ \t]*[*•+][ \t]+/gm, "- ")
      .replace(/^[ \t]*-[ \t]{2,}/gm, "- ")
      // Headings lose their hashes; a rule line goes.
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "")
      // Emphasis and code marks.
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, "$1")
      .replace(/`+([^`\n]*)`+/g, "$1")
      // [text](url) -> text
      .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function toPlainText(raw: string): string {
  let text = raw.trim();
  if (text === "") return text;

  const inner = unfence(text);
  if (/^[{[]/.test(inner)) {
    try {
      const parsed: unknown = JSON.parse(inner);
      if (typeof parsed === "object" && parsed !== null) text = describeJson(parsed);
      else text = inner;
    } catch {
      // Not valid JSON after all (cut off, say): fall through and just clean it up.
      text = inner;
    }
  } else {
    text = inner;
  }

  text = stripMarkdown(text);
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS).trimEnd()}…` : text;
}
