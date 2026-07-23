/**
 * The 3D tire diagram, driven ENTIRELY by chassis rows + live assignments —
 * nothing about the truck is hand-placed (see dims.ts for the geometry datum
 * and the vertical stack-up).
 *
 * Interaction model (settled in the truck-preview spike):
 *   - click a wheel of a dual pair → camera lifts overhead of THAT PAIR, the
 *     rest of the truck disappears, both tires get code chips. Inner duals are
 *     physically occluded from every side angle; overhead-with-body-hidden is
 *     the only view where both have equal, stable click targets.
 *   - singles/spares just select (nothing occludes them).
 *   - Esc / click empty space → back to the solved full-truck fit.
 *   - camera glides on WALL-CLOCK time (rAF-starved webviews stall per-frame
 *     damping mid-glide).
 *
 * Status encoding (in-app, real data): occupied = emerald, occupied spare
 * slot = sky, EMPTY position = hollow slate ring — an empty position is a
 * real state a storeman acts on, not an error.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Instances, Instance, OrbitControls, Outlines, RoundedBox, ContactShadows, Environment, Lightformer, Grid } from "@react-three/drei";
import { EffectComposer, N8AO, Bloom, Vignette } from "@react-three/postprocessing";

import type { AxleRow as ChassisAxle, PositionRow as ChassisPosition } from "@/shared/api/client";
import {
  DRIVE_SPACING,
  DRIVE_Z0,
  DUAL_INNER,
  DUAL_OUTER,
  LIFT_RISE,
  NECK_BACK,
  NOSE_Z,
  RAIL_FRONT,
  RAIL_H,
  RAIL_TOP,
  RAIL_X,
  RAIL_Y,
  REAR_FRAME_Z,
  STEER_Z,
  SUB_H,
  SUB_X,
  SUB_Y,
  TANK_BODY_LEN,
  TANK_BOTTOM,
  TANK_HW,
  TANK_TOP,
  TANK_WHITE,
  TANK_Y,
  TANK_Z,
  TIRE_R,
  TRACK_SINGLE,
  TRAILER_LAST_Z,
  TRAILER_SPACING,
  cabGeo,
  fifthWheelZ,
  railBack,
  tankGeo,
  APEX_BLUE,
  APEX_ORANGE,
} from "./dims";

// ── palette ──────────────────────────────────────────────────────────────────
const DARK = "#2b313b";
const CHASSIS = "#252b34";
const GLASS = "#2a3446";
const OUT = "#0f172a";
const RUBBER = "#23272e";
const RIM_C = "#dfe5ec";

export const POSITION_COLORS = {
  occupied: "#10b981",
  spare: "#38bdf8",
  empty: "#94a3b8",
  /** Mount is queued locally, not yet server-acked — visibly "in flight". */
  pending: "#f59e0b",
} as const;

const RM =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

// ── shared wheel geometry (one set for every wheel) ──────────────────────────
const TIRE_PROFILE: Array<[number, number]> = [
  [0.3, -0.145], [0.42, -0.152], [0.505, -0.143], [0.545, -0.122], [0.55, -0.1],
  [0.55, -0.074], [0.532, -0.07], [0.532, -0.056], [0.55, -0.052],
  [0.55, -0.02], [0.532, -0.016], [0.532, -0.002], [0.55, 0.002],
  [0.55, 0.034], [0.532, 0.038], [0.532, 0.052], [0.55, 0.056],
  [0.55, 0.1], [0.545, 0.122], [0.505, 0.143], [0.42, 0.152], [0.3, 0.145],
];
const tireGeo = new THREE.LatheGeometry(TIRE_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 56);
const rimGeo = new THREE.CylinderGeometry(0.295, 0.295, 0.33, 32);
const capGeo = new THREE.CylinderGeometry(0.185, 0.185, 0.37, 24);
const lugGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.42, 8);
const ringGeo = new THREE.RingGeometry(0.3, 0.505, 44);
const emptyGeo = new THREE.TorusGeometry(0.5, 0.045, 10, 44);
const haloGeo = new THREE.TorusGeometry(0.68, 0.024, 8, 48);
const LUG_ANGLES = Array.from({ length: 10 }, (_, i) => (i / 10) * Math.PI * 2);

