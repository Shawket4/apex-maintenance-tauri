import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { commands, unwrap, type TireOpRow, type TireRow } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtNumber, parseIntInput } from "@/shared/lib/numbers";
import { REASON_STATUS } from "@/shared/lib/status";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
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
import { TireProductPicker, type TireSpec } from "@/widgets/catalog/pickers";

import { DISMOUNT_REASONS, MAX_ODOMETER, type LifeAction } from "./lib";

/** Correct what was typed about a tire: make, size, DOT, starting km, notes. */
export function TireEditDialog({ tire, onClose }: { tire: TireRow; onClose: () => void }) {
  const { t } = useTranslation();
  const uid = useId();
  const [spec, setSpec] = useState<TireSpec | null>({
    brand: tire.brand,
    model: tire.model ?? "",
    size: tire.size ?? "",
  });
  const [dot, setDot] = useState(tire.dot_code ?? "");
  const [baseKm, setBaseKm] = useState(String(tire.base_km));
  const [notes, setNotes] = useState(tire.notes ?? "");
  const [touched, setTouched] = useState(false);

  const km = baseKm.trim() ? parseIntInput(baseKm) : 0;
  const typeErr = !spec?.brand.trim();
  const kmErr = km == null || km > MAX_ODOMETER;

  const save = useDomainMutation(
    () =>
      unwrap(
        commands.tireUpdate(tire.id, {
          brand: spec!.brand.trim(),
          model: spec!.model.trim() || null,
          size: spec!.size.trim() || null,
          dot_code: dot.trim() || null,
          base_km: km ?? 0,
          notes: notes.trim() || null,
        }),
      ),
    {
      onSuccess: () => {
        notifySuccess(t("tires.edit.done"));
        onClose();
      },
      onError: notifyError,
    },
  );

  const id = (name: string) => `${uid}-${name}`;

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("tires.edit.title")}</DialogTitle>
          <DialogDescription>{t("tires.edit.subtitle")}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!typeErr && !kmErr) save.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label id={id("type-label")} htmlFor={id("type")}>
              {t("tires.intake.brand")}
            </Label>
            <TireProductPicker
              id={id("type")}
              aria-labelledby={id("type-label")}
              disabled={save.isPending}
              value={spec}
              onChange={setSpec}
            />
            {touched && typeErr && (
              <p role="alert" className="text-sm text-status-overdue">
                {t("tires.intake.brandRequired")}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("dot")}>{t("tires.form.dot")}</Label>
            <Input id={id("dot")} dir="ltr" className="text-start" value={dot} onChange={(e) => setDot(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("km")}>{t("tires.edit.baseKm")}</Label>
            <NumberInput
              id={id("km")}
              value={baseKm}
              onValueChange={setBaseKm}
              aria-invalid={touched && kmErr}
              aria-describedby={id("km-hint")}
            />
            <p id={id("km-hint")} className={cn("text-sm", touched && kmErr ? "text-status-overdue" : "text-muted-foreground")}>
              {touched && kmErr ? t("tires.form.kmBad") : t("tires.edit.baseKmHint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("notes")}>{t("tires.form.notes")}</Label>
            <Input id={id("notes")} dir="auto" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One step in the tire's life (to repair, back, to the retreader, back to
 * stock, scrap): says what it means, takes an optional note, and makes the
 * user tick a box before scrapping. */
export function LifecycleDialog({
  tireId,
  action,
  onClose,
}: {
  tireId: string;
  action: LifeAction;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const [note, setNote] = useState("");
  const [sure, setSure] = useState(false);
  const isScrap = action.id === "scrap";

  const run = useDomainMutation(
    () => unwrap(commands.tireSetStatus(tireId, action.to, action.event, note.trim() || null)),
    {
      onSuccess: () => {
        notifySuccess(t(`tires.life.${action.id}.done`));
        onClose();
      },
      onError: notifyError,
    },
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`tires.life.${action.id}.title`)}</DialogTitle>
          <DialogDescription>{t(`tires.life.${action.id}.body`)}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isScrap || sure) run.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-note`}>{t("tires.life.note")}</Label>
            <Input
              id={`${uid}-note`}
              dir="auto"
              maxLength={500}
              placeholder={t(`tires.life.${action.id}.notePlaceholder`)}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {isScrap && (
            <div className="flex items-start gap-3 rounded-lg bg-status-overdue-soft p-3">
              <Checkbox
                id={`${uid}-sure`}
                className="mt-0.5 size-5"
                checked={sure}
                onCheckedChange={(v) => setSure(v === true)}
              />
              <Label htmlFor={`${uid}-sure`} className="text-sm leading-relaxed">
                {t("tires.life.scrap.sure")}
              </Label>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={run.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant={isScrap ? "destructive" : "default"}
              disabled={run.isPending || (isScrap && !sure)}
            >
              {run.isPending && <Loader2 className="animate-spin" />}
              {t(`tires.life.${action.id}.confirm`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Correct the odometer readings on one fitting. The tire's km is worked out
 * from these, so a correction shows everywhere at once. */
export function EditOdoDialog({ op, onClose }: { op: TireOpRow; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const closed = op.dismounted_at != null;
  const [mounted, setMounted] = useState(op.mounted_odometer != null ? String(op.mounted_odometer) : "");
  const [dismounted, setDismounted] = useState(op.dismounted_odometer != null ? String(op.dismounted_odometer) : "");
  const [touched, setTouched] = useState(false);

  // An empty box means "leave that reading as it is".
  const m = mounted.trim() ? parseIntInput(mounted) : null;
  const d = closed && dismounted.trim() ? parseIntInput(dismounted) : null;
  const mBad = !!mounted.trim() && (m == null || m > MAX_ODOMETER);
  const dBad = closed && !!dismounted.trim() && (d == null || d > MAX_ODOMETER);
  const effM = m ?? op.mounted_odometer;
  const effD = closed ? (d ?? op.dismounted_odometer) : null;
  const backwards = !mBad && !dBad && effM != null && effD != null && effD < effM;
  const changed = (m != null && m !== op.mounted_odometer) || (d != null && d !== op.dismounted_odometer);
  const ok = !mBad && !dBad && !backwards && changed;

  const save = useDomainMutation(() => unwrap(commands.assignmentSetOdometers(op.assignment_id, m, d)), {
    onSuccess: () => {
      notifySuccess(t("tires.editOdo.done"));
      onClose();
    },
    onError: notifyError,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("tires.editOdo.title")}</DialogTitle>
          <DialogDescription>{t("tires.editOdo.hint")}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (ok) save.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-m`}>{t("tires.editOdo.mounted")}</Label>
            <NumberInput id={`${uid}-m`} value={mounted} onValueChange={setMounted} aria-invalid={mBad} />
            {mBad && <p className="text-sm text-status-overdue">{t("tires.form.kmBad")}</p>}
          </div>
          {closed ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-d`}>{t("tires.editOdo.dismounted")}</Label>
              <NumberInput
                id={`${uid}-d`}
                value={dismounted}
                onValueChange={setDismounted}
                aria-invalid={dBad || backwards}
              />
              {dBad && <p className="text-sm text-status-overdue">{t("tires.form.kmBad")}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("tires.editOdo.stillOn")}</p>
          )}
          {backwards && (
            <p role="alert" className="rounded-lg bg-status-overdue-soft p-3 text-sm text-status-overdue">
              {t("tires.editOdo.backwards", {
                mounted: fmtNumber(effM, i18n.language),
                dismounted: fmtNumber(effD, i18n.language),
              })}
            </p>
          )}
          {touched && !changed && !mBad && !dBad && !backwards && (
            <p className="text-sm text-muted-foreground">{t("tires.editOdo.noChange")}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending || mBad || dBad || backwards}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Correct why the tire came off. The reason decides what happens to the
 * tire, so every choice says where the tire ends up. */
export function ReasonDialog({
  op,
  statusFollows,
  onClose,
}: {
  op: TireOpRow;
  /** False when the tire's status was changed again after this dismount: the
   * reason is corrected but the current status stays. */
  statusFollows: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const [reason, setReason] = useState(op.dismount_reason ?? "");

  const save = useDomainMutation(() => unwrap(commands.dismountSetReason(op.assignment_id, reason)), {
    onSuccess: () => {
      notifySuccess(t("tires.reason.done"));
      onClose();
    },
    onError: notifyError,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("tires.reason.title")}</DialogTitle>
          <DialogDescription>
            {statusFollows ? t("tires.reason.body") : t("tires.reason.bodyNoFollow")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason && reason !== op.dismount_reason) save.mutate();
          }}
        >
          <fieldset className="space-y-2">
            <legend className="sr-only">{t("tires.reason.title")}</legend>
            {DISMOUNT_REASONS.map((r) => {
              const to = REASON_STATUS[r];
              return (
                <label
                  key={r}
                  htmlFor={`${uid}-${r}`}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3",
                    reason === r && "border-primary bg-primary/5",
                  )}
                >
                  <input
                    type="radio"
                    id={`${uid}-${r}`}
                    name={`${uid}-reason`}
                    className="mt-1 size-4 accent-primary"
                    checked={reason === r}
                    onChange={() => setReason(r)}
                  />
                  <span>
                    <span className="block text-sm font-semibold">
                      {t(`diagram.reason.${r}`)}
                      {r === op.dismount_reason && (
                        <span className="font-normal text-muted-foreground"> {t("tires.reason.current")}</span>
                      )}
                    </span>
                    {statusFollows && (
                      <span className={cn("block text-sm", to === "scrapped" ? "text-status-overdue" : "text-muted-foreground")}>
                        {t("tires.reason.becomes", { status: t(`tires.status.${to}`) })}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending || !reason || reason === op.dismount_reason}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
