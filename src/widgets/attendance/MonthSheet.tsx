import * as React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { AttendanceMonthCell, AttendanceMonthView, AttendanceMonthWorker, AttendanceTotals } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo, nowUtcIso } from "@/shared/lib/time";

import { KIND_TONE, editable, fmtDuration, hoursOf, kindCode, monthTitle, satFirst, timeOf } from "./lib";

export type CellPick = { worker: AttendanceMonthWorker; index: number };

function cellTitle(c: AttendanceMonthCell, date: string, t: TFunction, lang: string): string {
  const parts = [fmtCairo(`${date}T12:00:00Z`, "dddd D MMMM", lang), t(`attendance.status.${c.kind}`)];
  if (c.check_in_at) parts.push(t("attendance.day.inAt", { time: timeOf(c.check_in_at, lang) }));
  if (c.check_out_at) parts.push(t("attendance.day.outAt", { time: timeOf(c.check_out_at, lang) }));
  if (c.late_minutes > 0) parts.push(t("attendance.day.lateBy", { d: fmtDuration(c.late_minutes, t, lang) }));
  if (c.note) parts.push(c.note);
  return parts.join(" · ");
}

const TOTAL_COLS: { key: keyof AttendanceTotals; label: string; tone?: string }[] = [
  { key: "present", label: "attendance.month.present", tone: "text-status-ok" },
  { key: "late", label: "attendance.month.late", tone: "text-status-due_soon" },
  { key: "absent", label: "attendance.month.absent", tone: "text-status-overdue" },
  { key: "leave", label: "attendance.month.leave", tone: "text-info" },
  { key: "sick", label: "attendance.month.sick", tone: "text-violet" },
  { key: "off", label: "attendance.month.off" },
  { key: "unmarked", label: "attendance.month.unmarked" },
];

/** What the screen grid shows next to each name (the rest is in Excel and on paper). */
const SCREEN_TOTALS: { key: keyof AttendanceTotals; label: string; tone: string }[] = [
  { key: "present", label: "attendance.month.present", tone: "text-status-ok" },
  { key: "late", label: "attendance.month.late", tone: "text-status-due_soon" },
  { key: "absent", label: "attendance.month.absent", tone: "text-status-overdue" },
];

/** The month as a grid: workers down, days across. The name and the month's
 * totals stay put while the days scroll; the grid opens on today. */
