import * as React from "react";
import { useTranslation } from "react-i18next";
import { Clock, X } from "lucide-react";

import { commands, unwrap } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { todayCairoYmd } from "@/shared/lib/time";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { KIND_SOLID, STATUSES, addDays, cairoInstant, dayTitle, hhmmOf, nowCairoHhmm, type Status } from "./lib";

export type DayTarget = {
  workerId: string;
  name: string;
  job?: string | null;
  date: string;
  status: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  note: string | null;
};

/** One worker's day: the status, the times (present days only) and a note.
 * Sends the whole day; the Rust side queues only what changed. */
export function DayDialog({
  target,
  onOpenChange,
}: {
  target: DayTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [status, setStatus] = React.useState<Status>("present");
  const [inTime, setInTime] = React.useState("");
  const [outTime, setOutTime] = React.useState("");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (!target) return;
    setStatus((target.status as Status | null) ?? "present");
    // A day not marked yet starts from Cairo's time now. A present day saved
    // without a time stays so.
    setInTime(target.checkInAt ? hhmmOf(target.checkInAt) : target.status === "present" ? "" : nowCairoHhmm());
    setOutTime(target.checkOutAt ? hhmmOf(target.checkOutAt) : "");
    setNote(target.note ?? "");
  }, [target]);

  const isToday = target?.date === todayCairoYmd();
  // A check-out earlier in the day than the check-in is the next morning.
  const outNextDay = status === "present" && inTime !== "" && outTime !== "" && outTime <= inTime;

  const save = useDomainMutation(
    () => {
      if (!target) return Promise.resolve();
      const present = status === "present";
      const outDate = outNextDay ? addDays(target.date, 1) : target.date;
      return unwrap(
        commands.attendanceMark({
          worker_id: target.workerId,
          work_date: target.date,
          status,
          check_in_at: present && inTime ? cairoInstant(target.date, inTime) : null,
          check_out_at: present && outTime ? cairoInstant(outDate, outTime) : null,
          note: note.trim() || null,
        }),
      );
    },
    {
      onSuccess: () => {
        notifySuccess(t("attendance.dialog.saved"));
        onOpenChange(false);
      },
      onError: notifyError,
    },
  );

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{target ? t("attendance.dialog.title", { name: target.name }) : ""}</DialogTitle>
          <DialogDescription>
            {target ? [dayTitle(target.date, lang), target.job].filter(Boolean).join(" · ") : ""}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t("attendance.dialog.status")}</legend>
            <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STATUSES.map((s) => {
                const on = status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setStatus(s)}
                    className={cn(
                      "min-h-11 rounded-lg border px-2 text-sm font-semibold transition",
                      on ? cn(KIND_SOLID[s], "border-transparent shadow-sm") : "bg-card hover:bg-foreground/[0.04]",
                    )}
                  >
                    {t(`attendance.status.${s}`)}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {status === "present" ? (
            <div className="grid grid-cols-2 gap-3">
              <TimeField
                id="att-in"
                label={t("attendance.dialog.in")}
                value={inTime}
                onChange={setInTime}
                onNow={isToday ? () => setInTime(nowCairoHhmm()) : undefined}
              />
              <TimeField
                id="att-out"
                label={t("attendance.dialog.out")}
                value={outTime}
                onChange={setOutTime}
                onNow={isToday ? () => setOutTime(nowCairoHhmm()) : undefined}
                onClear={outTime ? () => setOutTime("") : undefined}
              />
              {outNextDay && (
                <p className="col-span-2 text-xs text-muted-foreground">{t("attendance.dialog.nextDay")}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("attendance.dialog.timesOnlyPresent")}</p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="att-note">{t("attendance.dialog.note")}</Label>
            <Input
              id="att-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("attendance.dialog.notePlaceholder")}
              dir="auto"
              maxLength={500}
            />
          </div>

          <DialogFooter>
            <Button type="submit" className="w-full sm:w-auto" disabled={save.isPending}>
              {t("attendance.dialog.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TimeField({
  id,
  label,
  value,
  onChange,
  onNow,
  onClear,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onNow?: () => void;
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="time" value={value} onChange={(e) => onChange(e.target.value)} dir="ltr" className="tabular" />
      <div className="flex gap-1.5">
        {onNow && (
          <Button type="button" variant="ghost" size="xs" onClick={onNow}>
            <Clock />
            {t("attendance.dialog.now")}
          </Button>
        )}
        {onClear && (
          <Button type="button" variant="ghost" size="xs" onClick={onClear}>
            <X />
            {t("attendance.dialog.clear")}
          </Button>
        )}
      </div>
    </div>
  );
}
