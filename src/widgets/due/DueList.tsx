import { useTranslation } from "react-i18next";

import type { DueRow } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { DUE_BADGE, DUE_DOT } from "@/shared/lib/status";

/** One due row list, shared by the fleet board, the truck tab and the WO
 * cockpit's suggestion panel. `action` renders the per-row CTA. */
export function DueList({
  rows,
  showPlate = false,
  action,
  emptyText,
}: {
  rows: DueRow[];
  showPlate?: boolean;
  action?: (row: DueRow) => React.ReactNode;
  emptyText: string;
}) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((d) => (
        <div
          key={`${d.vehicle_id}-${d.plan_id}`}
          className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DUE_DOT[d.status])} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {showPlate && <span className="font-semibold">{d.plate}</span>}
                <span className={cn(showPlate ? "text-sm text-muted-foreground" : "font-semibold")}>
                  {ar ? d.category_name_ar : d.category_name_en}
                </span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px]", DUE_BADGE[d.status])}>
                  {t(`due.status.${d.status}`)}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground tabular">
                {d.next_due_km != null &&
                  t("due.nextDueKm", { km: fmtNumber(d.next_due_km, i18n.language) })}
                {d.next_due_at != null &&
                  t("due.nextDueAt", { date: fmtCairo(d.next_due_at, "YYYY/MM/DD", i18n.language) })}
                {d.last_km != null && (
                  <>
                    {" · "}
                    {t("due.lastDone")} {fmtNumber(d.last_km, i18n.language)} {t("common.km")}
                  </>
                )}
              </div>
            </div>
          </div>
          {action?.(d)}
        </div>
      ))}
    </div>
  );
}