export function MonthGrid({ v, onPick }: { v: AttendanceMonthView; onPick: (p: CellPick) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const n = (x: number) => fmtNumber(x, lang);
  const scroller = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>("[data-today]");
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [v.month]);
  const fixed = "sticky z-10 bg-card";
  return (
    <div ref={scroller} className="overflow-x-auto rounded-xl border bg-card shadow-sm">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th scope="col" className={cn(fixed, "start-0 z-20 w-40 min-w-40 border-b px-3 py-2 text-start font-bold")}>
              {t("attendance.month.worker")}
            </th>
            {SCREEN_TOTALS.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                style={{ insetInlineStart: `${10 + i * 3}rem` }}
                className={cn(fixed, "z-20 w-12 min-w-12 border-b px-1 py-2 text-center font-semibold")}
              >
                {t(c.label)}
              </th>
            ))}
            <th
              scope="col"
              style={{ insetInlineStart: "19rem" }}
              className={cn(fixed, "z-20 w-20 min-w-20 border-b border-e-2 px-1 py-2 text-center font-semibold")}
            >
              {t("attendance.month.hours")}
            </th>
            {v.days.map((d) => (
              <th
                key={d.date}
                scope="col"
                data-today={d.is_today || undefined}
                className={cn(
                  "min-w-8 border-b px-0.5 py-1.5 text-center font-semibold tabular",
                  d.is_weekly_off && "bg-muted/60",
                  d.is_today && "text-primary",
                )}
              >
                <div className="text-[10px] font-normal text-muted-foreground">{t(`attendance.weekdayShort.${d.weekday}`)}</div>
                {n(d.day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {v.workers.map((w) => (
            <tr key={w.worker_id}>
              <th scope="row" className={cn(fixed, "start-0 w-40 min-w-40 border-b px-3 py-1.5 text-start font-semibold")}>
                <div className="max-w-36 truncate text-sm">{w.name}</div>
                {w.job && <div className="max-w-36 truncate text-[11px] font-normal text-muted-foreground">{w.job}</div>}
              </th>
              {SCREEN_TOTALS.map((col, i) => (
                <td
                  key={col.key}
                  style={{ insetInlineStart: `${10 + i * 3}rem` }}
                  className={cn(fixed, "border-b px-1 text-center text-sm font-bold tabular", w.totals[col.key] > 0 ? col.tone : "text-muted-foreground/50")}
                >
                  {w.totals[col.key] > 0 ? n(w.totals[col.key]) : "—"}
                </td>
              ))}
              <td
                style={{ insetInlineStart: "19rem" }}
                className={cn(fixed, "border-b border-e-2 px-1 text-center font-semibold whitespace-nowrap tabular")}
              >
                {w.totals.worked_minutes > 0 ? fmtDuration(w.totals.worked_minutes, t, lang) : "—"}
              </td>
              {w.cells.map((c, i) => {
                const d = v.days[i];
                const code = kindCode(c.kind, t);
                return (
                  <td key={d.date} className={cn("border-b p-0.5 text-center", d.is_weekly_off && "bg-muted/40")}>
                    {editable(c) ? (
                      <button
                        type="button"
                        onClick={() => onPick({ worker: w, index: i })}
                        title={cellTitle(c, d.date, t, lang)}
                        aria-label={`${w.name} — ${cellTitle(c, d.date, t, lang)}`}
                        className={cn(
                          "grid h-8 w-full min-w-7 place-items-center rounded-md text-xs font-bold transition hover:ring-2 hover:ring-primary/40",
                          c.kind === "outside" ? "text-muted-foreground/40" : KIND_TONE[c.kind],
                          c.pending && "ring-1 ring-primary/50",
                          d.is_today && "ring-2 ring-primary/60",
                        )}
                      >
                        {code}
                      </button>
                    ) : (
                      <span className="block h-8" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={cn(fixed, "start-0 px-3 py-2 text-start font-bold")}>
              {t("attendance.month.total")}
            </th>
            {SCREEN_TOTALS.map((col, i) => (
              <td key={col.key} style={{ insetInlineStart: `${10 + i * 3}rem` }} className={cn(fixed, "px-1 py-2 text-center text-sm font-bold tabular")}>
                {n(v.totals[col.key])}
              </td>
            ))}
            <td style={{ insetInlineStart: "19rem" }} className={cn(fixed, "border-e-2 px-1 py-2 text-center font-bold whitespace-nowrap tabular")}>
              {fmtDuration(v.totals.worked_minutes, t, lang)}
            </td>
            <td colSpan={v.days.length} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** On a phone: one card per worker — the totals, then the month as a small
 * calendar (weeks start on Saturday). */
export function MonthCards({ v, onPick }: { v: AttendanceMonthView; onPick: (p: CellPick) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const n = (x: number) => fmtNumber(x, lang);
  const lead = v.days.length > 0 ? satFirst(v.days[0].weekday) : 0;
  return (
    <div className="space-y-3">
      {v.workers.map((w) => (
        <section key={w.worker_id} className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="min-w-0 truncate font-bold">{w.name}</h3>
            <span className="flex-none text-xs text-muted-foreground tabular">
              {w.totals.worked_minutes > 0 ? fmtDuration(w.totals.worked_minutes, t, lang) : ""}
            </span>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {TOTAL_COLS.filter((c) => w.totals[c.key] > 0).map((c) => (
              <span key={c.key} className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular", KIND_TONE[c.key])}>
                {n(w.totals[c.key])} {t(c.label)}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1" role="grid">
            {[6, 7, 1, 2, 3, 4, 5].map((wd) => (
              <div key={wd} className="text-center text-[10px] text-muted-foreground" role="columnheader">
                {t(`attendance.weekdayShort.${wd}`)}
              </div>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {w.cells.map((c, i) => {
              const d = v.days[i];
              return editable(c) ? (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => onPick({ worker: w, index: i })}
                  aria-label={`${w.name} — ${cellTitle(c, d.date, t, lang)}`}
                  className={cn(
                    "relative grid aspect-square place-items-center rounded-md text-xs font-bold",
                    c.kind === "outside" ? "text-muted-foreground/40" : KIND_TONE[c.kind],
                    d.is_today && "ring-2 ring-primary",
                  )}
                >
                  <span className="absolute start-1 top-0.5 text-[9px] font-normal opacity-70">{n(d.day)}</span>
                  <span className="mt-1.5">{kindCode(c.kind, t)}</span>
                </button>
              ) : (
                <div key={d.date} className="grid aspect-square place-items-center rounded-md text-[9px] text-muted-foreground/50">
                  {n(d.day)}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The key under the sheet. */
export function MonthLegend() {
  const { t } = useTranslation();
  const kinds = ["present", "late", "absent", "leave", "sick", "off", "weekly_off", "unmarked"];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label={t("attendance.month.legend")}>
      {kinds.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className={cn("grid h-6 w-6 place-items-center rounded text-[11px] font-bold", KIND_TONE[k])}>{kindCode(k, t)}</span>
          {t(`attendance.status.${k}`)}
        </span>
      ))}
    </div>
  );
}

/** The month on paper: A4 landscape, codes in black, totals at the end. */
export function MonthPrintSheet({ v }: { v: AttendanceMonthView }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const n = (x: number) => fmtNumber(x, lang);
  const s = v.settings;
  return (
    <div data-print="sheet" className="hidden print:block">
      <style>{"@media print { @page { size: A4 landscape; margin: 10mm; } }"}</style>
      <header className="mb-3 flex items-end justify-between gap-4 border-b-2 border-black pb-2">
        <div>
          <div className="text-lg font-bold">{t("attendance.month.printTitle")}</div>
          <div>{monthTitle(v.month, lang)}</div>
        </div>
        <div className="text-end text-[9pt]">
          <div>
            {t("attendance.month.exportSubtitle", { start: s.work_start, end: s.work_end, grace: n(s.late_grace_minutes) })}
          </div>
          <div>{t("attendance.month.printed", { date: fmtCairo(nowUtcIso(), "YYYY/MM/DD HH:mm", lang) })}</div>
        </div>
      </header>
      <table className="w-full border-collapse text-[8pt]">
        <thead>
          <tr>
            <th className="border border-black px-1 py-0.5 text-start">{t("attendance.month.worker")}</th>
            {v.days.map((d) => (
              <th key={d.date} className="border border-black px-0 py-0.5 text-center font-semibold">
                {n(d.day)}
              </th>
            ))}
            {TOTAL_COLS.slice(0, 6).map((c) => (
              <th key={c.key} className="border border-black px-1 py-0.5 text-center">
                {t(c.label)}
              </th>
            ))}
            <th className="border border-black px-1 py-0.5 text-center">{t("attendance.month.hours")}</th>
          </tr>
        </thead>
        <tbody>
          {v.workers.map((w) => (
            <tr key={w.worker_id} data-print="row">
              <td className="border border-black px-1 py-0.5 font-semibold whitespace-nowrap">{w.name}</td>
              {w.cells.map((c, i) => (
                <td
                  key={v.days[i].date}
                  className={cn("border border-black p-0 text-center", v.days[i].is_weekly_off && "bg-[#eee]")}
                >
                  {c.kind === "weekly_off" || c.kind === "unmarked" ? "" : kindCode(c.kind, t)}
                </td>
              ))}
              {TOTAL_COLS.slice(0, 6).map((col) => (
                <td key={col.key} className="border border-black px-1 text-center tabular">
                  {n(w.totals[col.key])}
                </td>
              ))}
              <td className="border border-black px-1 text-center tabular whitespace-nowrap">
                {n(hoursOf(w.totals.worked_minutes))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[8pt]">
        {["present", "late", "absent", "leave", "sick", "off"].map((k) => `${kindCode(k, t)} = ${t(`attendance.status.${k}`)}`).join("   ")}
      </p>
    </div>
  );
}
