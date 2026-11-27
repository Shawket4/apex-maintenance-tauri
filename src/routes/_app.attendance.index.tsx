import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useAttendanceDay } from "@/shared/api/queries";
import { todayCairoYmd } from "@/shared/lib/time";
import { QueryState } from "@/shared/ui/query-state";
import { AttendanceTabs } from "@/widgets/attendance/AttendanceTabs";
import { DayRegister } from "@/widgets/attendance/DayRegister";
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

  return (
    <PageShell title={t("attendance.title")} subtitle={t("attendance.subtitle")}>
      <AttendanceTabs />
      <QueryState query={q}>{(v) => <DayRegister v={v} onGoTo={goTo} />}</QueryState>
    </PageShell>
  );
}
