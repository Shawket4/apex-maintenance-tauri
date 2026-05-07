/**
 * dayjs helpers — every timestamp is stored UTC, rendered Africa/Cairo,
 * Arabic locale by default. Per architecture §12.4.
 */

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import "dayjs/locale/ar";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Africa/Cairo");

export const CAIRO_TZ = "Africa/Cairo";

/** Render an ISO-8601 UTC string in Cairo time, in the active locale. */
export function fmtCairo(iso: string | null | undefined, format = "YYYY/MM/DD HH:mm", locale = "ar") {
  if (!iso) return "—";
  return dayjs.utc(iso).tz(CAIRO_TZ).locale(locale).format(format);
}

/** Today's date in Cairo, YYYY-MM-DD (for `<input type="date">` defaults). */
export function todayCairoYmd(): string {
  return dayjs().tz(CAIRO_TZ).format("YYYY-MM-DD");
}

/** Current ISO-8601 UTC timestamp, millisecond precision, Z suffix. */
export function nowUtcIso(): string {
  return new Date().toISOString();
}

export { dayjs };
