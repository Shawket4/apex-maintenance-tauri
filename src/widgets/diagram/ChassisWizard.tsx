import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Minus, Plus, Trash2 } from "lucide-react";

import { commands, unwrap, type ChassisConfig } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Label } from "@/shared/ui/label";
import { WheelMap, syntheticChassis, wheelCount } from "apex-tire-diagram";

// The limits the Rust planner accepts (services/chassis_plan.rs).
const LIMITS = { drive: [1, 4], trailer: [0, 8], spares: [0, 6] } as const;

/** The truck has no wheel layout yet: choose how many axles and spares it
 * has, SEE the result while choosing, then create it. */
export function ChassisWizard({ vehicleId }: { vehicleId: number }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [driveAxles, setDriveAxles] = useState(2);
  const [trailerAxles, setTrailerAxles] = useState(4);
  const [spares, setSpares] = useState(2);
  const [singleTrailer, setSingleTrailer] = useState(false);

  const config: ChassisConfig = useMemo(
    () => ({
      drive_axles: driveAxles,
      trailer_axles: trailerAxles,
      spares,
      single_trailer_axles: trailerAxles > 0 && singleTrailer,
    }),
    [driveAxles, trailerAxles, spares, singleTrailer],
  );
  const preview = useMemo(() => syntheticChassis(config), [config]);
  const count = wheelCount(config);

  const create = useDomainMutation(() => unwrap(commands.chassisCreate(vehicleId, config)), {
    onSuccess: () => notifySuccess(t("chassis.created")),
    onError: notifyError,
  });

  const stepper = (
    id: string,
    label: string,
    hint: string,
    value: number,
    set: (n: number) => void,
    [min, max]: readonly [number, number],
  ) => (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
      <div className="min-w-0">
        <div id={id} className="text-sm font-semibold">
          {label}
        </div>
        <div className="text-xs leading-relaxed text-muted-foreground">{hint}</div>
      </div>
      <div role="group" aria-labelledby={id} className="flex flex-none items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="pointer-coarse:size-11"
          disabled={value <= min || create.isPending}
          onClick={() => set(value - 1)}
          aria-label={t("chassis.decrement", { label })}
        >
          <Minus aria-hidden />
        </Button>
        <output aria-live="polite" className="w-7 text-center text-lg font-bold tabular">
          {fmtNumber(value, lang)}
        </output>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="pointer-coarse:size-11"
          disabled={value >= max || create.isPending}
          onClick={() => set(value + 1)}
          aria-label={t("chassis.increment", { label })}
        >
          <Plus aria-hidden />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-bold">{t("chassis.title")}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("chassis.intro")}</p>

      <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start">
        <div className="space-y-3">
          {stepper(
            "cw-drive",
            t("chassis.driveAxles"),
            t("chassis.driveAxlesHint"),
            driveAxles,
            setDriveAxles,
            LIMITS.drive,
          )}
          {stepper(
            "cw-trailer",
            t("chassis.trailerAxles"),
            t("chassis.trailerAxlesHint"),
            trailerAxles,
            setTrailerAxles,
            LIMITS.trailer,
          )}
          {trailerAxles > 0 && (
            <div className="flex min-h-11 items-start gap-3 rounded-xl border p-3">
              <Checkbox
                id="cw-single"
                className="mt-0.5 size-5"
                checked={singleTrailer}
                disabled={create.isPending}
                onCheckedChange={(v) => setSingleTrailer(v === true)}
              />
              <div>
                <Label htmlFor="cw-single" className="cursor-pointer leading-relaxed">
                  {t("chassis.singleTrailer")}
                </Label>
                <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {t("chassis.singleTrailerHint")}
                </div>
              </div>
            </div>
          )}
          {stepper("cw-spares", t("chassis.spares"), t("chassis.sparesHint"), spares, setSpares, LIMITS.spares)}

          <p role="status" className="rounded-lg bg-muted px-3 py-2.5 text-sm font-semibold">
            {t("chassis.total", { road: fmtNumber(count.road, lang), spares: fmtNumber(count.spares, lang) })}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("chassis.changeLater")}</p>
          <Button className="w-full" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="animate-spin" />}
            {t("chassis.create")}
          </Button>
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold text-muted-foreground">{t("chassis.preview")}</div>
          <div className="overflow-x-auto rounded-xl border bg-muted/30 p-3">
            <WheelMap axles={preview.axles} positions={preview.positions} lang={lang} compact />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Wrong axle count? The layout can be deleted and made again — but only
 * while no tire is on the truck (the tires are tied to its wheels). Says
 * that plainly when it is not possible. */
export function ChassisRebuild({ vehicleId, mountedCount }: { vehicleId: number; mountedCount: number }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const del = useDomainMutation(() => unwrap(commands.chassisDelete(vehicleId)), {
    onSuccess: () => {
      setOpen(false);
      notifySuccess(t("chassis.deleted"));
    },
    onError: (e) => {
      setOpen(false);
      notifyError(e);
    },
  });

  return (
    <div className="rounded-xl border bg-card p-4 text-sm">
      <div className="font-semibold">{t("chassis.rebuildHeading")}</div>
      {mountedCount > 0 ? (
        <p className="mt-1 leading-relaxed text-muted-foreground">
          {t("chassis.rebuildBlocked", { n: fmtNumber(mountedCount, i18n.language) })}
        </p>
      ) : (
        <>
          <p className="mt-1 leading-relaxed text-muted-foreground">{t("chassis.rebuildAllowed")}</p>
          <Button
            variant="outline"
            className="mt-3 h-auto min-h-11 whitespace-normal py-2 text-destructive hover:text-destructive"
            disabled={del.isPending}
            onClick={() => setOpen(true)}
          >
            {del.isPending ? <Loader2 className="animate-spin" /> : <Trash2 aria-hidden />}
            {t("chassis.rebuild")}
          </Button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title={t("chassis.rebuildTitle")}
            description={t("chassis.rebuildBody")}
            confirmLabel={t("chassis.rebuildConfirm")}
            destructive
            pending={del.isPending}
            onConfirm={() => del.mutate()}
          />
        </>
      )}
    </div>
  );
}
