import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";

import { commands, unwrap } from "@/shared/api/client";
import { useDomainMutation, useDue, useWos } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { DueList } from "@/widgets/due/DueList";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

export const Route = createFileRoute("/_app/trucks/$truckId/")({
  component: TruckOverview,
});

function TruckOverview() {
  const { t, i18n } = useTranslation();
  const { truckId } = Route.useParams();
  const vid = Number(truckId);
  const navigate = useNavigate();
  const wos = useWos(undefined, vid);
  const due = useDue(vid);

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("wo.title")}</h2>
          <OverrideOdometerDialog vehicleId={vid} />
        </div>
        {(wos.data ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("common.empty")}
          </div>
        ) : (
          <div className="space-y-2">
            {(wos.data ?? []).map((w) => (
              <button
                key={w.id}
                onClick={() => void navigate({ to: "/wo/$woId", params: { woId: w.id } })}
                className="flex w-full items-center justify-between rounded-xl border bg-card p-4 text-start shadow-sm transition hover:border-border-strong hover:shadow-md"
              >
                <div>
                  <div className="text-sm font-semibold tabular">
                    {fmtCairo(w.opened_at, "YYYY/MM/DD", i18n.language)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground tabular">
                    {fmtNumber(w.task_count)} {t("common.items")}
                    {w.odometer_at_open != null &&
                      ` · ${fmtNumber(w.odometer_at_open, i18n.language)} ${t("common.km")}`}
                  </div>
                </div>
                <Badge
                  className={
                    w.status === "open"
                      ? "bg-status-ok-soft text-status-ok hover:bg-status-ok-soft"
                      : "bg-muted text-muted-foreground hover:bg-muted"
                  }
                >
                  {t(`wo.status.${w.status}`)}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t("due.title")}</h2>
        <DueList rows={due.data ?? []} emptyText={t("due.empty")} />
      </section>
    </div>
  );
}

function OverrideOdometerDialog({ vehicleId }: { vehicleId: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const mutation = useDomainMutation(
    () => unwrap(commands.overrideSet(vehicleId, Number(value), notes || null)),
    {
      onSuccess: () => {
        setOpen(false);
        setValue("");
        setNotes("");
      },
      onError: notifyError,
    },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Gauge className="h-4 w-4" />
          {t("truck.overrideOdometer")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("truck.overrideOdometer")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ov-km">{t("truck.odometerPrompt")}</Label>
            <Input
              id="ov-km"
              inputMode="numeric"
              className="tabular"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ov-notes">{t("truck.overrideNotes")}</Label>
            <Input id="ov-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button
            className="w-full"
            disabled={!value || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
