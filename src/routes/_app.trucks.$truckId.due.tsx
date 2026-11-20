import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { DueRow } from "@/shared/api/client";
import { useDue, useTruck } from "@/shared/api/queries";
import { Button } from "@/shared/ui/button";
import { QueryState } from "@/shared/ui/query-state";
import { BaselineDialog } from "@/widgets/due/BaselineDialog";
import { DueList } from "@/widgets/due/DueList";

export const Route = createFileRoute("/_app/trucks/$truckId/due")({
  component: TruckDue,
});

/** Every maintenance plan that applies to this truck, most urgent first,
 * each with "record when it was last done". */
function TruckDue() {
  const { t } = useTranslation();
  const { truckId } = Route.useParams();
  const vid = Number(truckId);
  const due = useDue(vid);
  const truck = useTruck(vid);
  const [baselineFor, setBaselineFor] = useState<DueRow | null>(null);

  // Why the list is empty matters: no class, or a class with no plans.
  const noClass = truck.data != null && !truck.data.class_id;
  const emptyText = noClass ? (
    <div className="space-y-3">
      <p className="font-semibold text-foreground">{t("truck.noClassTitle")}</p>
      <p>{t("truck.noClassBody")}</p>
      <Link
        to="/trucks/$truckId"
        params={{ truckId }}
        hash="class"
        replace
        className="inline-block font-semibold text-primary underline"
      >
        {t("truck.chooseClass")}
      </Link>
    </div>
  ) : (
    t("truck.dueNoPlans")
  );

  return (
    <>
      <QueryState query={due}>
        {(rows) => (
          <DueList
            rows={rows}
            emptyText={emptyText}
            action={(row) => (
              <>
                {row.status === "unknown" && (
                  <Button asChild size="sm">
                    <Link to="/trucks/$truckId" params={{ truckId }} replace>
                      {t("truck.enterOdometer")}
                    </Link>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={row.status === "never_done" ? "default" : "outline"}
                  onClick={() => setBaselineFor(row)}
                >
                  {t("due.baseline")}
                </Button>
              </>
            )}
          />
        )}
      </QueryState>
      {baselineFor && (
        <BaselineDialog
          key={`${baselineFor.vehicle_id}-${baselineFor.plan_id}`}
          row={baselineFor}
          onClose={() => setBaselineFor(null)}
        />
      )}
    </>
  );
}
