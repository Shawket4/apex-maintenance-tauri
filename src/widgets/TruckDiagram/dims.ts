import * as THREE from "three";

/**
 * Single source of truth for the rig's dimensions, in metres, matched to the
 * Apex reference photos. Everything in Truck.tsx derives from these — parts
 * connect by construction rather than by hand-placed numbers that drift.
 *
 * Vertical stack-up (ground = 0):
 *   0.00  ground
 *   0.55  wheel centre        (= TIRE_R)
 *   0.84  chassis rail bottom
 *   1.12  chassis rail top    ─┬─ cab sits on the rails
 *   1.15  cab floor           ─┘
 *   1.13  subframe bottom
 *   1.37  subframe top        ─┬─ tank sits on the subframe
 *   1.37  tank bottom         ─┘
 *   3.47  tank top
 *   3.45  cab top
 *   3.86  roof cap top
 */

// ── wheels ───────────────────────────────────────────────────────────────────
export const TIRE_R = 0.55;
export const TIRE_HW = 0.152; // half-width at the widest sidewall point

/**
 * Dual spacing is DELIBERATELY exaggerated. A real dual pair sits ~0.32 m
 * centre-to-centre, leaving a ~0.05 m gap — at which point, from any outboard
 * view, the two tires merge into one dark mass and the inner is simply hidden
 * behind the outer. No amount of shading fixes that; it's geometry.
 *
 * At 0.48 m centres the gap is ~0.18 m, so each tire reads as its own object
 * and the inner shows a clear crescent past the outer. Outer edge lands at
 * 1.252 m → 2.50 m overall, still inside the legal track. Exaggerating a
 * separation for legibility is what a technical illustration is FOR.
 *
 * Everything inboard is measured off DUAL_INNER: the inner tire spans
 * 0.468…0.772, so rails and air bags must clear 0.468.
 */
export const TRACK_SINGLE = 1.02;
export const DUAL_OUTER = 1.1;
export const DUAL_INNER = 0.62;
export const DUAL_GAP = DUAL_OUTER - DUAL_INNER - 2 * TIRE_HW;

// ── tractor ──────────────────────────────────────────────────────────────────
export const NOSE_Z = -4.95;
export const CAB_REAR_Z = -2.35;
export const CAB_W = 2.44;
export const CAB_FLOOR = 1.15;
export const CAB_TOP = 3.7;
export const ROOF_TOP = 3.82; // visor lip

export const RAIL_X = 0.38;
export const RAIL_Y = 0.98; // centre
export const RAIL_H = 0.28; // → 0.84 … 1.12
export const RAIL_TOP = RAIL_Y + RAIL_H / 2;
export const RAIL_FRONT = -4.82;

export const FIFTH_TOP = RAIL_TOP + 0.12; // plate sits on the rails → 1.24
export const LIFT_RISE = 0.26; // how far a lifted axle's tires clear the road

/**
 * The fifth wheel rides just ahead of the drive group's centre so the kingpin
 * load lands ON the driven axles. It CANNOT be a constant: with one drive axle
 * a fixed z=0.55 put the kingpin 1.1 m behind the only axle carrying it.
 */
export function fifthWheelZ(driveZs: number[]): number {
  if (!driveZs.length) return DRIVE_Z0;
  return driveZs.reduce((a, b) => a + b, 0) / driveZs.length - 0.2;
}

/** Rails must reach past the last drive axle and the fifth wheel, no further. */
export function railBack(driveZs: number[]): number {
  return Math.max(fifthWheelZ(driveZs) + 0.75, (driveZs.length ? Math.max(...driveZs) : DRIVE_Z0) + 0.95);
}

// ── trailer tank ─────────────────────────────────────────────────────────────
// The reference tank is NOT a cylinder: it's a rounded-rectangle section —
// flat sides, flat-ish top, and VERY generous corner radii, closer to a
// squircle than a box. That section is what a fuel tanker uses for a lower
// centre of gravity. TANK_RAD is the whole silhouette: under-round it and the
// barrel reads as a crate.
export const TANK_W = 2.44;
export const TANK_H = 2.1;
export const TANK_RAD = 0.72;
export const TANK_Y = 2.42;
export const TANK_Z = 5.9;
export const TANK_BODY_LEN = 9.4;
export const TANK_CAP = 0.34; // bevel thickness → the domed ends
export const TANK_BEVEL = 0.26; // how far the section pulls in at the ends

export const TANK_LEN = TANK_BODY_LEN + 2 * TANK_CAP; // 10.08
export const TANK_FRONT = TANK_Z - TANK_LEN / 2; // 0.86
export const TANK_REAR = TANK_Z + TANK_LEN / 2; // 10.94
export const TANK_BOTTOM = TANK_Y - TANK_H / 2; // 1.37
export const TANK_TOP = TANK_Y + TANK_H / 2; // 3.47
export const TANK_HW = TANK_W / 2; // 1.22

/** The side is genuinely flat between the corner radii — where stripes live. */
export const TANK_FLAT_LO = TANK_Y - (TANK_H / 2 - TANK_RAD); // 1.89
export const TANK_FLAT_HI = TANK_Y + (TANK_H / 2 - TANK_RAD); // 2.95

