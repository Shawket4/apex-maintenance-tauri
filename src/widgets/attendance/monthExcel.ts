import type { TFunction } from "i18next";

import type { AttendanceMonthView, ExcelExportConfig } from "@/shared/api/client";

import { kindCode, monthTitle } from "./lib";

/** Two sheets: the grid of codes, and the totals per worker. */
export function monthExcel(v: AttendanceMonthView, t: TFunction, lang: string): ExcelExportConfig {
  const title = t("attendance.month.exportTitle", { month: monthTitle(v.month, lang) });
  const isRtl = lang.startsWith("ar");
  return {
    filename: `${t("attendance.month.exportFile")}-${v.month}`,
    meta: null,
    creator: null,
    sheets: [
      {
        name: t("attendance.month.sheetGrid"),
        title,
        subtitle: null,
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
            row[`d${v.days[i].day}`] = c.kind === "unmarked" ? "" : kindCode(c.kind, t);
          });
          return row;
        }),
      },
      {
        name: t("attendance.month.sheetTotals"),
        title,
        subtitle: null,
        isRtl,
        stats: null,
        totals: true,
        columns: [
          { key: "worker", header: t("attendance.month.worker"), type: null, width: 24, total: null },
          { key: "job", header: t("attendance.workers.job"), type: null, width: 18, total: null },
          { key: "present", header: t("attendance.month.present"), type: "number", width: 10, total: true },
          { key: "absent", header: t("attendance.month.absent"), type: "number", width: 10, total: true },
          { key: "leave", header: t("attendance.month.leave"), type: "number", width: 10, total: true },
          { key: "sick", header: t("attendance.month.sick"), type: "number", width: 10, total: true },
          { key: "unmarked", header: t("attendance.month.unmarked"), type: "number", width: 12, total: true },
        ],
        rows: v.workers.map((w) => ({
          worker: w.name,
          job: w.job ?? "",
          present: w.totals.present,
          absent: w.totals.absent,
          leave: w.totals.leave,
          sick: w.totals.sick,
          unmarked: w.totals.unmarked,
        })),
      },
    ],
  };
}
