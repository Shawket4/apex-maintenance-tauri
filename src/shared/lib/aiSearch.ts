import type { AiSearchResult, HistoryHit } from "@/shared/api/bindings";
import { fmtCairo } from "./time";
import { fmtKm, fmtNumber } from "./numbers";

/**
 * View helpers for the AI search box (`commands.aiSearch`). Routing and the
 * advisor → /ai/query fallback live in Rust (services::history_search).
 */

/** The meta line under a hit: date · km, skipping whatever is missing. */
export function hitMeta(hit: HistoryHit, locale: string): string {
  const parts: string[] = [];
  if (hit.date) parts.push(fmtCairo(hit.date, "YYYY/MM/DD", locale));
  if (hit.meter_reading != null) parts.push(fmtKm(hit.meter_reading, locale));
  return parts.join(" · ");
}

/** Stable React key: the service line, else the invoice. */
export function hitKey(hit: HistoryHit, index: number): string {
  return hit.item_id != null ? `i${hit.item_id}` : `v${hit.invoice_id}-${index}`;
}

/** The i18n key of the notice above a fallback answer, if any. */
export function fallbackNoticeKey(r: AiSearchResult): string | null {
  if (r.source !== "ai_query") return null;
  if (r.fallback === "advisor_error") return "ai.advisorDown";
  if (r.fallback === "no_hits") return "ai.noHitsFellBack";
  return null;
}

/** A record number (an invoice id): digits in the UI script, never grouped
 * ("١٢٠١", not "١٬٢٠١"). */
export function fmtId(id: number | string, locale: string): string {
  const s = String(id);
  return locale.startsWith("ar") ? s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]) : s;
}

// ── which questions need the supervisor-only endpoint ────────────────────────

/** MUST mirror `QUESTION_MARKERS` in src-tauri services/history_search.rs:
 * a question with one of these goes to `/ai/query` (permission 3+) only.
 * A trailing `*` is a prefix match; otherwise the word must match exactly. */
const QUESTION_MARKERS: string[][] = [
  ["كام"],
  ["عدد"],
  ["اكتر"],
  ["اكثر"],
  ["اقل"],
  ["متوسط*"],
  ["اجمالي*"],
  ["مجموع*"],
  ["تكلف*"],
  ["مصاريف"],
  ["قارن*"],
  ["ترتيب"],
  ["انهي", "عربي*"],
  ["اي", "عربي*"],
  ["how", "many"],
  ["how", "much"],
  ["most"],
  ["least"],
  ["average"],
  ["avg"],
  ["total"],
  ["count"],
  ["sum"],
  ["which", "truck*"],
  ["which", "vehicle*"],
  ["which", "car*"],
  ["cost*"],
  ["spent"],
  ["spend*"],
  ["compare"],
  ["top"],
  ["rank*"],
];

const AR_PREFIXES = ["وال", "بال", "فال", "لل", "ال", "و", "ب", "ف"];

function normalise(q: string): string {
  return q
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\u0640|[\u064B-\u0652]/g, "")
    .toLowerCase();
}

function wordMatches(token: string, pattern: string): boolean {
  const forms = [token];
  for (const p of AR_PREFIXES) {
    if (token.startsWith(p) && token.length > p.length) forms.push(token.slice(p.length));
  }
  if (pattern.endsWith("*")) {
    const stem = pattern.slice(0, -1);
    return forms.some((f) => f.startsWith(stem));
  }
  return forms.some((f) => f === pattern);
}

/** True for counting / totals / ranking questions ("كام مرة…", "أنهي عربية
 * أكتر…"): the Rust router sends these to the endpoint that needs
 * permission 3 or more. Used to explain instead of failing with a 403. */
