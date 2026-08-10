import { describe, expect, it } from "vitest";

import {
  DRIVE_Z0,
  RAIL_TOP,
  SUB_TOP,
  TANK_BOTTOM,
  TANK_HW,
  TANK_H,
  TANK_LEN,
  TANK_W,
  TANK_TOP,
  CAB_FLOOR,
  fifthWheelZ,
  railBack,
  tankGeo,
} from "@/widgets/TruckDiagram/dims";

describe("fifthWheelZ", () => {
  it("falls back to the first drive-axle datum when there are no drive axles", () => {
    expect(fifthWheelZ([])).toBe(DRIVE_Z0);
  });

  it("sits 0.2 m ahead of the drive group's centroid so the kingpin loads the driven axles", () => {
    // single drive axle: centre is the axle itself
    expect(fifthWheelZ([-0.55])).toBeCloseTo(-0.75, 6);
    // two drive axles: centre is their mean
    expect(fifthWheelZ([-0.55, 0.8])).toBeCloseTo((-0.55 + 0.8) / 2 - 0.2, 6);
  });
});

describe("railBack", () => {
  it("reaches past whichever is further back: the fifth wheel or the last drive axle", () => {
    const driveZs = [-0.55, 0.8];
    const expected = Math.max(fifthWheelZ(driveZs) + 0.75, Math.max(...driveZs) + 0.95);
    expect(railBack(driveZs)).toBeCloseTo(expected, 6);
  });

  it("is defined even with no drive axles", () => {
    expect(Number.isFinite(railBack([]))).toBe(true);
  });
});

describe("vertical stack-up invariants (parts connect by construction)", () => {
  it("the subframe top is exactly the tank bottom — the tank sits ON the subframe", () => {
    expect(SUB_TOP).toBeCloseTo(TANK_BOTTOM, 6);
  });

  it("the cab floor sits at/above the rail top", () => {
    expect(CAB_FLOOR).toBeGreaterThanOrEqual(RAIL_TOP - 0.05);
  });

  it("the tank spans exactly TANK_H between bottom and top", () => {
    expect(TANK_TOP - TANK_BOTTOM).toBeCloseTo(TANK_H, 6);
  });
});

describe("tank geometry audit (the ExtrudeGeometry bevel drift is invisible by eye)", () => {
  // This is the guard the module's assertDims() writes to the console; here we
  // fail the build on it. The barrel is the datum every other trailer part
  // measures against — if the mesh three actually produces disagrees with the
  // TANK_W × TANK_H × TANK_LEN constants, subframe/fenders/stripes silently
  // mis-size against it.
  const box = tankGeo.boundingBox!;

  it("has a bounding box (computed at module load)", () => {
    expect(box).toBeTruthy();
  });

  it("matches the declared half-width (not 2*bevel oversized)", () => {
    expect(box.max.x).toBeCloseTo(TANK_HW, 2);
    expect(box.max.x).toBeCloseTo(TANK_W / 2, 2);
  });

  it("matches the declared half-height", () => {
    expect(box.max.y).toBeCloseTo(TANK_H / 2, 2);
  });

  it("matches the declared half-length", () => {
    expect(box.max.z).toBeCloseTo(TANK_LEN / 2, 2);
  });
});
