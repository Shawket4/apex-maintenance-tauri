import { useTranslation } from "react-i18next";
import { CalendarX, Link2, Pencil, Phone, Trash2 } from "lucide-react";

import type { AttendanceWorkerRow } from "@/shared/api/client";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { PendingBadge } from "@/widgets/wo/parts";

/** One worker on the list: name, job, phone, dates, marked days. */
export function WorkerRow({ w, onEdit, onDelete }: { w: AttendanceWorkerRow; onEdit: () => void; onDelete: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const date = (d: string) => fmtCairo(`${d}T12:00:00Z`, "D MMM YYYY", lang);
  const dates = [
    w.joined_on ? t("attendance.workers.joinedOn", { date: date(w.joined_on) }) : null,
    w.left_on ? t("attendance.workers.leftOn", { date: date(w.left_on) }) : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap sm:px-[18px]">
      <span
        className="grid h-10 w-10 flex-none place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary"
        aria-hidden
      >
        {w.name.trim().charAt(0)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold">{w.name}</span>
          {w.falcon_employee_id != null && (
            <Badge variant="outline" className="gap-1">
              <Link2 className="h-3 w-3" />
              {t("attendance.workers.linked")}
            </Badge>
          )}
          {w.pending && <PendingBadge />}
        </div>
        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {w.job && <span>{w.job}</span>}
          {w.phone && (
            <span className="inline-flex items-center gap-1" dir="ltr">
              <Phone className="h-3 w-3" />
              {w.phone}
            </span>
          )}
          {dates.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <CalendarX className="h-3 w-3" />
              {dates.join(" · ")}
            </span>
          )}
          {w.day_count > 0 && <span>{t("attendance.workers.days", { n: fmtNumber(w.day_count, lang) })}</span>}
        </div>
      </div>
      <div className="flex flex-none gap-1">
        <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`${t("attendance.workers.edit")} ${w.name}`} title={t("attendance.workers.edit")}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete} aria-label={`${t("attendance.workers.delete")} ${w.name}`} title={t("attendance.workers.delete")}>
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

