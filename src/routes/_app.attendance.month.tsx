import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileSpreadsheet, Printer } from "lucide-react";

import { commands, unwrap } from "@/shared/api/client";
import type { AttendanceMonthView } from "@/shared/api/client";
import { useAttendanceMonth } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { todayCairoYmd } from "@/shared/lib/time";
import { Button } from "@/shared/ui/button";
import { QueryState } from "@/shared/ui/query-state";
import { AttendanceTabs } from "@/widgets/attendance/AttendanceTabs";
import { MonthBody } from "@/widgets/attendance/MonthBody";
import { monthExcel } from "@/widgets/attendance/monthExcel";
import { PageShell } from "@/widgets/layout/PageShell";
import { canPrint, printPage } from "@/widgets/wo/lib";

type MonthSearch = { m?: string };

export const Route = createFileRoute("/_app/attendance/month")({
  validateSearch: (s: Record<string, unknown>): MonthSearch =>
    typeof s.m === "string" && /^\d{4}-\d{2}$/.test(s.m) ? { m: s.m } : {},
  component: AttendanceMonthPage,
});

/** The month sheet: every worker's days, the totals, Excel and print. */
function AttendanceMonthPage() {
  const { t, i18n } = useTranslation();
  const { m } = Route.useSearch();
  const thisMonth = todayCairoYmd().slice(0, 7);
  const month = m && m <= thisMonth ? m : thisMonth;
  const q = useAttendanceMonth(month);
  const navigate = Route.useNavigate();
  const go = (next: string) => void navigate({ search: next >= thisMonth ? {} : { m: next }, replace: true });

  const exportExcel = useMutation({
    mutationFn: (v: AttendanceMonthView) => unwrap(commands.exportToExcel(monthExcel(v, t, i18n.language))),
    onSuccess: (saved) => saved && notifySuccess(t("attendance.month.exportSaved")),
    onError: notifyError,
  });

  return (
    <PageShell
      width="wide"
      title={t("attendance.title")}
      subtitle={t("attendance.subtitle")}
      actions={
        q.data && q.data.workers.length > 0 ? (
          <>
            <Button variant="outline" onClick={() => exportExcel.mutate(q.data)} disabled={exportExcel.isPending}>
              <FileSpreadsheet />
              {t("attendance.month.export")}
            </Button>
            {canPrint() && (
              <Button variant="outline" onClick={() => void printPage(t("attendance.month.printTitle"))}>
                <Printer />
                {t("attendance.month.print")}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <AttendanceTabs />
      <QueryState query={q}>{(v) => <MonthBody v={v} thisMonth={thisMonth} onGo={go} />}</QueryState>
    </PageShell>
  );
}
