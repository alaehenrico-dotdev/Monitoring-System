/// A transfer is one movement recorded on two sheets: what Online sends out
/// (Ol→Off) is what Offline takes in, and the other way round. Saving either
/// sheet writes BOTH of its transfer figures onto the other one (the server's
/// mirror is unconditional and replaces the other side), so a figure the other
/// encoder already entered is silently overwritten when the two disagree.
///
/// This is the check behind the Save review's "this will replace ..." notice.
/// Pure, so each rule is tested. It warns and never blocks: the save still
/// goes through, exactly as before.

export interface TransferPair {
  /// This sheet's column.
  mine: string;
  /// The column on the other sheet that mirrors it.
  theirs: string;
  /// This sheet's column label, as the encoder knows it.
  label: string;
}

export const ONLINE_TRANSFER_PAIRS: TransferPair[] = [
  { mine: "stockOutOlToOff", theirs: "stockInOlToOff", label: "Stocks Out (Ol→Off)" },
  { mine: "stockInOffToOl", theirs: "stockOutOffToOl", label: "Stocks In (Off→Ol)" },
];

export const OFFLINE_TRANSFER_PAIRS: TransferPair[] = [
  { mine: "stockInOlToOff", theirs: "stockOutOlToOff", label: "Stocks In (Ol→Off)" },
  { mine: "stockOutOffToOl", theirs: "stockInOffToOl", label: "Stocks Out (Off→Ol)" },
];

export interface TransferOverwrite {
  productId: number;
  name: string;
  label: string;
  /// What this save will leave on this sheet (and write to the other).
  mine: number;
  /// What the other sheet holds now.
  theirs: number;
}

interface RowLike {
  product: { id: number; name: string };
  entry: Record<string, unknown>;
  isSaved?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? round2(n) : 0;
};

/// Products in this save whose transfer figures differ from what the other
/// sheet already holds. `displayRows` carry the staged edits (so `mine` is what
/// would be saved); `counterpart` is the other sheet's saved rows.
///
/// Only a product with a staged transfer cell is checked - that is the save that
/// triggers the mirror - but BOTH pairs of that product are compared, because the
/// mirror writes both. The other sheet's figure counts only when it was actually
/// entered (a saved row, not zero): filling an empty counterpart is not an
/// overwrite. With no counterpart rows (not loaded, or the call failed) there is
/// nothing to compare and the result is empty.
export function transferOverwrites(
  displayRows: RowLike[] | null | undefined,
  pending: Record<number, Record<string, unknown>>,
  counterpart: RowLike[] | null | undefined,
  pairs: TransferPair[],
): TransferOverwrite[] {
  if (!counterpart?.length) return [];
  const other = new Map(counterpart.map((r) => [r.product.id, r]));
  const out: TransferOverwrite[] = [];
  for (const row of displayRows ?? []) {
    const staged = pending[row.product.id];
    if (!staged || !pairs.some((p) => p.mine in staged)) continue;
    const theirRow = other.get(row.product.id);
    if (!theirRow?.isSaved) continue;
    for (const pair of pairs) {
      const mine = num(row.entry[pair.mine]);
      const theirs = num(theirRow.entry[pair.theirs]);
      if (theirs !== 0 && theirs !== mine) {
        out.push({ productId: row.product.id, name: row.product.name, label: pair.label, mine, theirs });
      }
    }
  }
  return out;
}

/// The Save review line for the overwrites above, or null when there are none.
export function describeTransferOverwrites(items: TransferOverwrite[], otherSheet: "Online" | "Offline"): string | null {
  if (items.length === 0) return null;
  const shown = items
    .slice(0, 4)
    .map((i) => `${i.name} - ${i.label} ${i.mine.toLocaleString()} (${otherSheet} has ${i.theirs.toLocaleString()})`)
    .join("; ");
  const more = items.length > 4 ? `; and ${items.length - 4} more` : "";
  return `${items.length} transfer figure${items.length === 1 ? "" : "s"} differ from what ${otherSheet} already has, and saving replaces the ${otherSheet} figure with this one: ${shown}${more}. Check with the ${otherSheet} encoder if unsure which is right.`;
}
