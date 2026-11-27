import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CalendarDays, CalendarRange, Users } from "lucide-react";

/** The three attendance screens, as one segmented control under the title. */
export function AttendanceTabs() {
  const { t } = useTranslation();
  const tab = "flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold text-muted-foreground transition hover:text-foreground sm:flex-none sm:px-4 [&.active]:bg-card [&.active]:text-foreground [&.active]:shadow-sm";
  return (
    <nav aria-label={t("attendance.tabs.label")} className="flex w-full gap-1 rounded-lg bg-muted p-1 sm:w-auto print:hidden">
      <Link to="/attendance" activeOptions={{ exact: true, includeSearch: false }} className={tab}>
        <CalendarDays className="h-4 w-4" />
        {t("attendance.tabs.today")}
      </Link>
      <Link to="/attendance/month" activeOptions={{ includeSearch: false }} className={tab}>
        <CalendarRange className="h-4 w-4" />
        {t("attendance.tabs.month")}
      </Link>
      <Link to="/attendance/workers" className={tab}>
        <Users className="h-4 w-4" />
        {t("attendance.tabs.workers")}
      </Link>
    </nav>
  );
}
