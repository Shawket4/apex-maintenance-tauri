/**
 * Pure helpers for the wheel map: no React, no three.js. They turn the
 * chassis rows (axles + positions) into (a) words a person can read and
 * (b) the rows/columns of the top-down 2D map.
 *
 * Keep this file free of imports from `dims.ts` / `TruckDiagram.tsx`: those
 * pull in three.js, and the 2D map must load without it.
 */
import type { AxleRow, ChassisConfig, PositionRow } from "@/shared/api/client";

export type MapAxle = Pick<AxleRow, "id" | "section" | "section_index" | "axle_type" | "is_steering" | "is_lifted">;
export type MapPosition = Pick<
  PositionRow,
  "id" | "axle_id" | "side" | "depth" | "is_spare" | "spare_index" | "position_code" | "tire_id" | "pending"
>;

export type Side = "left" | "right";
export type Depth = "single" | "outer" | "inner";

/** What a position IS, in terms a person uses (not its code). */
export type PositionParts =
  | { kind: "spare"; index: number }
  | { kind: "steer"; side: Side }
  | {
      kind: "axle";
      section: "tractor" | "trailer";
      /** The axle's number inside its section, as painted in the code (H2 → 2, TR1 → 1). */
      axle: number;
      side: Side;
      depth: Depth;
      /** False for a tractor with no trailer: "tractor" then adds nothing. */
      hasTrailer: boolean;
    }
  | { kind: "unknown" };

const asSide = (s: string | null): Side => (s === "right" ? "right" : "left");
const asDepth = (d: string | null): Depth => (d === "outer" || d === "inner" ? d : "single");

export function positionParts(p: MapPosition, axles: MapAxle[]): PositionParts {
  if (p.is_spare) return { kind: "spare", index: p.spare_index ?? 1 };
  const axle = axles.find((a) => a.id === p.axle_id);
  if (!axle) return { kind: "unknown" };
  if (axle.is_steering) return { kind: "steer", side: asSide(p.side) };
  return {
    kind: "axle",
    section: axle.section === "trailer" ? "trailer" : "tractor",
    axle: axle.section_index,
    side: asSide(p.side),
    depth: asDepth(p.depth),
    hasTrailer: axles.some((a) => a.section === "trailer"),
  };
}

export type Translate = (key: string, options?: Record<string, unknown>) => string;
export type FormatNumber = (n: number) => string;

/** "محور ٢ شمال برّه" / "Axle 2, left outer". The code (H2LO) stays a
 * secondary detail for whoever knows it; this is what the screen says. */
export function positionLabel(p: MapPosition, axles: MapAxle[], t: Translate, fmt: FormatNumber): string {
  const parts = positionParts(p, axles);
  switch (parts.kind) {
    case "spare":
      return t("diagram.pos.spare", { n: fmt(parts.index) });
    case "steer":
      return t("diagram.pos.steer", { side: t(`diagram.pos.side.${parts.side}`) });
    case "axle": {
      const where = parts.section === "trailer" ? "trailer" : parts.hasTrailer ? "tractor" : "plain";
      const shape = parts.depth === "single" ? "Single" : "Dual";
      return t(`diagram.pos.${where}${shape}`, {
        n: fmt(parts.axle),
        side: t(`diagram.pos.side.${parts.side}`),
        depth: parts.depth === "single" ? "" : t(`diagram.pos.depth.${parts.depth}`),
      });
    }
    default:
      return p.position_code;
  }
}

/** The one or two words printed ON a wheel: the row and column headings
 * already say which axle and which side. */
export function wheelShortLabel(p: MapPosition, axles: MapAxle[], t: Translate, fmt: FormatNumber): string {
  const parts = positionParts(p, axles);
  if (parts.kind === "spare") return t("diagram.pos.spare", { n: fmt(parts.index) });
  if (parts.kind === "steer") return t(`diagram.pos.side.${parts.side}`);
  if (parts.kind === "axle") {
    return parts.depth === "single" ? t(`diagram.pos.side.${parts.side}`) : t(`diagram.pos.depth.${parts.depth}`);
  }
  return p.position_code;
}

export function tireName(p: { brand: string | null; model: string | null; size: string | null }): string {
  return [p.brand, p.model, p.size].filter(Boolean).join(" ");
}

export type WheelState = "empty" | "mounted" | "spare" | "pending";

/** Empty → nothing on the wheel. A tire whose mount has not reached the
 * office yet is "pending"; a tire in a spare slot is "spare". */
export function wheelState(p: Pick<MapPosition, "tire_id" | "pending" | "is_spare">): WheelState {
  if (!p.tire_id) return "empty";
  if (p.pending) return "pending";
  return p.is_spare ? "spare" : "mounted";
}

export interface MapAxleRow<P> {
  axle: MapAxle;
  /** Screen order, left to right: outer → inner. */
  left: P[];
  /** Screen order, left to right: inner → outer. */
  right: P[];
}

