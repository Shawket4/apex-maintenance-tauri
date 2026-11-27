// Pure helpers for the Settings screens: no React, no i18n instance — the
// components turn the keys returned here into text.
import { parseIntInput, toAsciiDigits } from "@/shared/lib/numbers";

// ── vehicle classes ──────────────────────────────────────────────────────────

const AR_TO_LATIN: Record<string, string> = {
  ا: "a", أ: "a", إ: "i", آ: "a", ء: "", ؤ: "o", ئ: "e", ب: "b", ت: "t", ث: "th", ج: "g", ح: "h", خ: "kh",
  د: "d", ذ: "z", ر: "r", ز: "z", س: "s", ش: "sh", ص: "s", ض: "d", ط: "t", ظ: "z", ع: "a", غ: "gh",
  ف: "f", ق: "q", ك: "k", ل: "l", م: "m", ن: "n", ه: "h", ة: "a", و: "w", ي: "y", ى: "a",
};

/** The internal id of a new class, made from its name so nobody is ever asked
 * for a "code": Arabic letters are spelled in Latin, everything else that is
 * not a letter or digit becomes "_", and a number is appended until the id is
 * free. (The server accepts lowercase ASCII letters, digits, "_" and "-".) */
export function slugForClass(name: string, takenIds: readonly string[]): string {
  const latin = Array.from(toAsciiDigits(name.trim().toLowerCase()))
    .map((ch) => AR_TO_LATIN[ch] ?? ch)
    .join("");
  const base =
    latin
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "class";
  const taken = new Set(takenIds.map((id) => id.toLowerCase()));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Names compared the way a person reads them: spacing, letter case, hamza
 * forms and ة/ه, ى/ي do not make two names different. */
export function nameKey(name: string): string {
  return toAsciiDigits(name)
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\u0640|[\u064B-\u0652]/g, "")
    .replace(/\s+/g, " ");
}

/** Plates are matched ignoring spaces and digit script ("١٢٣ أ ب" ~ "123أب"). */
export function plateKey(s: string): string {
  return toAsciiDigits(s).replace(/\s+/g, "").toLowerCase();
}

// ── service plans ────────────────────────────────────────────────────────────

export type PlanForm = { km: string; days: string; warnKm: string; warnDays: string };
export type PlanValues = {
  intervalKm: number | null;
  intervalDays: number | null;
  leadWarnKm: number | null;
  leadWarnDays: number | null;
};
/** i18n key suffix under `settings.plans.err.*`. */
export type PlanError = "needInterval" | "badKm" | "badDays" | "badWarnKm" | "badWarnDays" | "warnTooBigKm" | "warnTooBigDays";

export const MAX_INTERVAL_KM = 1_000_000;
export const MAX_INTERVAL_DAYS = 3650;

function field(s: string): number | null | "bad" {
  if (s.trim() === "") return null;
  const n = parseIntInput(s);
  return n == null ? "bad" : n;
}

/** A plan needs at least one interval (km, days, or both — due on whichever
 * comes first); every number must be positive; a warning that is not shorter
 * than its interval would mean "always due soon". */
export function validatePlan(f: PlanForm): { ok: true; values: PlanValues } | { ok: false; error: PlanError } {
  const km = field(f.km);
  const days = field(f.days);
  const warnKm = field(f.warnKm);
  const warnDays = field(f.warnDays);
  if (km === "bad" || (km != null && (km <= 0 || km > MAX_INTERVAL_KM))) return { ok: false, error: "badKm" };
  if (days === "bad" || (days != null && (days <= 0 || days > MAX_INTERVAL_DAYS))) return { ok: false, error: "badDays" };
  if (km == null && days == null) return { ok: false, error: "needInterval" };
  if (warnKm === "bad" || (warnKm != null && warnKm < 0)) return { ok: false, error: "badWarnKm" };
  if (warnDays === "bad" || (warnDays != null && warnDays < 0)) return { ok: false, error: "badWarnDays" };
  if (warnKm != null && km != null && warnKm >= km) return { ok: false, error: "warnTooBigKm" };
  if (warnDays != null && days != null && warnDays >= days) return { ok: false, error: "warnTooBigDays" };
  return {
    ok: true,
    values: {
      intervalKm: km,
      intervalDays: days,
      // A warning only means something next to its own interval. An empty
      // field means "the usual warning" — worked out here and sent, so what
      // the preview says is exactly what gets stored (0 = no early warning).
      leadWarnKm: km != null ? (warnKm ?? defaultWarnKm(km)) : null,
      leadWarnDays: days != null ? (warnDays ?? defaultWarnDays(days)) : null,
    },
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The usual early warning: a tenth of the interval (the server's own
 * default), never as long as the interval itself. */
export function defaultWarnKm(intervalKm: number): number {
  return Math.min(clamp(Math.floor(intervalKm / 10), 100, 2000), intervalKm - 1);
}
export function defaultWarnDays(intervalDays: number): number {
  return Math.min(clamp(Math.floor(intervalDays / 10), 1, 14), intervalDays - 1);
}

// ── changes (waiting, or refused) said in words ──────────────────────────────

export type Payload = Record<string, unknown>;

/** The JSON a change carried, or null when it is missing or not an object. */
export function parsePayload(raw: string | null | undefined): Payload | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Payload) : null;
  } catch {
    return null;
  }
}