// ── trailer frame ────────────────────────────────────────────────────────────
export const SUB_X = 0.38;
export const SUB_Y = 1.25; // centre
export const SUB_H = 0.24; // → 1.13 … 1.37, i.e. top == TANK_BOTTOM
export const SUB_TOP = SUB_Y + SUB_H / 2;
export const NECK_FRONT = 0.05;
export const NECK_BACK = 2.5;
export const REAR_FRAME_Z = TANK_REAR + 0.1;

// ── axle longitudinal placement ──────────────────────────────────────────────
export const STEER_Z = -3.6;
export const DRIVE_Z0 = -0.55;
export const DRIVE_SPACING = 1.35;
export const TRAILER_LAST_Z = 10.45;
export const TRAILER_SPACING = 1.31;

// ── livery ───────────────────────────────────────────────────────────────────
export const APEX_BLUE = "#1f5cb4";
export const APEX_ORANGE = "#ef7220";
export const TANK_WHITE = "#f2f4f7"; // the barrel is always white — livery is the cab

/**
 * The cab, as its SIDE silhouette extruded across the cab width.
 *
 * A RoundedBox can't be anything but a crate. The reference Actros gets its
 * character from the side profile — raked screen, domed roof, chin under the
 * bumper — so model that profile and extrude it, letting the bevel round every
 * edge at once.
 *
 * Profile coords are (world z, world y). Because `bevelSize` grows the outline
 * outward (see tankGeo), the points below are drawn CAB_BEVEL short of the real
 * silhouette and the bevel pushes them out onto it.
 */
const CAB_BEVEL = 0.08;
const CAB_PROFILE: Array<[number, number]> = [
  [NOSE_Z + 0.08, CAB_FLOOR + 0.08], // chin
  [NOSE_Z + 0.02, CAB_FLOOR + 0.7],
  [NOSE_Z + 0.08, 3.02], // flat front face
  [NOSE_Z + 0.24, 3.46], // screen rake
  [NOSE_Z + 0.62, CAB_TOP - 0.08], // roof crown, front
  [CAB_REAR_Z - 0.5, CAB_TOP - 0.08], // roof crown, rear
  [CAB_REAR_Z - 0.08, CAB_TOP - 0.42],
  [CAB_REAR_Z - 0.08, CAB_FLOOR + 0.08],
];

export const cabGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(CAB_PROFILE[0][0], CAB_PROFILE[0][1]);
  for (const [z, y] of CAB_PROFILE.slice(1)) s.lineTo(z, y);
  s.closePath();

  const g = new THREE.ExtrudeGeometry(s, {
    depth: CAB_W - 2 * CAB_BEVEL,
    bevelEnabled: true,
    bevelThickness: CAB_BEVEL,
    bevelSize: CAB_BEVEL,
    bevelSegments: 4,
    curveSegments: 8,
  });
  // Shape XY holds (z, y); rotating −90° about Y maps the extrusion axis onto X
  // and the profile onto world ZY, so the geometry lands already positioned.
  g.rotateY(-Math.PI / 2);
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, 0, 0); // centre across the truck only
  g.computeVertexNormals();
  return g;
})();

/** Rounded-rectangle profile, centred on the origin in XY. */
export function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = w / 2 - r;
  const y = h / 2 - r;
  s.absarc(x, y, r, 0, Math.PI / 2, false);
  s.absarc(-x, y, r, Math.PI / 2, Math.PI, false);
  s.absarc(-x, -y, r, Math.PI, Math.PI * 1.5, false);
  s.absarc(x, -y, r, Math.PI * 1.5, Math.PI * 2, false);
  return s;
}

/**
 * The barrel: rounded-rect section extruded along Z, bevelled into domed ends.
 *
 * CAREFUL: three's `bevelSize` grows the section OUTWARD from the profile you
 * pass — the profile is what you get at the very ENDS, and the midsection ends
 * up bevelSize larger on every side. Passing the finished dimensions therefore
 * yields a barrel 2*bevelSize too wide and too tall (measured: 2.96 × 2.62
 * instead of 2.44 × 2.10). Shrink the profile by the bevel so the midsection
 * lands on the real TANK_W × TANK_H that everything else is measured against.
 */
export const tankGeo = (() => {
  const g = new THREE.ExtrudeGeometry(
    roundedRect(TANK_W - 2 * TANK_BEVEL, TANK_H - 2 * TANK_BEVEL, TANK_RAD - TANK_BEVEL),
    {
      depth: TANK_BODY_LEN,
      bevelEnabled: true,
      bevelThickness: TANK_CAP,
      bevelSize: TANK_BEVEL,
      bevelSegments: 6,
      curveSegments: 18,
    },
  );
  g.center();
  g.computeVertexNormals();
  g.computeBoundingBox();
  assertDims(g.boundingBox!);
  return g;
})();

/**
 * Geometry audit. The barrel is the datum every other trailer part measures
 * against, so if the mesh three actually produces disagrees with the constants,
 * say so loudly instead of letting parts float apart by a few centimetres.
 */
function assertDims(b: THREE.Box3) {
  const checks: Array<[string, number, number]> = [
    ["half-width", b.max.x, TANK_HW],
    ["half-height", b.max.y, TANK_H / 2],
    ["half-length", b.max.z, TANK_LEN / 2],
  ];
  for (const [name, actual, expected] of checks) {
    if (Math.abs(actual - expected) > 0.005) {
      console.error(`[dims] tank ${name}: mesh says ${actual.toFixed(3)}, constants say ${expected.toFixed(3)}`);
    }
  }
}
