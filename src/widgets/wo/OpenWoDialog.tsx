import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, TriangleAlert } from "lucide-react";

import { commands, unwrap, type OdoTruth, type WoListRow } from "@/shared/api/client";
import { keys, useDomainMutation } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { fmtKm, fmtNumber, parseIntInput } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Label } from "@/shared/ui/label";
import { NumberInput } from "@/shared/ui/number-input";

import { ODO_JUMP_WARN_KM, odometerDoubt } from "./lib";

/** Opening a work order always captures the odometer — it is a reading for
 * the truck and the km baseline of the work. Two guards live here:
 *  - a truck that already has an open work order is sent to it instead of
 *    getting a second one by accident;
 *  - an odometer below the last reading, or far above it, has to be confirmed.
 *
 * `openWos` is optional: pass the truck's open work orders if the caller has
 * them, otherwise the dialog looks them up itself when it opens. */
export function OpenWoDialog({
  vehicleId,
  odometer,
  trigger,
  openWos,
}: {
  vehicleId: number;
  odometer: OdoTruth | null | undefined;
  trigger?: React.ReactNode;
  openWos?: Pick<WoListRow, "id" | "opened_at">[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4" />
            {t("truck.openWo")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        {/* Mounted only while open, so every opening starts from a clean form. */}
        {open && (
          <OpenWoBody
            vehicleId={vehicleId}
            odometer={odometer}
            openWos={openWos}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function OpenWoBody({
  vehicleId,
  odometer,
  openWos,
  onDone,
}: {
  vehicleId: number;
  odometer: OdoTruth | null | undefined;
  openWos?: Pick<WoListRow, "id" | "opened_at">[];
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [value, setValue] = useState(odometer ? String(odometer.km) : "");
  /** The doubtful reading the user has said is right. */
  const [confirmed, setConfirmed] = useState<number | null>(null);
  const [wantSecond, setWantSecond] = useState(false);

  const lookup = useQuery({
    queryKey: keys.wos("open", vehicleId),
    queryFn: () => unwrap(commands.woList("open", vehicleId)),
    enabled: openWos === undefined,
  });
  const existing = openWos ?? lookup.data ?? [];
  const checking = openWos === undefined && lookup.isPending;

  const goTo = (id: string) => {
    onDone();
    void navigate({ to: "/wo/$woId", params: { woId: id } });
  };

  const mutation = useDomainMutation((km: number) => unwrap(commands.woOpen(vehicleId, km)), {
    onSuccess: goTo,
    onError: notifyError,
  });

  const typed = parseIntInput(value);
  const doubt = odometerDoubt(typed, odometer?.km);
  const needsConfirm = doubt != null && confirmed !== typed;

  if (existing.length > 0 && !wantSecond) {
    const first = existing[0];
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("wo.openExistsTitle")}</DialogTitle>
          <DialogDescription>
            {t("wo.openExistsBody", {
              date: fmtCairo(first.opened_at, "YYYY/MM/DD HH:mm", i18n.language),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Button className="w-full" onClick={() => goTo(first.id)}>
            {t("wo.openExistsGo")}
          </Button>
          <Button variant="outline" className="w-full" onClick={() => setWantSecond(true)}>
            {t("wo.openExistsAnother")}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("truck.openWoTitle")}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typed == null || mutation.isPending || checking) return;
          if (needsConfirm) {
            setConfirmed(typed);
            return;
          }
          mutation.mutate(typed);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="wo-open-odometer">{t("truck.odometerPrompt")}</Label>
          <NumberInput id="wo-open-odometer" autoFocus value={value} onValueChange={setValue} />
          {odometer && (
            <p className="text-xs text-muted-foreground">
              {t("wo.openLastReading", {
                km: fmtKm(odometer.km, i18n.language),
                source: t(`truck.odometerSource.${odometer.source}`),
              })}
            </p>
          )}
          {typed == null && <p className="text-xs text-muted-foreground">{t("wo.odoRequired")}</p>}
        </div>

        {doubt && odometer && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-status-due_soon-soft px-3 py-2 text-sm text-status-due_soon"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" />
            <span>
              {doubt === "lower"
                ? t("wo.openOdoLower", { km: fmtKm(odometer.km, i18n.language) })
                : t("wo.openOdoJump", {
                    km: fmtKm(odometer.km, i18n.language),
                    diff: fmtNumber(ODO_JUMP_WARN_KM, i18n.language),
                  })}
            </span>
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={typed == null || mutation.isPending || checking}
        >
          {(mutation.isPending || checking) && <Loader2 className="animate-spin" />}
          {doubt && !needsConfirm
            ? t("wo.openOdoConfirmed")
            : doubt
              ? t("wo.openOdoConfirm")
              : t("truck.openWo")}
        </Button>
      </form>
    </>
  );
}
