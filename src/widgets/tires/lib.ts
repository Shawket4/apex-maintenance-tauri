import { dayjs } from "@/shared/lib/time";

/** A tire's readable name: "Michelin X Multi · 315/80R22.5". Most old tires
 * have no DOT, so the name can never depend on it. */
export function tireName(t: { brand: string | null; model: string | null; size: string | null }): string {
  const make = [t.brand, t.model].filter(Boolean).join(" ").trim();
  return [make, t.size].filter(Boolean).join(" · ") || "—";
}

export type PositionParts =
  | { kind: "steer" | "drive" | "trailer"; axle: number; side: "left" | "right"; depth: "outer" | "inner" | null }
  | { kind: "spare"; index: number };

/** Position code → where it is on the truck. The codes come from the chassis
 * plan: H1L/H1R (steering), H{n}{LO,LI,RI,RO} (drive axles), TR{n}… (trailer
 * axles, single or dual), SP{n} (spares). */
export function parsePosition(code: string | null | undefined): PositionParts | null {
  if (!code) return null;
  const spare = /^SP(\d+)$/.exec(code);
  if (spare) return { kind: "spare", index: Number(spare[1]) };
  const m = /^(H|TR)(\d+)(L|R)(O|I)?$/.exec(code);
  if (!m) return null;
  const axle = Number(m[2]);
  return {
    kind: m[1] === "TR" ? "trailer" : axle === 1 ? "steer" : "drive",
    axle,
    side: m[3] === "L" ? "left" : "right",
    depth: m[4] === "O" ? "outer" : m[4] === "I" ? "inner" : null,
  };
}

/** Milliseconds of a stored timestamp (UTC), or null. */
export function ts(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const v = dayjs.utc(iso).valueOf();
  return Number.isNaN(v) ? null : v;
}

/** The largest odometer / km value the app accepts. */
export const MAX_ODOMETER = 9_999_999;

/** A step in a tire's life taken from the tire file (never mount/dismount:
 * those happen on the truck diagram, inside a work order). */
export type LifeAction = {
  id: "sendRepair" | "backFromRepair" | "sendRetread" | "backFromRetread" | "scrap" | "unscrap";
  to: "in_stock_used" | "in_repair" | "retreading" | "scrapped";
  event: "repair_out" | "repair_in" | "retread" | "restock" | "scrap";
};

const SCRAP: LifeAction = { id: "scrap", to: "scrapped", event: "scrap" };

/** What can be done from each status. A mounted tire has to come off first. */
export const LIFE_ACTIONS: Record<string, LifeAction[]> = {
  in_stock_used: [
    { id: "sendRepair", to: "in_repair", event: "repair_out" },
    { id: "sendRetread", to: "retreading", event: "retread" },
    SCRAP,
  ],
  in_repair: [{ id: "backFromRepair", to: "in_stock_used", event: "repair_in" }, SCRAP],
  retreading: [{ id: "backFromRetread", to: "in_stock_used", event: "restock" }, SCRAP],
  scrapped: [{ id: "unscrap", to: "in_stock_used", event: "restock" }],
  mounted: [],
};

export const DISMOUNT_REASONS = ["rotation", "puncture", "retread", "worn", "damaged", "other"] as const;
