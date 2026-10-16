/// Product names are stored in UPPERCASE with single spaces (the way the encoders'
/// own sheets write them), whatever was typed or imported - so "Sweet  a" and
/// "SWEET A" are the same name everywhere and no screen has to guess the case.
export function normalizeProductName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}
