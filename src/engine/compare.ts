// Comparing listings and finding duplicates: plain functions over 7-Zip's listing entries.
import type { Entry } from './sevenzip';

/** Added, removed and changed paths between two listings (by size and CRC) */
export function compareListings(a: Entry[], b: Entry[]) {
  const A = new Map(a.filter(e => !e.dir).map(e => [e.path, e])), B = new Map(b.filter(e => !e.dir).map(e => [e.path, e]));
  const added = [...B.keys()].filter(k => !A.has(k)), removed = [...A.keys()].filter(k => !B.has(k));
  const changed = [...A.keys()].filter(k => B.has(k) && (A.get(k)!.size !== B.get(k)!.size || (A.get(k)!.crc && B.get(k)!.crc && A.get(k)!.crc !== B.get(k)!.crc)));
  const same = [...A.keys()].filter(k => B.has(k)).length - changed.length;
  return { added, removed, changed, same };
}

/** Files with the same size and CRC inside one archive */
export function duplicates(entries: Entry[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const e of entries) if (!e.dir && e.size > 0 && e.crc) { const k = `${e.size}:${e.crc}`; groups.set(k, [...(groups.get(k) ?? []), e.path]); }
  return [...groups.values()].filter(g => g.length > 1);
}

