import * as React from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { AttendanceMonthView } from "@/shared/api/client";
import { fmtNumber } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/widgets/layout/PageShell";

import { DayDialog, type DayTarget } from "./DayDialog";
import { addMonths, monthTitle } from "./lib";
import { MonthCards, MonthGrid, MonthLegend, MonthPrintSheet, type CellPick } from "./MonthSheet";

/** The month: its bar, the grid (or cards on a phone), the key, the paper sheet. */
export function MonthBody({ v, thisMonth, onGo }: { v: AttendanceMonthView; thisMonth: string; onGo: (month: string) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [target, setTarget] = React.useState<DayTarget | null>(null);
  const go = onGo;

  const pick = ({ worker, index }: CellPick) => {
    const c = worker.cells[index];
    const known = c.kind !== "unmarked" && c.kind !== "weekly_off" && c.kind !== "outside";
    setTarget({
      workerId: worker.worker_id,
      name: worker.name,
      job: worker.job,
      date: v.days[index].date,
      status: known ? (c.kind === "late" ? "present" : c.kind) : null,
      checkInAt: c.check_in_at,
      checkOutAt: c.check_out_at,
      note: c.note,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 rounded-xl border bg-card p-2 shadow-sm print:hidden">
        <Button variant="ghost" size="icon" aria-label={t("attendance.month.prev")} title={t("attendance.month.prev")} onClick={() => go(addMonths(v.month, -1))}>
          <ChevronLeft className="rtl:-scale-x-100" />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-center text-base font-bold">{monthTitle(v.month, lang)}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("attendance.month.next")}
          title={t("attendance.month.next")}
          onClick={() => go(addMonths(v.month, 1))}
          disabled={v.is_current}
        >
          <ChevronRight className="rtl:-scale-x-100" />
        </Button>
        {!v.is_current && (
          <Button variant="outline" onClick={() => go(thisMonth)}>
            {t("attendance.month.thisMonth")}
          </Button>
        )}
      </div>

      {v.workers.length === 0 ? (
        <EmptyState className="print:hidden">{t("attendance.month.empty")}</EmptyState>
      ) : (
        <div className="space-y-4 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("attendance.month.cellHint")}</span>
            {v.totals.unmarked > 0 && (
              <span className="font-semibold text-status-due_soon">
                {t("attendance.month.unmarkedHint", { n: fmtNumber(v.totals.unmarked, lang) })}
              </span>
            )}
          </div>
          <div className="hidden md:block">
            <MonthGrid v={v} onPick={pick} />
          </div>
          <div className="md:hidden">
            <MonthCards v={v} onPick={pick} />
          </div>
          <MonthLegend />
        </div>
      )}

      {v.workers.length > 0 && <MonthPrintSheet v={v} />}
      <DayDialog target={target} settings={v.settings} onOpenChange={(o) => !o && setTarget(null)} />
    </div>
  );
}
