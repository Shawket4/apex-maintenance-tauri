import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";

import { useAttendanceDay } from "@/shared/api/queries";
import { todayCairoYmd } from "@/shared/lib/time";
import { Button } from "@/shared/ui/button";
import { QueryState } from "@/shared/ui/query-state";
import { AttendanceTabs } from "@/widgets/attendance/AttendanceTabs";
import { DayRegister } from "@/widgets/attendance/DayRegister";
import { HoursDialog } from "@/widgets/attendance/HoursDialog";
import { PageShell } from "@/widgets/layout/PageShell";

type DaySearch = { date?: string };

export const Route = createFileRoute("/_app/attendance/")({
  validateSearch: (s: Record<string, unknown>): DaySearch =>
    typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? { date: s.date } : {},
  component: AttendanceDayPage,
});

/** The day register: one row per worker, marked with one tap. */
function AttendanceDayPage() {
  const { t } = useTranslation();
  const { date } = Route.useSearch();
  const today = todayCairoYmd();
  const day = date && date < today ? date : today;
  const q = useAttendanceDay(day);
  const navigate = Route.useNavigate();
  const goTo = (d: string) => void navigate({ search: d >= today ? {} : { date: d }, replace: true });
  const [hoursOpen, setHoursOpen] = React.useState(false);

  return (
    <PageShell
      title={t("attendance.title")}
      subtitle={t("attendance.subtitle")}
      actions={
        <Button variant="outline" onClick={() => setHoursOpen(true)} disabled={!q.data}>
          <Clock />
          {t("attendance.hours.button")}
        </Button>
      }
    >
      <AttendanceTabs />
      <QueryState query={q}>{(v) => <DayRegister v={v} onGoTo={goTo} />}</QueryState>
      {q.data && <HoursDialog open={hoursOpen} onOpenChange={setHoursOpen} settings={q.data.settings} />}
    </PageShell>
  );
}