export interface MapLayout<P> {
  tractor: MapAxleRow<P>[];
  trailer: MapAxleRow<P>[];
  /** Spares, then any position whose axle row is missing (never hidden). */
  spares: P[];
  /** Most wheels on one side of any axle (1 = all single, 2 = some dual). */
  maxPerSide: number;
}

const LEFT_ORDER: Record<Depth, number> = { outer: 0, single: 1, inner: 2 };
const RIGHT_ORDER: Record<Depth, number> = { inner: 0, single: 1, outer: 2 };

/** Axles front to back (tractor, then trailer), each with its wheels in the
 * order they sit across the truck seen from above with the cab at the top. */
export function buildMapLayout<P extends MapPosition>(axles: MapAxle[], positions: P[]): MapLayout<P> {
  const sorted = [...axles].sort((a, b) => {
    const sa = a.section === "trailer" ? 1 : 0;
    const sb = b.section === "trailer" ? 1 : 0;
    return sa - sb || a.section_index - b.section_index;
  });
  const known = new Set(axles.map((a) => a.id));
  const rows = sorted.map<MapAxleRow<P>>((axle) => {
    const mine = positions.filter((p) => !p.is_spare && p.axle_id === axle.id);
    return {
      axle,
      left: mine
        .filter((p) => asSide(p.side) === "left")
        .sort((a, b) => LEFT_ORDER[asDepth(a.depth)] - LEFT_ORDER[asDepth(b.depth)]),
      right: mine
        .filter((p) => asSide(p.side) === "right")
        .sort((a, b) => RIGHT_ORDER[asDepth(a.depth)] - RIGHT_ORDER[asDepth(b.depth)]),
    };
  });
  const spares = positions.filter((p) => p.is_spare).sort((a, b) => (a.spare_index ?? 0) - (b.spare_index ?? 0));
  const orphans = positions.filter((p) => !p.is_spare && !(p.axle_id && known.has(p.axle_id)));
  return {
    tractor: rows.filter((r) => r.axle.section !== "trailer"),
    trailer: rows.filter((r) => r.axle.section === "trailer"),
    spares: [...spares, ...orphans],
    maxPerSide: Math.max(1, ...rows.map((r) => Math.max(r.left.length, r.right.length))),
  };
}

/** How many wheels a layout choice makes. Mirrors the Rust planner
 * (src-tauri services/chassis_plan.rs): steering axle 2, each drive axle 4,
 * each trailer axle 4 (dual) or 2 (single). */
export function wheelCount(cfg: ChassisConfig): { road: number; spares: number } {
  const perTrailerAxle = cfg.single_trailer_axles ? 2 : 4;
  return { road: 2 + cfg.drive_axles * 4 + cfg.trailer_axles * perTrailerAxle, spares: cfg.spares };
}

const DUAL: Array<[Side, Depth, string]> = [
  ["left", "outer", "LO"],
  ["left", "inner", "LI"],
  ["right", "inner", "RI"],
  ["right", "outer", "RO"],
];
const SINGLE: Array<[Side, Depth, string]> = [
  ["left", "single", "L"],
  ["right", "single", "R"],
];

/** The layout a choice WOULD create, for the live preview — same axles and
 * codes as the Rust planner, with every wheel empty. Ids are made up. */
export function syntheticChassis(cfg: ChassisConfig): { axles: AxleRow[]; positions: PositionRow[] } {
  const axles: AxleRow[] = [];
  const positions: PositionRow[] = [];
  const wheel = (axleId: string | null, side: Side | null, depth: Depth | null, code: string, spare: number | null) =>
    positions.push({
      id: `preview-${code}`,
      axle_id: axleId,
      side,
      depth,
      is_spare: spare != null,
      spare_index: spare,
      position_code: code,
      assignment_id: null,
      tire_id: null,
      dot_code: null,
      brand: null,
      model: null,
      size: null,
      origin: null,
      retread_count: null,
      mount_reason: null,
      tire_status: null,
      mounted_at: null,
      mounted_odometer: null,
      total_km: null,
      pending: false,
    });
  const axle = (section: "tractor" | "trailer", index: number, dual: boolean, steering: boolean) => {
    const prefix = section === "tractor" ? "H" : "TR";
    const id = `preview-${prefix}${index}`;
    axles.push({
      id,
      section,
      section_index: index,
      axle_type: dual ? "dual" : "single",
      is_steering: steering,
      is_lifted: false,
    });
    for (const [side, depth, suffix] of dual ? DUAL : SINGLE) wheel(id, side, depth, `${prefix}${index}${suffix}`, null);
  };

  axle("tractor", 1, false, true);
  for (let i = 0; i < cfg.drive_axles; i++) axle("tractor", i + 2, true, false);
  for (let i = 0; i < cfg.trailer_axles; i++) axle("trailer", i + 1, !cfg.single_trailer_axles, false);
  for (let s = 1; s <= cfg.spares; s++) wheel(null, null, null, `SP${s}`, s);
  return { axles, positions };
}