// ── row → metres ─────────────────────────────────────────────────────────────
function makeAxleZ(axles: ChassisAxle[]) {
  const trailerCount = axles.filter((a) => a.section === "trailer").length;
  return (a: ChassisAxle): number =>
    a.section === "tractor"
      ? a.is_steering
        ? STEER_Z
        : DRIVE_Z0 + (a.section_index - 2) * DRIVE_SPACING
      : TRAILER_LAST_Z - (trailerCount - a.section_index) * TRAILER_SPACING;
}

function positionXYZ(
  p: ChassisPosition,
  axleById: Map<string, ChassisAxle>,
  axleZ: (a: ChassisAxle) => number,
): [number, number, number] {
  if (p.is_spare) {
    return [0, 0.62, 2.45 + ((p.spare_index ?? 1) - 1) * 0.95];
  }
  const a = axleById.get(p.axle_id ?? "");
  if (!a) return [0, TIRE_R, 0];
  const sign = p.side === "left" ? -1 : 1;
  const x = p.depth === "single" ? TRACK_SINGLE : p.depth === "outer" ? DUAL_OUTER : DUAL_INNER;
  return [sign * x, a.is_lifted ? TIRE_R + LIFT_RISE : TIRE_R, axleZ(a)];
}

/** The dual PAIR that shares this position's axle+side (empty slots included). */
function pairOf(p: ChassisPosition, all: ChassisPosition[]): ChassisPosition[] {
  if (p.is_spare || !p.axle_id) return [];
  const members = all.filter((q) => q.axle_id === p.axle_id && q.side === p.side);
  return members.length >= 2 ? members : [];
}

// ── small generic parts ──────────────────────────────────────────────────────
function Part({
  geometry = "box",
  args,
  position,
  rotation,
  color = TANK_WHITE,
  outline = true,
}: {
  geometry?: "box" | "cyl";
  args: number[];
  position?: [number, number, number];
  rotation?: [number, number, number];
  color?: string;
  outline?: boolean;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      {geometry === "box" ? (
        <boxGeometry args={args as [number, number, number]} />
      ) : (
        <cylinderGeometry args={args as [number, number, number, number]} />
      )}
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.05} />
      {outline && <Outlines thickness={0.004} color={OUT} screenspace />}
    </mesh>
  );
}

/** Status-ring material whose color GLIDES between states (mount acks,
 * status changes, legend dimming) instead of snapping. Non-animated fields
 * stay explicit props — R3F mutates materials in place, and a field that
 * stops being passed is never reset (the ghosting gotcha). */
function DampedStatusMaterial({
  target,
  emissiveTarget,
  emissiveIntensity,
  ghost,
}: {
  target: string;
  emissiveTarget: string;
  emissiveIntensity: number;
  ghost: { transparent: boolean; opacity: number; depthWrite: boolean };
}) {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  const goal = useRef({ c: new THREE.Color(target), e: new THREE.Color(emissiveTarget) });
  goal.current.c.set(target);
  goal.current.e.set(emissiveTarget);

  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    if (RM) {
      m.color.copy(goal.current.c);
      m.emissive.copy(goal.current.e);
      return;
    }
    const k = 1 - Math.exp(-9 * dt);
    m.color.lerp(goal.current.c, k);
    m.emissive.lerp(goal.current.e, k);
  });

  return (
    <meshStandardMaterial
      ref={ref}
      roughness={0.45}
      side={THREE.DoubleSide}
      emissiveIntensity={emissiveIntensity}
      transparent={ghost.transparent}
      opacity={ghost.opacity}
      depthWrite={ghost.depthWrite}
    />
  );
}

// ── the wheel / empty slot ───────────────────────────────────────────────────
interface WheelProps {
  pos: ChassisPosition;
  xyz: [number, number, number];
  dimmed: boolean;
  selected: boolean;
  labelled: boolean;
  onSelect: (p: ChassisPosition) => void;
}