export function isAggregateQuestion(query: string): boolean {
  const words = normalise(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return QUESTION_MARKERS.some((m) => {
    for (let i = 0; i + m.length <= words.length; i++) {
      if (m.every((p, j) => wordMatches(words[i + j], p))) return true;
    }
    return false;
  });
}

// ── the free-form answer table ───────────────────────────────────────────────

/** SQL column → the i18n key of its human label (under `ai.col.*`). */
const COLUMN_KEYS: Record<string, string> = {
  plate_number: "plate",
  plate: "plate",
  car_no_plate: "plate",
  date: "date",
  invoice_date: "date",
  service_date: "date",
  last_date: "lastDate",
  last_service_date: "lastDate",
  latest_date: "lastDate",
  max_date: "lastDate",
  first_date: "firstDate",
  min_date: "firstDate",
  service: "service",
  services: "service",
  notes: "notes",
  note: "notes",
  meter_reading: "odometer",
  odometer: "odometer",
  last_meter_reading: "odometer",
  driver_name: "driver",
  driver: "driver",
  supervisor: "supervisor",
  operating_region: "region",
  region: "region",
  count: "count",
  cnt: "count",
  n: "count",
  num: "count",
  times: "count",
  total: "total",
  sum: "total",
  total_count: "total",
  avg: "average",
  average: "average",
  month: "month",
  year: "year",
  car_type: "truckType",
  transporter: "transporter",
};

/** Columns that are database plumbing, never shown. */
function isHiddenColumn(col: string): boolean {
  const c = col.toLowerCase();
  return c === "id" || c.endsWith("_id") || c === "score" || c === "embedding" || c === "item_order";
}

/** The i18n key for a column's header, or null when the column is unknown
 * (the caller then shows the name with its underscores opened up). */
export function columnLabelKey(col: string): string | null {
  const c = col.toLowerCase();
  const known = COLUMN_KEYS[c];
  if (known) return `ai.col.${known}`;
  if (c.endsWith("_count") || c.startsWith("count_") || c.startsWith("num_")) return "ai.col.count";
  if (c.startsWith("total_") || c.startsWith("sum_")) return "ai.col.total";
  if (c.startsWith("avg_") || c.startsWith("average_")) return "ai.col.average";
  if (c.endsWith("_date") || c.endsWith("_at")) return "ai.col.date";
  return null;
}

/** An unknown column name made readable ("tire_changes" → "tire changes"). */
export function plainColumnName(col: string): string {
  return col.replace(/_+/g, " ").trim();
}

/** The columns worth showing, in first-seen order, ids left out. */
export function visibleColumns(rows: Record<string, unknown>[]): string[] {
  const seen: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!isHiddenColumn(k) && !seen.includes(k)) seen.push(k);
    }
  }
  return seen;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** One cell as a person reads it: dates in Cairo time, numbers in the UI
 * digits, yes/no for booleans. Never JSON. */
export function formatCell(
  col: string,
  value: unknown,
  locale: string,
  words: { yes: string; no: string },
): string {
  if (value == null || value === "") return "—";
  const c = col.toLowerCase();
  const key = columnLabelKey(col);
  if (typeof value === "boolean") return value ? words.yes : words.no;
  if (typeof value === "number") {
    if (key === "ai.col.odometer") return fmtKm(value, locale);
    if (key === "ai.col.year") return fmtId(value, locale);
    return fmtNumber(Math.round(value * 100) / 100, locale);
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (ISO_DATE.test(s)) {
      // A bare date has no time zone to convert; a timestamp is shown in Cairo.
      return s.length === 10 ? fmtCairo(`${s}T12:00:00Z`, "YYYY/MM/DD", locale) : fmtCairo(s, "YYYY/MM/DD", locale);
    }
    // Postgres sends bigint/numeric as text. Plates and names stay as typed.
    if (PLAIN_NUMBER.test(s) && key !== "ai.col.plate" && key !== null && c !== "notes") {
      return formatCell(col, Number(s), locale, words);
    }
    return s;
  }
  if (Array.isArray(value)) {
    const parts = value.filter((v) => v != null && typeof v !== "object").map((v) => String(v));
    return parts.length > 0 ? parts.join(locale.startsWith("ar") ? "، " : ", ") : "—";
  }
  return "—";
}
