import type { BatterySpecInput } from "@/shared/api/client";
import { norm } from "@/shared/lib/normalize";
import { fmtCairo, todayCairoYmd } from "@/shared/lib/time";

// The Rust side's own lists and limits (src-tauri services/domain.rs,
// maint-rust handlers/stock.rs). Labels live in i18n under batteries.*.

/** Why a battery came off. */
export const BATTERY_REASONS = ["dead", "weak", "damaged", "moved", "warranty", "other"] as const;
/** Where a battery that is off a truck is: what a removal says it went to,
 * and every status that can be set by hand. */
export const BATTERY_OFF_STATUSES = ["in_stock_used", "charging", "warranty", "scrapped"] as const;
export const BATTERY_STATUSES = ["installed", ...BATTERY_OFF_STATUSES] as const;

export const MAX_BATTERY_SLOTS = 12;
export const AH_RANGE = [1, 2000] as const;
export const VOLT_RANGE = [2, 48] as const;
export const CCA_RANGE = [1, 5000] as const;
export const WARRANTY_RANGE = [0, 120] as const;
export const MAX_TEXT = 120;

/** The likely place a battery goes for each reason — only a suggestion that
 * fills the second question; the person can change it. */
export const REASON_OUTCOME: Record<string, string> = {
  dead: "scrapped",
  weak: "charging",
  damaged: "scrapped",
  moved: "in_stock_used",
  warranty: "warranty",
};

/** Status → design-token chip classes (labels in batteries.status.*). */
export const BATTERY_BADGE: Record<string, string> = {
  installed: "bg-status-ok-soft text-status-ok",
  in_stock_used: "bg-info-soft text-info",
  charging: "bg-status-due_soon-soft text-status-due_soon",
  warranty: "bg-violet-soft text-violet",
  scrapped: "bg-status-never_done-soft text-status-never_done",
};

/** A battery type: what is written on it. Brand + model + Ah + volts name
 * the stock line; CCA rides along. */
export interface BatterySpec {
  brand: string;
  model: string;
  capacity_ah: number | null;
  voltage: number | null;
  cca: number | null;
}

type SpecLike = {
  brand: string;
  model?: string | null;
  capacity_ah?: number | null;
  voltage?: number | null;
  cca?: number | null;
};

/** The stock line a spec names, keyed the way the Rust side and the server
 * key it (names compared loosely, Ah and volts as numbers). */
export function batteryKey(b: SpecLike): string {
  return `${norm(b.brand)}|${norm(b.model)}|${b.capacity_ah ?? ""}|${b.voltage ?? ""}`;
}

/** "Varta Promotive" */
export function batteryName(b: { brand: string | null; model?: string | null }): string {
  return [b.brand, b.model].map((x) => (x ?? "").trim()).filter(Boolean).join(" ") || "—";
}

/** "100Ah · 12V" (as written on the battery; Latin digits on purpose). */
export function batteryRating(b: SpecLike, withCca = false): string {
  return [
    b.capacity_ah != null ? `${b.capacity_ah}Ah` : null,
    b.voltage != null ? `${b.voltage}V` : null,
    withCca && b.cca != null ? `CCA ${b.cca}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Varta Promotive · 100Ah · 12V" — one line, for pickers and receipts. */
export function batteryLabel(b: SpecLike): string {
  return [batteryName(b), batteryRating(b)].filter((x) => x && x !== "—").join(" · ") || "—";
}

export function specOf(b: SpecLike): BatterySpec {
  return {
    brand: b.brand,
    model: b.model ?? "",
    capacity_ah: b.capacity_ah ?? null,
    voltage: b.voltage ?? null,
    cca: b.cca ?? null,
  };
}

/** What the commands take. */
export function toSpecInput(s: BatterySpec): BatterySpecInput {
  return {
    brand: s.brand.trim(),
    model: s.model.trim() || null,
    capacity_ah: s.capacity_ah,
    voltage: s.voltage,
    cca: s.cca,
  };
}

/** The warranty ran out before today (Cairo calendar). */
export function warrantyPast(until: string | null | undefined): boolean {
  return !!until && until < todayCairoYmd();
}

export const inRange = (n: number | null, [lo, hi]: readonly [number, number]) => n == null || (n >= lo && n <= hi);

/** A YYYY-MM-DD date in the language's digits ("٢٠٢٧/٠٥/٠١"). Noon UTC is
 * the same calendar day in Cairo. */
export function fmtYmd(ymd: string, lang: string): string {
  return fmtCairo(`${ymd}T12:00:00Z`, "YYYY/MM/DD", lang);
}
