import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useDue } from "@/shared/api/queries";
import { fmtNumber } from "@/shared/lib/numbers";
import { DUE_BADGE } from "@/shared/lib/status";
import { cn } from "@/shared/lib/cn";
import { DueList } from "@/widgets/due/DueList";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";

export const Route = createFileRoute("/_app/due")({
  component: DueBoard,
});

/** Fleet board: rows are already urgency-sorted by the Rust view; every row
 * leads to the truck (where opening a WO takes one click). */
function DueBoard() {
  const { t, i18n } = useTranslation();
  const due = useDue();

  if (due.isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 p-6">
        <Skeleton className="h-8 w-36" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  const rows = due.data ?? [];
  const counts = {
    overdue: rows.filter((r) => r.status === "overdue").length,
    never_done: rows.filter((r) => r.status === "never_done").length,
    due_soon: rows.filter((r) => r.status === "due_soon").length,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t("due.title")}</h1>
        {(["overdue", "never_done", "due_soon"] as const).map((s) => (
          <span key={s} className={cn("rounded-full px-2.5 py-1 text-xs tabular", DUE_BADGE[s])}>
            {fmtNumber(counts[s], i18n.language)} {t(`due.status.${s}`)}
          </span>
        ))}
      </div>

      <DueList
        rows={rows}
        showPlate
        emptyText={t("due.empty")}
        action={(row) => (
          <Link to="/trucks/$truckId" params={{ truckId: String(row.vehicle_id) }}>
            <Button size="sm" variant="outline">
              {t("due.openWo")}
            </Button>
          </Link>
        )}
      />
    </div>
  );
}
