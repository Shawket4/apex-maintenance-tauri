import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { commands, unwrap, type DueRow } from "@/shared/api/client";
import { useDomainMutation, useDue, useTrucks } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { todayCairoYmd } from "@/shared/lib/time";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { fmtNumber } from "@/shared/lib/numbers";
import { DUE_BADGE } from "@/shared/lib/status";
import { cn } from "@/shared/lib/cn";
import { DueList } from "@/widgets/due/DueList";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { PageShell } from "@/widgets/layout/PageShell";

export const Route = createFileRoute("/_app/due")({
  component: DueBoard,
});

/** Fleet board: rows are already urgency-sorted by the Rust view; every row
 * leads to the truck (where opening a WO takes one click). */
function DueBoard() {
  const { t, i18n } = useTranslation();
  const due = useDue();
  const trucks = useTrucks();
  const [baselineFor, setBaselineFor] = useState<DueRow | null>(null);
  const unclassified = (trucks.data ?? []).filter((tr) => !tr.class_id).length;

  if (due.isLoading) {
    return (
      <PageShell>
        <Skeleton className="h-8 w-36" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </PageShell>
    );
  }

  const rows = due.data ?? [];
  const counts = {
    overdue: rows.filter((r) => r.status === "overdue").length,
    never_done: rows.filter((r) => r.status === "never_done").length,
    due_soon: rows.filter((r) => r.status === "due_soon").length,
  };

  return (
    <PageShell
      title={t("due.title")}
      actions={
        <>
          {(["overdue", "never_done", "due_soon"] as const).map((s) => (
            <span key={s} className={cn("rounded-full px-2.5 py-1 text-xs tabular", DUE_BADGE[s])}>
              {fmtNumber(counts[s], i18n.language)} {t(`due.status.${s}`)}
            </span>
          ))}
          {unclassified > 0 && (
            <Link
              to="/settings"
              className="rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground tabular hover:bg-accent"
            >
              {t("due.unclassified", { n: fmtNumber(unclassified, i18n.language) })}
            </Link>
          )}
        </>
      }
    >

      <DueList
        rows={rows}
        showPlate
        emptyText={t("due.empty")}
        action={(row) => (
          <div className="flex flex-none items-center gap-1.5">
            {row.status === "never_done" && (
              <Button size="sm" variant="ghost" onClick={() => setBaselineFor(row)}>
                {t("due.baseline")}
              </Button>
            )}
            <Link to="/trucks/$truckId" params={{ truckId: String(row.vehicle_id) }}>
              <Button size="sm" variant="outline">
                {t("due.openWo")}
              </Button>
            </Link>
          </div>
        )}
      />
      {baselineFor && (
        <BaselineDialog row={baselineFor} onClose={() => setBaselineFor(null)} />
      )}
    </PageShell>
  );
}

/** Seed a real "last done" without faking today: a closed WO stamped with the
 * actual date + odometer. Without this, configuring plans floods all trucks
 * with never_done and the only workaround was fake WOs dated today. */
function BaselineDialog({ row, onClose }: { row: DueRow; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState(todayCairoYmd());
  const [km, setKm] = useState("");
  const save = useDomainMutation(
    () =>
      unwrap(
        commands.recordBaseline(row.vehicle_id, row.category_id, date, km ? Number(km) : null),
      ),
    { onSuccess: onClose, onError: notifyError },
  );
  const name = i18n.language.startsWith("ar") ? row.category_name_ar : row.category_name_en;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("due.baseline")} — {row.plate} · {name}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("due.baselineHint")}</p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bl-date">{t("due.baselineDate")}</Label>
            <Input
              id="bl-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bl-km">{t("due.baselineKm")}</Label>
            <Input
              id="bl-km"
              inputMode="numeric"
              className="tabular"
              value={km}
              onChange={(e) => setKm(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={save.isPending || !date} onClick={() => save.mutate()}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
