// Words for a due row: how much is left / how late, when it was last done,
// and how often the plan repeats. Pure functions so every screen says it the
// same way.
import type { TFunction } from "i18next";

import type { DueRow } from "@/shared/api/client";
import { fmtKm, fmtNumber, toAsciiDigits } from "@/shared/lib/numbers";
import { DUE_BADGE, DUE_DOT } from "@/shared/lib/status";
import { fmtCairo } from "@/shared/lib/time";

export type DuePart = { text: string; tone: "late" | "left" | "now" };

/** "يوم واحد / يومين / ٥ أيام / ١٢ يوم" — the noun is picked here so no
 * string ever shows a wrong plural. */
export function daysText(n: number, t: TFunction, lang: string): string {
  const abs = Math.abs(n);
  const form = abs === 1 ? "one" : abs === 2 ? "two" : abs <= 10 ? "few" : "many";
  return t(`due.days.${form}`, { n: fmtNumber(abs, lang) });
}

/** What is left before the job is due, or how late it is. One entry per clock
 * (km, days); empty when neither clock can be read. */
export function remainingParts(row: DueRow, t: TFunction, lang: string): DuePart[] {
  const parts: DuePart[] = [];
  if (row.km_remaining != null) {
    const km = fmtKm(Math.abs(row.km_remaining), lang);
    if (row.km_remaining < 0) parts.push({ text: t("due.late", { amount: km }), tone: "late" });
    else if (row.km_remaining === 0) parts.push({ text: t("due.kmNow"), tone: "now" });
    else parts.push({ text: t("due.left", { amount: km }), tone: "left" });
  }
  if (row.days_remaining != null) {
    const days = daysText(row.days_remaining, t, lang);
    if (row.days_remaining < 0) parts.push({ text: t("due.late", { amount: days }), tone: "late" });
    else if (row.days_remaining === 0) parts.push({ text: t("due.today"), tone: "now" });
    else parts.push({ text: t("due.left", { amount: days }), tone: "left" });
  }
  return parts;
}

/** "كل ١٠٬٠٠٠ كم أو ١٨٠ يوم". */
export function intervalText(row: DueRow, t: TFunction, lang: string): string | null {
  const parts: string[] = [];
  if (row.interval_km != null) parts.push(fmtKm(row.interval_km, lang));
  if (row.interval_days != null) parts.push(daysText(row.interval_days, t, lang));
  if (parts.length === 0) return null;
  return t("due.every", { what: parts.join(t("due.or")) });
}

/** "آخر مرة: ٢٠٢٦/٠٥/٠١ · ١١٠٬٠٠٠ كم". */
export function lastDoneText(row: DueRow, t: TFunction, lang: string): string | null {
  if (row.last_at == null && row.last_km == null) return null;
  const parts: string[] = [];
  if (row.last_at != null) parts.push(fmtCairo(row.last_at, "YYYY/MM/DD", lang));
  if (row.last_km != null) parts.push(fmtKm(row.last_km, lang));
  return t("due.lastDoneAt", { when: parts.join(" · ") });
}

/** "الميعاد الجاي: عند ١٢٠٬٠٠٠ كم · يوم ٢٠٢٦/١١/٠١". */
export function nextDueText(row: DueRow, t: TFunction, lang: string): string | null {
  const parts: string[] = [];
  if (row.next_due_km != null) parts.push(t("due.nextAtKm", { km: fmtKm(row.next_due_km, lang) }));
  if (row.next_due_at != null) {
    parts.push(t("due.nextOnDate", { date: fmtCairo(row.next_due_at, "YYYY/MM/DD", lang) }));
  }
  if (parts.length === 0) return null;
  return t("due.nextDue", { when: parts.join(" · ") });
}

/** Text typed in a search box → a form that matches a plate however it was
 * typed: Arabic or Latin digits, with or without spaces, any alef/yeh form. */
export function foldPlate(s: string): string {
  return toAsciiDigits(s)
    .replace(/[\sـ\-_.]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase();
}

/** Statuses that need someone to do something. */
export const ATTENTION = ["overdue", "never_done", "due_soon", "unknown"] as const;
export const needsAttention = (status: string) => (ATTENTION as readonly string[]).includes(status);

/** Status → colour classes. `unknown` (no odometer reading) has no token of
 * its own: it is shown neutral, never green. */
export const dueBadge = (status: string) => DUE_BADGE[status] ?? "bg-muted text-muted-foreground";
export const dueDot = (status: string) => DUE_DOT[status] ?? "bg-muted-foreground/50";