function Wheel({ pos, xyz, dimmed, selected, labelled, onSelect }: WheelProps) {
  const grp = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const occupied = !!pos.tire_id;
  const color = occupied
    ? pos.pending
      ? POSITION_COLORS.pending
      : pos.is_spare
        ? POSITION_COLORS.spare
        : POSITION_COLORS.occupied
    : POSITION_COLORS.empty;
  const emph = hovered || selected;

  useFrame((_, dt) => {
    const o = grp.current;
    if (!o) return;
    const target = emph ? 1.06 : 1;
    const s = RM ? target : o.scale.x + (target - o.scale.x) * (1 - Math.exp(-12 * dt));
    o.scale.setScalar(s);
  });

  const ghost = dimmed ? { transparent: true, opacity: 0.13, depthWrite: false } : { transparent: false, opacity: 1, depthWrite: true };

  return (
    <group
      ref={grp}
      position={xyz}
      onClick={(e) => {
        // An orbit drag that ends over a wheel fires click on release —
        // event.delta is the pointer travel; a real click is near-zero.
        if (e.delta > 3) return;
        e.stopPropagation();
        onSelect(pos);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "auto";
      }}
    >
      <group rotation={pos.is_spare ? [0, 0, 0] : [0, 0, Math.PI / 2]}>
        {occupied ? (
          <>
            <mesh geometry={tireGeo} castShadow={!dimmed}>
              <meshStandardMaterial color={RUBBER} roughness={0.92} metalness={0} side={THREE.DoubleSide} {...ghost} />
              {!dimmed && (
                <Outlines
                  thickness={selected ? 0.014 : hovered ? 0.007 : 0.004}
                  color={selected ? "#0b1220" : OUT}
                  screenspace
                />
              )}
            </mesh>
            {!dimmed && (
              <>
                <mesh geometry={rimGeo} castShadow>
                  <meshStandardMaterial color={RIM_C} roughness={0.26} metalness={0.72} />
                </mesh>
                <mesh geometry={capGeo}>
                  <meshStandardMaterial color="#c8d1db" roughness={0.3} metalness={0.6} />
                </mesh>
                <Instances limit={10} geometry={lugGeo} castShadow>
                  <meshStandardMaterial color="#7f8a97" roughness={0.38} metalness={0.62} />
                  {LUG_ANGLES.map((a, i) => (
                    <Instance key={i} position={[Math.cos(a) * 0.125, 0, Math.sin(a) * 0.125]} />
                  ))}
                </Instances>
              </>
            )}
            {[0.168, -0.168].map((y) => (
              <mesh key={y} geometry={ringGeo} position={[0, y, 0]} rotation={[(y > 0 ? -1 : 1) * (Math.PI / 2), 0, 0]}>
                <DampedStatusMaterial
                  target={dimmed ? POSITION_COLORS.empty : color}
                  emissiveTarget={dimmed ? "#000000" : color}
                  emissiveIntensity={dimmed ? 0 : selected ? 0.9 : hovered ? 0.6 : 0.3}
                  ghost={ghost}
                />
              </mesh>
            ))}
          </>
        ) : (
          // Empty slot: a hollow ring at wheel radius — clickable to mount.
          <>
            {/* Invisible full-disc hit target. Raycasting hits GEOMETRY, and a
                thin torus leaves its whole centre as a dead zone — clicks
                "between the rims" missed. This disc matches a mounted tire's
                extent exactly, so empty and occupied positions feel identical.
                colorWrite/depthWrite off ⇒ zero visual footprint. */}
            <mesh>
              <cylinderGeometry args={[0.55, 0.55, 0.31, 24]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
            </mesh>
            <mesh geometry={emptyGeo} rotation={[Math.PI / 2, 0, 0]}>
              <meshStandardMaterial
                color={color}
                roughness={0.5}
                transparent
                opacity={dimmed ? 0.1 : hovered || selected ? 0.95 : 0.55}
                emissive={color}
                emissiveIntensity={selected ? 0.7 : hovered ? 0.4 : 0.1}
              />
            </mesh>
          </>
        )}

        {selected && (
          <>
            <mesh geometry={haloGeo} position={[0, 0.19, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
            <mesh geometry={haloGeo} position={[0, -0.19, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
          </>
        )}
      </group>

      {(hovered || selected || labelled) && !dimmed && (
        <Html position={[0, 0.86, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div
            className={
              "rounded-md bg-slate-900 text-white font-semibold tracking-wide whitespace-nowrap shadow-lg " +
              (selected ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs")
            }
          >
            {pos.position_code}
          </div>
        </Html>
      )}
    </group>
  );
}

// ── body ─────────────────────────────────────────────────────────────────────
function Tractor({ driveZs }: { driveZs: number[] }) {
  const lastDrive = driveZs.length ? Math.max(...driveZs) : DRIVE_Z0;
  const fifthZ = fifthWheelZ(driveZs);
  const rBack = railBack(driveZs);
  const railLen = rBack - RAIL_FRONT;
  const railZ = (rBack + RAIL_FRONT) / 2;
  return (
    <group>
      {[-RAIL_X, RAIL_X].map((x) => (
        <Part key={x} args={[0.14, RAIL_H, railLen]} position={[x, RAIL_Y, railZ]} color={CHASSIS} />
      ))}
      <mesh geometry={cabGeo} castShadow receiveShadow>
        <meshPhysicalMaterial color={TANK_WHITE} roughness={0.34} metalness={0.05} clearcoat={0.55} clearcoatRoughness={0.28} />
        <Outlines thickness={0.004} color={OUT} screenspace />
      </mesh>
      {/* glass + grille, kept minimal — the diagram's subject is the wheels */}
      <Part args={[2.05, 0.8, 0.05]} position={[0, 3.05, NOSE_Z + 0.02]} color={GLASS} outline={false} />
      <Part args={[1.72, 0.8, 0.06]} position={[0, 2.0, NOSE_Z + 0.01]} color={DARK} />
      <RoundedBox args={[2.5, 0.42, 0.38]} radius={0.12} smoothness={4} position={[0, 1.35, NOSE_Z + 0.16]} castShadow>
        <meshStandardMaterial color={DARK} roughness={0.6} />
      </RoundedBox>
      <Part geometry="cyl" args={[0.56, 0.56, 0.12, 28]} position={[0, RAIL_TOP + 0.06, fifthZ]} color={CHASSIS} />
      {[-0.9, 0.9].map((x) => (
        <Part key={x} args={[0.52, 0.48, 0.03]} position={[x, 0.32, Math.min(lastDrive + 0.82, rBack - 0.1)]} color={CHASSIS} outline={false} />
      ))}
    </group>
  );
}

function Trailer({ axles, axleZ, fifthZ }: { axles: ChassisAxle[]; axleZ: (a: ChassisAxle) => number; fifthZ: number }) {
  const zs = axles.map(axleZ);
  const firstZ = Math.min(...zs);
  const subBack = REAR_FRAME_Z;
  const subFront = Math.min(firstZ - 1.3, NECK_BACK);
  const subLen = subBack - subFront;
  const subZ = (subBack + subFront) / 2;
  const stripeLen = TANK_BODY_LEN - 0.4;
  return (
    <group>
      <mesh geometry={tankGeo} position={[0, TANK_Y, TANK_Z]} castShadow receiveShadow>
        <meshPhysicalMaterial color={TANK_WHITE} roughness={0.28} metalness={0.1} clearcoat={0.7} clearcoatRoughness={0.22} />
        <Outlines thickness={0.004} color={OUT} screenspace />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <Part args={[0.02, 0.26, stripeLen]} position={[s * (TANK_HW + 0.012), 2.6, TANK_Z]} color={APEX_BLUE} outline={false} />
          <Part args={[0.02, 0.1, stripeLen]} position={[s * (TANK_HW + 0.012), 2.35, TANK_Z]} color={APEX_ORANGE} outline={false} />
        </group>
      ))}
      {[-1.9, 0, 1.9].map((dz) => (
        <Part key={dz} geometry="cyl" args={[0.25, 0.25, 0.12, 20]} position={[0, TANK_TOP + 0.02, TANK_Z + dz]} color="#d3dae2" outline={false} />
      ))}
      {/* gooseneck + subframe */}
      <Part
        args={[1.5, SUB_Y + SUB_H / 2 - (RAIL_TOP + 0.12), NECK_BACK - (fifthZ - 0.5)]}
        position={[0, (SUB_Y + SUB_H / 2 + RAIL_TOP + 0.12) / 2, (NECK_BACK + fifthZ - 0.5) / 2]}
        color={CHASSIS}
      />
      {[-SUB_X, SUB_X].map((x) => (
        <Part key={x} args={[0.13, SUB_H, subLen]} position={[x, SUB_Y, subZ]} color={CHASSIS} />
      ))}
      {/* rear frame + lamps */}
      <Part args={[2.14, 0.26, 0.08]} position={[0, 1.0, REAR_FRAME_Z]} color={TANK_WHITE} />
      {[-0.8, 0.8].map((x) => (
        <Part key={x} args={[0.28, 0.13, 0.04]} position={[x, 1.0, REAR_FRAME_Z + 0.05]} color="#d92b2b" outline={false} />
      ))}
      <Part args={[2.2, 0.3, 0.1]} position={[0, 0.62, REAR_FRAME_Z + 0.02]} color={TANK_WHITE} />
      {/* landing gear */}
      {[-0.78, 0.78].map((x) => (
        <Part key={x} args={[0.12, SUB_Y - SUB_H / 2 - 0.18, 0.12]} position={[x, (SUB_Y - SUB_H / 2 + 0.18) / 2, 2.15]} color={CHASSIS} />
      ))}
      {/* discharge cabinet under the belly */}
      <Part args={[0.96, 0.42, 1.5]} position={[0, TANK_BOTTOM - 0.14, TANK_Z + 1.2]} color={TANK_WHITE} />
    </group>
  );
}

// ── camera ───────────────────────────────────────────────────────────────────
const VIEW_DIR = new THREE.Vector3(0.8, 0.45, -0.55).normalize();
const TOP_DOWN = new THREE.Vector3(0, 0.99, -0.14).normalize();
const FOV = 23;
const GLIDE_MS = 700;
const easeInOut = (t: number) => t * t * (3 - 2 * t);

interface Glide {
  pos0: THREE.Vector3;
  tgt0: THREE.Vector3;
  pos1: THREE.Vector3;
  tgt1: THREE.Vector3;
  t0: number;
}

function CameraRig({
  focus,
  onFirstFit,
}: {
  focus: { centre: [number, number, number]; span: number } | null;
  onFirstFit: () => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void; addEventListener: (e: string, f: () => void) => void; removeEventListener: (e: string, f: () => void) => void } | null;
  const goal = useRef<Glide | null>(null);
  const first = useRef(true);
  // Track the focus identity so a resize-triggered re-fit snaps instead of
  // gliding. Without this, the container settling to its real size one frame
  // after mount fires a second fit that glides from the stale fit to the
  // correct one — read on screen as a jitter on load.
  const prevFocusKey = useRef<string | null>(null);

  const userMoved = useRef(false);

  useEffect(() => {
    if (!controls) return;
    const onStart = () => {
      goal.current = null;
      // The user owns the camera now — resizes must not teleport it home.
      userMoved.current = true;
    };
    controls.addEventListener("start", onStart);
    return () => controls.removeEventListener("start", onStart);
  }, [controls]);

  useEffect(() => {
    if (!controls) return;
    const solveFit = () => {
      const root = scene.getObjectByName("rig-root");
      if (!root) return null;
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return null;
      const centre = box.getCenter(new THREE.Vector3());
      const corners: THREE.Vector3[] = [];
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
      const probe = new THREE.PerspectiveCamera(FOV, size.width / size.height, 0.1, 400);
      let dist = 30;
      for (let i = 0; i < 8; i++) {
        probe.position.copy(centre).addScaledVector(VIEW_DIR, dist);
        probe.lookAt(centre);
        probe.updateMatrixWorld(true);
        probe.updateProjectionMatrix();
        let worst = 0;
        for (const c of corners) {
          const p = c.clone().project(probe);
          worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
        }
        dist *= worst * 1.07;
      }
      return { tgt: centre, pos: centre.clone().addScaledVector(VIEW_DIR, dist) };
    };
    const solveFocus = (f: { centre: [number, number, number]; span: number }) => {
      const tgt = new THREE.Vector3(...f.centre);
      const t = 2 * Math.tan(((FOV * Math.PI) / 180) / 2);
      const aspect = size.width / size.height;
      const dist = ((f.span * 1.5) / t) * Math.max(1, 1 / aspect);
      return { tgt, pos: tgt.clone().addScaledVector(TOP_DOWN, dist) };
    };

    const focusKey = focus ? focus.centre.join(",") : null;
    const focusChanged = focusKey !== prevFocusKey.current;
    prevFocusKey.current = focusKey;

    const raf = requestAnimationFrame(() => {
      const g = focus ? solveFocus(focus) : solveFit();
      if (!g) return;
      // A resize while a glide is IN FLIGHT retargets the glide to the pose
      // re-solved for the new viewport instead of snapping — selecting a
      // wheel resizes the canvas (the inspector column appears), and a snap
      // here killed the signature glide on every first selection.
      if (!focusChanged && goal.current) {
        goal.current.pos1 = g.pos;
        goal.current.tgt1 = g.tgt;
        return;
      }
      // A resize after the user manually orbited must not teleport the camera
      // back to the solved pose — they own it until the next focus change.
      if (!focusChanged && userMoved.current && !first.current) {
        return;
      }
      if (focusChanged) userMoved.current = false;
      // Snap (no glide) on the first fit, when reduced-motion is set, or when
      // this re-fit is only due to a container resize (focus unchanged). Glide
      // only for a genuine focus change — click into a pair, or Esc back out.
      if (first.current || RM || !focusChanged) {
        camera.position.copy(g.pos);
        controls.target.copy(g.tgt);
        controls.update();
        if (first.current) onFirstFit();
        first.current = false;
      } else {
        goal.current = {
          pos0: camera.position.clone(),
          tgt0: controls.target.clone(),
          pos1: g.pos,
          tgt1: g.tgt,
          t0: performance.now(),
        };
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [controls, focus, size.width, size.height, camera, scene, onFirstFit]);

  useFrame(() => {
    const g = goal.current;
    if (!g || !controls) return;
    const t = Math.min((performance.now() - g.t0) / GLIDE_MS, 1);
    const k = easeInOut(t);
    camera.position.lerpVectors(g.pos0, g.pos1, k);
    controls.target.lerpVectors(g.tgt0, g.tgt1, k);
    controls.update();
    if (t >= 1) goal.current = null;
  });

  return null;
}

// ── the widget ───────────────────────────────────────────────────────────────
export interface TruckDiagramProps {
  axles: ChassisAxle[];
  positions: ChassisPosition[];
  selectedId: string | null;
  onSelect: (p: ChassisPosition | null) => void;
}

export function TruckDiagram({ axles, positions, selectedId, onSelect }: TruckDiagramProps) {
  const [ready, setReady] = useState(false);
  const onFirstFit = useMemo(() => () => setReady(true), []);
  const axleZ = useMemo(() => makeAxleZ(axles), [axles]);
  const axleById = useMemo(() => new Map(axles.map((a) => [a.id, a])), [axles]);
  const driveZs = useMemo(
    () => axles.filter((a) => a.section === "tractor" && !a.is_steering).map(axleZ),
    [axles, axleZ],
  );
  const trailerAxles = useMemo(() => axles.filter((a) => a.section === "trailer"), [axles]);
  const fifthZ = fifthWheelZ(driveZs);

  const selected = positions.find((p) => p.id === selectedId) ?? null;
  const focusPair = useMemo(() => {
    if (!selected) return null;
    const pair = pairOf(selected, positions);
    if (pair.length < 2) return null;
    const pts = pair.map((m) => positionXYZ(m, axleById, axleZ));
    const mean = (i: 0 | 1 | 2) => pts.reduce((a, b) => a + b[i], 0) / pts.length;
    const xs = pts.map((q) => q[0]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs) + 0.31, 2 * TIRE_R);
    return {
      centre: [mean(0), mean(1), mean(2)] as [number, number, number],
      span,
      ids: pair.map((m) => m.id),
    };
  }, [selected, positions, axleById, axleZ]);

  const detail = !!focusPair;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Never deselect while focus is inside a form control — the inspector
      // forms are keyed by selection, so a global Escape would unmount them
      // and destroy everything typed (Radix Selects also close via Escape
      // without stopping propagation to window).
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable ||
          t.closest('[role="listbox"],[role="dialog"],[role="combobox"]'))
      ) {
        return;
      }
      onSelect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelect]);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: FOV, position: [18, 11, -12], near: 0.4, far: 400 }}
      onPointerMissed={() => onSelect(null)}
      className="rounded-lg"
      style={{ opacity: ready ? 1 : 0, transition: "opacity 180ms ease-out" }}
    >
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[9, 14, -7]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-far={50}
      />
      <directionalLight position={[-10, 7, 10]} intensity={0.45} />
      {/* Procedural studio environment — Lightformers only, nothing fetched
          (the CSP allows no external HDRIs). This is what makes the clearcoat
          paint and metal rims read as materials instead of flat fills. */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 12, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[26, 26, 1]} />
        <Lightformer form="rect" intensity={1.1} position={[14, 5, -6]} rotation={[0, -Math.PI / 2.6, 0]} scale={[16, 5, 1]} />
        <Lightformer form="rect" intensity={0.8} position={[-14, 4, 8]} rotation={[0, Math.PI / 2.4, 0]} scale={[14, 4, 1]} />
        <Lightformer form="ring" intensity={0.6} position={[0, 6, 16]} scale={[9, 9, 1]} />
      </Environment>

      <group name="rig-root">
        {!detail && <Tractor driveZs={driveZs} />}
        {!detail && trailerAxles.length > 0 && (
          <Trailer axles={trailerAxles} axleZ={axleZ} fifthZ={fifthZ} />
        )}
        {!detail &&
          axles.map((a) => (
            <group key={a.id} position={[0, TIRE_R + (a.is_lifted ? LIFT_RISE : 0), axleZ(a)]}>
              <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.095, 0.095, 2.62, 16]} />
                <meshStandardMaterial color={CHASSIS} roughness={0.6} />
              </mesh>
            </group>
          ))}

        {positions.map((p) => {
          if (detail && !focusPair.ids.includes(p.id)) return null;
          return (
            <Wheel
              key={p.id}
              pos={p}
              xyz={positionXYZ(p, axleById, axleZ)}
              dimmed={false}
              selected={selectedId === p.id}
              labelled={detail}
              // No toggle-off on the wheel: the second click of a double-click
              // used to re-select→deselect and fight the camera. Esc, the
              // close button, or clicking empty space deselect.
              onSelect={onSelect}
            />
          );
        })}
      </group>

      <ContactShadows position={[0, 0.005, 3.4]} scale={38} resolution={1024} blur={2.3} opacity={0.36} far={5} color="#0f172a" />
      <Grid
        position={[0, -0.002, 3.4]}
        args={[60, 60]}
        cellSize={0.62}
        cellThickness={0.55}
        cellColor="#c7cfda"
        sectionSize={3.1}
        sectionThickness={1}
        sectionColor="#aeb9c7"
        fadeDistance={34}
        fadeStrength={2.2}
        infiniteGrid
      />
      {/* AO grounds the wheels against the body; bloom only catches the
          selection halos (toneMapped: false pushes them past the threshold);
          multisampling keeps the technical-illustration edges crisp. */}
      <EffectComposer multisampling={4}>
        <N8AO aoRadius={0.5} intensity={2.4} distanceFalloff={0.7} quality="medium" />
        <Bloom mipmapBlur intensity={0.35} luminanceThreshold={0.95} luminanceSmoothing={0.2} />
        <Vignette eskil={false} offset={0.24} darkness={0.38} />
      </EffectComposer>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={2}
        maxDistance={70}
        maxPolarAngle={Math.PI / 2 - 0.03}
      />
      <CameraRig focus={focusPair} onFirstFit={onFirstFit} />
    </Canvas>
  );
}
