import type { StockMovementRow } from "@/shared/api/client";
import { CAIRO_TZ, dayjs } from "@/shared/lib/time";

/** The time-range chips on the movements screen. */
export const MOVEMENT_RANGES = ["7", "30", "90", "all"] as const;
export type MovementRange = (typeof MOVEMENT_RANGES)[number];

/** How many days back "all" asks the server for (its own upper limit). */
export const ALL_RANGE_DAYS = 3650;

/**
 * A time range (days as a string, or "all") → the number of days to mirror
 * from the server. Junk from the URL falls back to the default month.
 */
export function rangeToDays(range: string): number {
  if (range === "all") return ALL_RANGE_DAYS;
  const days = Number(range);
  return Number.isInteger(days) && days > 0 ? Math.min(days, ALL_RANGE_DAYS) : 30;
}

/**
 * A time range (days as a string, or "all") → the inclusive lower bound for
 * the local query, or `undefined` for no lower bound.
 *
 * The bound is the START OF THAT DAY IN CAIRO, written as the UTC instant
 * `YYYY-MM-DDTHH:mm:ss`. The mirror stores `created_at` as the server's UTC
 * string (`2026-08-02T21:00:00.000000Z`) and compares it as TEXT, so the
 * bound has to be the same shape: a bare date ("2026-08-03") would cut the
 * day at midnight UTC and drop what happened between midnight and 2–3 a.m.
 * Cairo time. Without a suffix the bound sorts at or before every timestamp
 * of that same second, so the comparison stays inclusive.
 *
 * `now` is injectable so the mapping is testable without freezing the clock.
 * Any non-positive / non-numeric value (other than "all") also means no
 * bound — a defensive default, since `range` can arrive from the URL.
 */
export function rangeToFrom(range: string, now = dayjs()): string | undefined {
  if (range === "all") return undefined;
  const days = Number(range);
  if (!Number.isFinite(days) || days <= 0) return undefined;
  return now.tz(CAIRO_TZ).subtract(days, "day").startOf("day").utc().format("YYYY-MM-DDTHH:mm:ss");
}

export type MovementInfo = {
  /** What moved. */
  item: "tire" | "oil";
  /** Into the stock or out of it. */
  direction: "in" | "out";
  /** A stock-count correction rather than a receipt or a use. */
  adjustment: boolean;
  /** How much: tires, or liters. Never negative. */
  amount: number;
};

type MovementFacts = Pick<StockMovementRow, "kind" | "qty" | "liters" | "oil_type">;

/**
 * What a ledger row means. `kind` is tire_debit | tire_credit | oil_debit |
 * oil_credit | adjustment:
 *   `*_credit` = stock IN (received), `*_debit` = stock OUT (used);
 *   an `adjustment` carries its own sign — it is oil when it has liters or an
 *   oil type, otherwise tires, and a negative amount takes stock OUT.
 */
export function describeMovement(m: MovementFacts): MovementInfo {
  if (m.kind === "adjustment") {
    const isOil = m.liters != null || (m.qty == null && m.oil_type != null);
    const raw = (isOil ? m.liters : m.qty) ?? 0;
    return { item: isOil ? "oil" : "tire", direction: raw < 0 ? "out" : "in", adjustment: true, amount: Math.abs(raw) };
  }
  const isOil = m.kind.startsWith("oil");
  const raw = (isOil ? m.liters : m.qty) ?? 0;
  return {
    item: isOil ? "oil" : "tire",
    direction: m.kind.endsWith("_credit") ? "in" : "out",
    adjustment: false,
    amount: Math.abs(raw),
  };
}

/**
 * The human item label for a movement row: the oil type for oil movements,
 * otherwise brand/model/size joined (blank parts dropped). Falls back to the
 * em-dash empty-cell convention when nothing is set.
 */
export function movementItemLabel(
  m: MovementFacts & Pick<StockMovementRow, "brand" | "model" | "size">,
): string {
  if (describeMovement(m).item === "oil") return m.oil_type ?? "—";
  return [m.brand, m.model, m.size].filter(Boolean).join(" ") || "—";
}

export type MovementTotals = {
  tiresIn: number;
  tiresOut: number;
  oilIn: number;
  oilOut: number;
  /** Net effect of stock counts (corrections): + added, − taken off. Kept
   * out of in/out, which mean "received" and "used". */
  tiresCounted: number;
  oilCounted: number;
};

/** Received / used totals over a set of rows (tires counted, oil in liters).
 * A stock count is neither a delivery nor a use, so it is summed apart. */
export function movementTotals(
  rows: readonly (MovementFacts & Partial<Pick<StockMovementRow, "is_count">>)[],
): MovementTotals {
  const totals: MovementTotals = { tiresIn: 0, tiresOut: 0, oilIn: 0, oilOut: 0, tiresCounted: 0, oilCounted: 0 };
  for (const row of rows) {
    const info = describeMovement(row);
    if (row.is_count || info.adjustment) {
      const signed = info.direction === "in" ? info.amount : -info.amount;
      if (info.item === "tire") totals.tiresCounted += signed;
      else totals.oilCounted += signed;
    } else if (info.item === "tire") {
      if (info.direction === "in") totals.tiresIn += info.amount;
      else totals.tiresOut += info.amount;
    } else if (info.direction === "in") totals.oilIn += info.amount;
    else totals.oilOut += info.amount;
  }
  // Liters are stored to two decimals; do not let float noise leak out.
  totals.oilIn = Math.round(totals.oilIn * 100) / 100;
  totals.oilOut = Math.round(totals.oilOut * 100) / 100;
  totals.oilCounted = Math.round(totals.oilCounted * 100) / 100;
  return totals;
}