const CHASSIS = new Set(["chassis_layouts", "chassis_axles", "chassis_positions"]);

/** What a change was, as an i18n key under `settings.what.*`
 * ("tire_assignments" + "insert" → `mount` → "تركيب كاوتش"). */
export function changeKey(entityType: string, op: string, payload: Payload | null): string {
  const p = payload ?? {};
  const removal = op === "delete" || (op === "update" && p.deleted_at != null);
  switch (entityType) {
    case "work_orders":
      if (removal) return "woDelete";
      if (op === "insert") return "woOpen";
      if (p.status === "closed") return "woClose";
      if (p.status === "open") return "woReopen";
      return "woEdit";
    case "work_order_tasks":
      if (removal) return "taskDelete";
      if (op === "insert") return "taskAdd";
      if (Object.keys(p).length > 0 && Object.keys(p).every((k) => k === "is_done" || k === "done_at" || k === "updated_at")) {
        return p.is_done === true || p.is_done === 1 ? "taskDone" : "taskUndone";
      }
      return "taskEdit";
    case "oil_changes":
      if (removal) return "oilDelete";
      return op === "insert" ? "oilAdd" : "oilEdit";
    case "tires":
      if (removal) return "tireDelete";
      return op === "insert" ? "tireAdd" : "tireEdit";
    case "tire_assignments":
      if (removal) return "mountUndo";
      if (op === "insert") return "mount";
      if (p.dismounted_at != null) return "dismount";
      return "mountEdit";
    case "tire_status_events":
      return removal ? "tireStatusDelete" : "tireStatus";
    case "vehicle_class_assignments":
      return removal ? "classRemove" : "classSet";
    case "vehicle_odometer_overrides":
      return removal ? "odometerFixDelete" : "odometerFix";
    case "batteries":
      if (removal) return "batteryDelete";
      if (op === "insert") return "batteryAdd";
      if (Object.keys(p).length > 0 && Object.keys(p).every((k) => k === "status" || k === "updated_at")) {
        return "batteryStatus";
      }
      return "batteryEdit";
    case "battery_installs":
      if (removal) return "batteryFitUndo";
      if (op === "insert") return "batteryFit";
      return p.removed_at != null ? "batteryRemove" : "batteryRemoveUndo";
    case "battery_layouts":
      return "batterySlots";
    case "attendance_days":
      return "attendanceMark";
    case "attendance_workers":
      if (removal) return "workerDelete";
      return op === "insert" ? "workerAdd" : "workerEdit";
    default:
      if (CHASSIS.has(entityType)) {
        if (removal) return "chassisDelete";
        return op === "insert" ? "chassisAdd" : "chassisEdit";
      }
      if (removal) return "otherDelete";
      return op === "insert" ? "otherAdd" : "otherEdit";
  }
}

export type FieldKind =
  | "text"
  | "code"
  | "km"
  | "liters"
  | "date"
  | "bool"
  | "truck"
  | "class"
  | "category"
  | "reason"
  | "status";

/** The fields of a change worth showing, in reading order. Anything not
 * listed (ids, timestamps of bookkeeping, sync counters) is left out. */
const FIELDS: [string, FieldKind][] = [
  ["vehicle_id", "truck"],
  ["class_id", "class"],
  ["category_id", "category"],
  ["title", "text"],
  ["description_ar", "text"],
  ["oil_type", "text"],
  ["liters", "liters"],
  ["brand", "text"],
  ["model", "text"],
  ["size", "text"],
  ["dot_code", "code"],
  ["serial", "code"],
  ["slot", "text"],
  ["slots", "text"],
  ["odometer", "km"],
  ["odometer_at_open", "km"],
  ["mounted_odometer", "km"],
  ["dismounted_odometer", "km"],
  ["base_km", "km"],
  ["mount_reason", "reason"],
  ["dismount_reason", "reason"],
  ["status", "status"],
  ["to_status", "status"],
  ["is_done", "bool"],
  ["performed_at", "date"],
  ["opened_at", "date"],
  ["closed_at", "date"],
  ["mounted_at", "date"],
  ["dismounted_at", "date"],
  ["occurred_at", "date"],
  ["notes", "text"],
  ["notes_ar", "text"],
];

export type ShownField = { field: string; kind: FieldKind; value: string | number | boolean };

/** What the user had entered, as (field, kind, value) triples the screen can
 * label and format. Empty values and unknown fields are dropped. */
export function shownFields(payload: Payload | null): ShownField[] {
  if (!payload) return [];
  const out: ShownField[] = [];
  for (const [name, kind] of FIELDS) {
    const v = payload[name];
    if (v == null || v === "") continue;
    if (kind === "bool") {
      out.push({ field: name, kind, value: v === true || v === 1 });
    } else if (typeof v === "string" || typeof v === "number") {
      out.push({ field: name, kind, value: v });
    }
  }
  return out;
}

/** The truck a change was about, when the change itself says so. */
export function payloadVehicleId(entityType: string, entityId: string, payload: Payload | null): number | null {
  const v = payload?.vehicle_id;
  if (typeof v === "number") return v;
  // These tables are keyed by the truck.
  if (
    entityType === "vehicle_class_assignments" ||
    entityType === "vehicle_odometer_overrides" ||
    entityType === "battery_layouts"
  ) {
    const n = Number(entityId);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}
