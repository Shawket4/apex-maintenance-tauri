import * as React from "react";
import { useTranslation } from "react-i18next";

import { commands, unwrap } from "@/shared/api/client";
import type { AttendanceSettingsView } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { parseIntInput } from "@/shared/lib/numbers";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { NumberInput } from "@/shared/ui/number-input";

import { WEEKDAYS_SAT_FIRST } from "./lib";

/** The garage's working day: start, end, grace before late, weekly days off. */
export function HoursDialog({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AttendanceSettingsView;
}) {
  const { t } = useTranslation();
  const [start, setStart] = React.useState(settings.work_start);
  const [end, setEnd] = React.useState(settings.work_end);
  const [grace, setGrace] = React.useState(String(settings.late_grace_minutes));
  const [off, setOff] = React.useState<number[]>(settings.weekly_off_days);

  React.useEffect(() => {
    if (!open) return;
    setStart(settings.work_start);
    setEnd(settings.work_end);
    setGrace(String(settings.late_grace_minutes));
    setOff(settings.weekly_off_days);
  }, [open, settings]);

  const save = useDomainMutation(
    () =>
      unwrap(
        commands.attendanceSettingsSet({
          work_start: start,
          work_end: end,
          late_grace_minutes: parseIntInput(grace) ?? 0,
          weekly_off_days: off,
        }),
      ),
    {
      onSuccess: () => {
        notifySuccess(t("attendance.hours.saved"));
        onOpenChange(false);
      },
      onError: notifyError,
    },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("attendance.hours.title")}</DialogTitle>
          <DialogDescription>{t("attendance.hours.subtitle")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {!settings.saved && (
            <p className="rounded-lg bg-status-due_soon-soft px-3 py-2 text-xs text-status-due_soon">
              {t("attendance.hours.defaults")}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="h-start">{t("attendance.hours.start")}</Label>
              <Input id="h-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} dir="ltr" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="h-end">{t("attendance.hours.end")}</Label>
              <Input id="h-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} dir="ltr" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="h-grace">{t("attendance.hours.grace")}</Label>
            <NumberInput id="h-grace" value={grace} onValueChange={setGrace} className="w-28" />
            <p className="text-xs text-muted-foreground">{t("attendance.hours.graceHint")}</p>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t("attendance.hours.offDays")}</legend>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {WEEKDAYS_SAT_FIRST.map((d) => {
                const on = off.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setOff((prev) => (on ? prev.filter((x) => x !== d) : [...prev, d]))}
                    className={cn(
                      "min-h-11 rounded-lg border px-1 text-xs font-semibold transition",
                      on ? "border-transparent bg-primary text-primary-foreground" : "bg-card hover:bg-foreground/[0.04]",
                    )}
                  >
                    {t(`attendance.weekday.${d}`)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="submit" className="w-full sm:w-auto" disabled={save.isPending}>
              {t("attendance.hours.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
