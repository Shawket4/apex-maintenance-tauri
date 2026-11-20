import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Gauge, Loader2 } from "lucide-react";

import { commands, unwrap, type OdoTruth } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtKm, parseIntInput } from "@/shared/lib/numbers";
import { fmtAgo, fmtCairo } from "@/shared/lib/time";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { NumberInput } from "@/shared/ui/number-input";

/** A correction this far above the current reading is far more likely a
 * typing slip (an extra digit) than a real distance. */
const JUMP_WARN_KM = 50_000;
/** Above this change the reason must be written down. */
const NOTE_REQUIRED_KM = 10_000;

const SOURCES = ["falcon_fuel", "falcon_mileage", "manual_override", "oil_change", "work_order"];

/** The truck's odometer as the app believes it: the reading, where it came
 * from and when — and the one place to correct it. Every due date that is
 * counted in km leans on this number. */
export function OdometerCard({ vehicleId, odometer }: { vehicleId: number; odometer: OdoTruth | null }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [editing, setEditing] = useState(false);

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <Gauge className="h-4 w-4 text-muted-foreground" />
        {t("truck.odometerTitle")}
      </h2>
      <div className="mt-3 space-y-3">
        {odometer ? (
          <>
            <div className="text-xl font-bold tabular">{fmtKm(odometer.km, lang)}</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t("truck.odometerFrom")}</dt>
              <dd className="font-semibold">{sourceText(odometer.source, t)}</dd>
              <dt className="text-muted-foreground">{t("truck.odometerWhen")}</dt>
              <dd className="tabular">
                {odometer.observed_at ? (
                  <>
                    <span className="font-semibold">
                      {fmtCairo(odometer.observed_at, "YYYY/MM/DD", lang)}
                    </span>{" "}
                    <span className="text-xs text-muted-foreground">
                      ({fmtAgo(odometer.observed_at, lang)})
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </dl>
          </>
        ) : (
          <p className="text-sm text-status-due_soon">{t("truck.odometerNone")}</p>
        )}
        <Button variant="outline" onClick={() => setEditing(true)}>
          {odometer ? t("truck.overrideOdometer") : t("truck.enterOdometer")}
        </Button>
      </div>
      {editing && (
        <CorrectOdometerDialog vehicleId={vehicleId} current={odometer} onClose={() => setEditing(false)} />
      )}
    </section>
  );
}

function sourceText(source: string, t: (k: string) => string) {
  return SOURCES.includes(source) ? t(`truck.odometerSource.${source}`) : t("truck.odometerSourceOther");
}

function CorrectOdometerDialog({
  vehicleId,
  current,
  onClose,
}: {
  vehicleId: number;
  current: OdoTruth | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const km = parseIntInput(value);
  const diff = km != null && current ? km - current.km : null;
  const goingDown = diff != null && diff < 0;
  const bigJump = diff != null && diff > JUMP_WARN_KM;
  const same = diff === 0;
  const noteRequired = diff != null && (diff < 0 || diff > NOTE_REQUIRED_KM);
  const noteMissing = noteRequired && notes.trim() === "";

  const mutation = useDomainMutation(
    () => unwrap(commands.overrideSet(vehicleId, km!, notes.trim() || null)),
    {
      onSuccess: () => {
        notifySuccess(t("truck.overrideSaved"));
        onClose();
      },
      onError: (e) => {
        setConfirming(false);
        notifyError(e);
      },
    },
  );

  const submit = () => {
    setTried(true);
    if (km == null || same || noteMissing || mutation.isPending) return;
    if (goingDown || bigJump) setConfirming(true);
    else mutation.mutate();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !mutation.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{current ? t("truck.overrideOdometer") : t("truck.enterOdometer")}</DialogTitle>
          <DialogDescription>{t("truck.overrideBody")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            submit();
          }}
        >
          {current && (
            <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm tabular">
              {t("truck.overrideCurrent", {
                km: fmtKm(current.km, lang),
                source: sourceText(current.source, t),
              })}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ov-km">{t("truck.overrideNew")}</Label>
            <NumberInput id="ov-km" value={value} onValueChange={setValue} autoFocus />
            {tried && km == null && (
              <p className="text-sm text-destructive">{t("common.requiredField")}</p>
            )}
            {same && <p className="text-sm text-muted-foreground">{t("truck.overrideSame")}</p>}
          </div>
          {goingDown && (
            <p role="alert" className="rounded-lg bg-status-due_soon-soft px-3 py-2.5 text-sm text-status-due_soon">
              {t("truck.overrideDownWarn")}
            </p>
          )}
          {bigJump && (
            <p role="alert" className="rounded-lg bg-status-due_soon-soft px-3 py-2.5 text-sm text-status-due_soon">
              {t("truck.overrideJumpWarn", { km: fmtKm(diff, lang) })}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ov-notes">
              {noteRequired ? t("truck.overrideNotesRequired") : t("truck.overrideNotes")}
            </Label>
            <Input
              id="ov-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              aria-invalid={(tried && noteMissing) || undefined}
            />
            {tried && noteMissing && (
              <p className="text-sm text-destructive">{t("truck.overrideNoteMissing")}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={value === "" || same || mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={goingDown ? t("truck.overrideConfirmDownTitle") : t("truck.overrideConfirmJumpTitle")}
          description={t("truck.overrideConfirmBody", {
            from: current ? fmtKm(current.km, lang) : "—",
            to: fmtKm(km, lang),
          })}
          confirmLabel={t("truck.overrideConfirmYes")}
          pending={mutation.isPending}
          onConfirm={() => mutation.mutate()}
        />
      </DialogContent>
    </Dialog>
  );
}
