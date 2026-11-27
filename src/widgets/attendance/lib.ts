// Garage attendance: display helpers. The rule itself (late, hours, what a
// day counts as) is computed in Rust (services/views/attendance.rs); this file
// only turns its answers into colors and text.
import type { TFunction } from "i18next";

import type { AttendanceMonthCell } from "@/shared/api/client";

import { fmtNumber } from "@/shared/lib/numbers";
import { CAIRO_TZ, dayjs, fmtCairo } from "@/shared/lib/time";

export const STATUSES = ["present", "absent", "leave", "sick", "off"] as const;
export type Status = (typeof STATUSES)[number];

/** Soft fill + deep text, per day kind (the status tokens in index.css). */
export const KIND_TONE: Record<string, string> = {
  present: "bg-status-ok-soft text-status-ok",
  late: "bg-status-due_soon-soft text-status-due_soon",
  absent: "bg-status-overdue-soft text-status-overdue",
  leave: "bg-info-soft text-info",
  sick: "bg-violet-soft text-violet",
  off: "bg-status-never_done-soft text-status-never_done",
  weekly_off: "bg-muted text-muted-foreground",
  unmarked: "border border-dashed border-border-strong text-muted-foreground",
  outside: "",
  future: "",
};

/** A solid swatch for status pickers and the legend. */
export const KIND_SOLID: Record<string, string> = {
  present: "bg-status-ok text-white",
  late: "bg-status-due_soon text-white",
  absent: "bg-status-overdue text-white",
  leave: "bg-info text-white",
  sick: "bg-violet text-white",
  off: "bg-status-never_done text-white",
};

/** The short code of a day kind ("ح", "P"…); empty for days that show nothing. */
export function kindCode(kind: string, t: TFunction): string {
  if (kind === "outside" || kind === "future") return "";
  return t(`attendance.code.${kind}`);
}

/** Cairo time of day, "8:05 ص". */
export function timeOf(iso: string | null | undefined, lang: string): string {
  return fmtCairo(iso, "h:mm A", lang);
}

/** Cairo time of day for a time input, "08:05". */
export function hhmmOf(iso: string | null | undefined): string {
  if (!iso) return "";
  return dayjs.utc(iso).tz(CAIRO_TZ).format("HH:mm");
}

/** The UTC instant of a Cairo wall-clock time on a day (summer time included). */
export function cairoInstant(date: string, hhmm: string): string {
  return dayjs.tz(`${date}T${hhmm}:00`, CAIRO_TZ).utc().toISOString();
}

export function addDays(date: string, n: number): string {
  return dayjs(date).add(n, "day").format("YYYY-MM-DD");
}

export function addMonths(month: string, n: number): string {
  return dayjs(`${month}-01`).add(n, "month").format("YYYY-MM");
}

/** "الخميس ٢٧ نوفمبر ٢٠٢٦". */
export function dayTitle(date: string, lang: string): string {
  return dayjs(date).locale(lang.startsWith("ar") ? "ar" : "en").format("dddd D MMMM YYYY");
}

/** "نوفمبر ٢٠٢٦". */
export function monthTitle(month: string, lang: string): string {
  return dayjs(`${month}-01`).locale(lang.startsWith("ar") ? "ar" : "en").format("MMMM YYYY");
}

/** "8 س 15 د" / "8h 15m". */
export function fmtDuration(minutes: number | null | undefined, t: TFunction, lang: string): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const n = (v: number) => fmtNumber(v, lang);
  if (h === 0) return t("attendance.duration.m", { m: n(m) });
  if (m === 0) return t("attendance.duration.h", { h: n(h) });
  return t("attendance.duration.hm", { h: n(h), m: n(m) });
}

/** Hours with one decimal, for totals and Excel. */
export function hoursOf(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

/** Saturday-first weekday index (0 = Saturday … 6 = Friday) of an ISO weekday. */
export function satFirst(isoWeekday: number): number {
  return (isoWeekday + 1) % 7;
}

export const WEEKDAYS_SAT_FIRST = [6, 7, 1, 2, 3, 4, 5] as const;

/** Can this square of the month be opened to mark or change the day? */
export const editable = (c: AttendanceMonthCell) => c.kind !== "future";
