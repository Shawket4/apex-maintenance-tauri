/** Pure helpers for choosing a tire to fit: which used tire / stock line
 * comes first, and what the search box matches. */

export interface Pickable {
  brand: string;
  model: string | null;
  size: string | null;
  dot_code?: string | null;
}

/** "315/80 R22.5" and "315/80r22.5" are the same size. */
export function normalizeSize(size: string | null | undefined): string {
  return (size ?? "").toLowerCase().replace(/[\s_-]/g, "");
}

export function sameSize(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeSize(a);
  return na !== "" && na === normalizeSize(b);
}

/** The size most of the given tires share (the truck's other wheels), or
 * null when none of them has a size. */
export function commonSize(sizes: Array<string | null | undefined>): string | null {
  const counts = new Map<string, { n: number; shown: string }>();
  for (const s of sizes) {
    const key = normalizeSize(s);
    if (!key || !s) continue;
    const hit = counts.get(key);
    if (hit) hit.n += 1;
    else counts.set(key, { n: 1, shown: s.trim() });
  }
  let best: { n: number; shown: string } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.shown ?? null;
}

/** Case-insensitive match on brand, model, size and DOT; every typed word
 * must appear somewhere. An empty search matches everything. */
export function matchesSearch(item: Pickable, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [item.brand, item.model, item.size, item.dot_code].filter(Boolean).join(" ").toLowerCase();
  const haySquashed = hay.replace(/[\s_-]/g, "");
  return words.every((w) => hay.includes(w) || haySquashed.includes(w.replace(/[\s_-]/g, "")));
}

/** Order for the used-tire picker: tires just taken off this truck first
 * (a rotation), then the ones matching the wanted size, then the rest —
 * each group by brand, then least-worn first. Does not mutate the input. */
export function sortUsedTires<T extends Pickable & { id: string; total_km: number }>(
  tires: T[],
  opts: { preferredSize?: string | null; recentIds?: readonly string[] } = {},
): T[] {
  const recent = new Set(opts.recentIds ?? []);
  const rank = (t: T) => (recent.has(t.id) ? 0 : sameSize(t.size, opts.preferredSize) ? 1 : 2);
  return [...tires].sort(
    (a, b) => rank(a) - rank(b) || a.brand.localeCompare(b.brand) || a.total_km - b.total_km || a.id.localeCompare(b.id),
  );
}

/** Stock lines: the wanted size first, then lines that still have tires. */
export function sortStockLines<T extends Pickable & { projected_qty: number }>(
  lines: T[],
  preferredSize?: string | null,
): T[] {
  const rank = (l: T) => (sameSize(l.size, preferredSize) ? 0 : 1) * 2 + (l.projected_qty > 0 ? 0 : 1);
  return [...lines].sort((a, b) => rank(a) - rank(b) || a.brand.localeCompare(b.brand));
}

/** Km a tire has run on this truck since it was fitted, or null when it
 * cannot be known (no reading, a spare, or readings that contradict — a
 * negative run is "unknown", never shown as zero). */
export function kmOnTruck(
  p: { is_spare: boolean; mounted_odometer: number | null },
  currentKm: number | null | undefined,
): number | null {
  if (p.is_spare || p.mounted_odometer == null || currentKm == null) return null;
  const run = currentKm - p.mounted_odometer;
  return run >= 0 ? run : null;
}
