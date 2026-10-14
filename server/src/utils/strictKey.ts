/// The STRICT comparison for product and category names (mirror of the client's
/// importMatch.strictNameKey): only differences invisible to a person are
/// ignored - letter case, leading/trailing spaces, repeated or non-breaking
/// spaces - so "Sweet A" and "SWEET  A " are the same but "Sweet-A" is not.
export function strictKey(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}
