/**
 * Generates a chassis (axles + positions) for the 3D truck diagram, mirroring
 * the geometry rules from the `truck-preview` spike and the server-side
 * chassis_builder position-code convention:
 *   H<n>L/R              tractor steering (single wheels)
 *   H<n>LO/LI/RO/RI      tractor drive axle (dual)
 *   TR<n>LO/LI/RO/RI     trailer axle (dual)
 *   SP<n>                spare
 * `is_steering`/`is_lifted`/`is_spare` are 0/1 to match the ChassisAxle/Position
 * shape the widget consumes.
 */
import type { ChassisAxle, ChassisPosition } from "@/shared/api/tires";

export interface RigConfig {
  driveAxles: number; // tractor non-steering axles (dual)
  trailerAxles: number; // trailer axles (dual)
  spares: number;
}

export const DEFAULT_RIG: RigConfig = { driveAxles: 2, trailerAxles: 3, spares: 2 };

const LAYOUT = "gen-layout";

export function generateChassis(cfg: RigConfig): {
  axles: ChassisAxle[];
  positions: ChassisPosition[];
} {
  const axles: ChassisAxle[] = [];
  const positions: ChassisPosition[] = [];

  const axle = (
    id: string,
    section: "tractor" | "trailer",
    section_index: number,
    axle_type: "single" | "dual",
    is_steering: number,
  ): ChassisAxle => ({
    id,
    layout_id: LAYOUT,
    section,
    section_index,
    axle_type,
    is_steering,
    is_lifted: 0,
  });

  // Empty positions: every mount-join field null (renders as a hollow ring).
  const emptyMount = {
    assignment_id: null,
    mounted_at: null,
    mounted_odometer: null,
    tire_id: null,
    dot_code: null,
    brand: null,
    tire_status: null,
    is_retread: null,
  } as const;

  const pos = (
    code: string,
    axle_id: string,
    side: "left" | "right",
    depth: "single" | "inner" | "outer",
  ): ChassisPosition => ({
    id: code,
    layout_id: LAYOUT,
    axle_id,
    side,
    depth,
    is_spare: 0,
    spare_index: null,
    position_code: code,
    ...emptyMount,
  });

  // Tractor steering axle (single wheels)
  const steer = axle("ax-h1", "tractor", 1, "single", 1);
  axles.push(steer);
  positions.push(pos("H1L", steer.id, "left", "single"), pos("H1R", steer.id, "right", "single"));

  // Tractor drive axles (dual)
  for (let i = 0; i < cfg.driveAxles; i++) {
    const n = i + 2;
    const a = axle(`ax-h${n}`, "tractor", n, "dual", 0);
    axles.push(a);
    positions.push(
      pos(`H${n}LO`, a.id, "left", "outer"),
      pos(`H${n}LI`, a.id, "left", "inner"),
      pos(`H${n}RI`, a.id, "right", "inner"),
      pos(`H${n}RO`, a.id, "right", "outer"),
    );
  }

  // Trailer axles (dual)
  for (let i = 0; i < cfg.trailerAxles; i++) {
    const n = i + 1;
    const a = axle(`ax-tr${n}`, "trailer", n, "dual", 0);
    axles.push(a);
    positions.push(
      pos(`TR${n}LO`, a.id, "left", "outer"),
      pos(`TR${n}LI`, a.id, "left", "inner"),
      pos(`TR${n}RI`, a.id, "right", "inner"),
      pos(`TR${n}RO`, a.id, "right", "outer"),
    );
  }

  // Spares
  for (let i = 0; i < cfg.spares; i++) {
    const n = i + 1;
    positions.push({
      id: `SP${n}`,
      layout_id: LAYOUT,
      axle_id: null,
      side: null,
      depth: null,
      is_spare: 1,
      spare_index: n,
      position_code: `SP${n}`,
      ...emptyMount,
    });
  }

  return { axles, positions };
}
