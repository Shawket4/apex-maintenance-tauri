import type { StockMovementRow } from "@/shared/api/client";
import { dayjs } from "@/shared/lib/time";

/** The time-range chips on the movements screen. */
export const MOVEMENT_RANGES = ["7", "30", "90", "all"] as const;
export type MovementRange = (typeof MOVEMENT_RANGES)[number];

/**
 * A time range (days as a string, or "all") → an inclusive `from` date
 * (`YYYY-MM-DD`) for the server/local query, or `undefined` for no lower bound.
 * `now` is injectable so the mapping is testable without freezing the clock.
 * Any non-positive / non-numeric value (other than "all") also means no bound —
 * a defensive default, since `range` can arrive from the URL.
 */
export function rangeToFrom(range: string, now = dayjs()): string | undefined {
  if (range === "all") return undefined;
  const days = Number(range);
  if (!Number.isFinite(days) || days <= 0) return undefined;
  return now.subtract(days, "day").format("YYYY-MM-DD");
}

/**
 * Classify a stock movement from its `kind`:
 *   `*_credit` = stock IN (received), `*_debit` = stock OUT (consumed);
 *   `oil_*` = oil, else tire. The whole row's presentation keys off this.
 */
export function classifyMovement(kind: string): { isIn: boolean; isOil: boolean } {
  return { isIn: kind.endsWith("_credit"), isOil: kind.startsWith("oil") };
}

/**
 * The human item label for a movement row: the oil type for oil movements,
 * otherwise brand/model/size joined (blank parts dropped). Falls back to the
 * em-dash empty-cell convention when nothing is set.
 */
export function movementItemLabel(
  m: Pick<StockMovementRow, "kind" | "oil_type" | "brand" | "model" | "size">,
): string {
  if (classifyMovement(m.kind).isOil) return m.oil_type ?? "—";
  return [m.brand, m.model, m.size].filter(Boolean).join(" ") || "—";
}
