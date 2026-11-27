import type { TFunction } from "i18next";

import type { AttendanceMonthView, ExcelExportConfig } from "@/shared/api/client";

import { hoursOf, kindCode, monthTitle } from "./lib";

/** Two sheets: the grid of codes, and the totals per worker. */
export function monthExcel(v: AttendanceMonthView, t: TFunction, lang: string): ExcelExportConfig {
  const s = v.settings;
  const title = t("attendance.month.exportTitle", { month: monthTitle(v.month, lang) });
  const subtitle = t("attendance.month.exportSubtitle", { start: s.work_start, end: s.work_end, grace: String(s.late_grace_minutes) });
  const isRtl = lang.startsWith("ar");
  return {
    filename: `${t("attendance.month.exportFile")}-${v.month}`,
    meta: null,
    creator: null,
    sheets: [
      {
        name: t("attendance.month.sheetGrid"),
        title,
        subtitle,
        isRtl,
        stats: null,
        totals: null,
        columns: [
          { key: "worker", header: t("attendance.month.worker"), type: null, width: 24, total: null },
          ...v.days.map((d) => ({ key: `d${d.day}`, header: String(d.day), type: null, width: 4, total: null })),
          { key: "present", header: t("attendance.month.present"), type: "number", width: 9, total: null },
          { key: "absent", header: t("attendance.month.absent"), type: "number", width: 9, total: null },
        ],
        rows: v.workers.map((w) => {
          const row: Record<string, string | number> = { worker: w.name, present: w.totals.present, absent: w.totals.absent };
          w.cells.forEach((c, i) => {
            row[`d${v.days[i].day}`] = c.kind === "weekly_off" || c.kind === "unmarked" ? "" : kindCode(c.kind, t);
          });
          return row;
        }),
      },
      {
        name: t("attendance.month.sheetTotals"),
        title,
        subtitle,
        isRtl,
        stats: null,
        totals: true,
        columns: [
          { key: "worker", header: t("attendance.month.worker"), type: null, width: 24, total: null },
          { key: "job", header: t("attendance.workers.job"), type: null, width: 18, total: null },
          { key: "present", header: t("attendance.month.present"), type: "number", width: 10, total: true },
          { key: "late", header: t("attendance.month.late"), type: "number", width: 10, total: true },
          { key: "late_minutes", header: t("attendance.month.lateMinutes"), type: "number", width: 14, total: true },
          { key: "absent", header: t("attendance.month.absent"), type: "number", width: 10, total: true },
          { key: "leave", header: t("attendance.month.leave"), type: "number", width: 10, total: true },
          { key: "sick", header: t("attendance.month.sick"), type: "number", width: 10, total: true },
          { key: "off", header: t("attendance.month.off"), type: "number", width: 10, total: true },
          { key: "unmarked", header: t("attendance.month.unmarked"), type: "number", width: 12, total: true },
          { key: "hours", header: t("attendance.month.hours"), type: "decimal", width: 14, total: true },
          { key: "extra", header: t("attendance.month.extra"), type: "decimal", width: 14, total: true },
        ],
        rows: v.workers.map((w) => ({
          worker: w.name,
          job: w.job ?? "",
          present: w.totals.present,
          late: w.totals.late,
          late_minutes: w.totals.late_minutes,
          absent: w.totals.absent,
          leave: w.totals.leave,
          sick: w.totals.sick,
          off: w.totals.off,
          unmarked: w.totals.unmarked,
          hours: hoursOf(w.totals.worked_minutes),
          extra: hoursOf(w.totals.extra_minutes),
        })),
      },
    ],
  };
}
