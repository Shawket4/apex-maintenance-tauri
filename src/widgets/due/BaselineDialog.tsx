import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { commands, unwrap, type DueRow } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtKm, parseIntInput } from "@/shared/lib/numbers";
import { todayCairoYmd } from "@/shared/lib/time";
import { Button } from "@/shared/ui/button";
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

import { intervalText } from "./dueText";

/** "When was this last done?" — records the real date (and odometer) of the
 * last time a job was done, so its due date is counted from the truth and not
 * from today. Saved as a closed work order on that date. */
export function BaselineDialog({ row, onClose }: { row: DueRow; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const today = todayCairoYmd();
  const [date, setDate] = useState("");
  const [km, setKm] = useState("");
  // Warnings the user has seen and chosen to save anyway.
  const [accepted, setAccepted] = useState(false);

  const needsKm = row.interval_km != null;
  const kmValue = parseIntInput(km);
  const dateMissing = date === "";
  const dateInFuture = !dateMissing && date > today;

  const warnings: string[] = [];
  if (needsKm && km === "") warnings.push(t("due.baselineNoKmWarn"));
  if (kmValue != null && row.current_odometer != null && kmValue > row.current_odometer) {
    warnings.push(t("due.baselineKmAboveWarn", { km: fmtKm(row.current_odometer, lang) }));
  }

  const save = useDomainMutation(
    () => unwrap(commands.recordBaseline(row.vehicle_id, row.category_id, date, kmValue)),
    {
      onSuccess: () => {
        notifySuccess(t("due.baselineSaved"));
        onClose();
      },
      onError: notifyError,
    },
  );

  const canSubmit = !dateMissing && !dateInFuture && !save.isPending;
  const submit = () => {
    if (!canSubmit) return;
    if (warnings.length > 0 && !accepted) {
      setAccepted(true);
      return;
    }
    save.mutate();
  };

  const name = lang.startsWith("ar") ? row.category_name_ar : row.category_name_en;
  const every = intervalText(row, t, lang);
  const showWarnings = accepted && warnings.length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("due.baselineTitle")}</DialogTitle>
          <DialogDescription>
            {t("due.baselineFor", { name, plate: `⁨${row.plate}⁩` })}
            {every ? ` — ${every}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            submit();
          }}
        >
          <p className="text-sm text-muted-foreground">{t("due.baselineHint")}</p>
          <div className="space-y-1.5">
            <Label htmlFor="bl-date">{t("due.baselineDate")}</Label>
            <Input
              id="bl-date"
              type="date"
              max={today}
              required
              value={date}
              aria-invalid={dateInFuture || undefined}
              onChange={(e) => {
                setDate(e.target.value);
                setAccepted(false);
              }}
            />
            {dateInFuture && <p className="text-sm text-destructive">{t("due.baselineDateFuture")}</p>}
          </div>
          {needsKm && (
            <div className="space-y-1.5">
              <Label htmlFor="bl-km">{t("due.baselineKm")}</Label>
              <NumberInput
                id="bl-km"
                value={km}
                onValueChange={(v) => {
                  setKm(v);
                  setAccepted(false);
                }}
              />
              <p className="text-xs text-muted-foreground">
                {row.current_odometer != null
                  ? t("due.baselineKmHintNow", { km: fmtKm(row.current_odometer, lang) })
                  : t("due.baselineKmHint")}
              </p>
            </div>
          )}
          {showWarnings && (
            <div role="alert" className="space-y-1 rounded-lg bg-status-due_soon-soft px-3 py-2.5 text-sm text-status-due_soon">
              {warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {showWarnings ? t("due.baselineSaveAnyway") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
