import * as React from "react";
import { useTranslation } from "react-i18next";

import { commands, unwrap } from "@/shared/api/client";
import type { AttendanceDayRow } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { addDays, cairoInstant, dayTitle, hhmmOf, nowCairoHhmm, timeOf } from "./lib";

export type ClockTarget = { mode: "in" | "out"; row: AttendanceDayRow; date: string };

/** Check-in or check-out: always asks for the time, starting from Cairo's time
 * now. A check-out at or before the check-in is the next morning (after
 * midnight still belongs to the day the worker came in). */
export function ClockDialog({ target, onClose }: { target: ClockTarget | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [time, setTime] = React.useState("");

  React.useEffect(() => {
    if (target) setTime(nowCairoHhmm());
  }, [target]);

  const inTime = target?.mode === "out" && target.row.check_in_at ? hhmmOf(target.row.check_in_at) : "";
  const nextDay = target?.mode === "out" && inTime !== "" && time !== "" && time <= inTime;

  const save = useDomainMutation(
    () => {
      if (!target) return Promise.resolve();
      const { mode, row, date } = target;
      const at = cairoInstant(nextDay ? addDays(date, 1) : date, time);
      return unwrap(
        commands.attendanceMark({
          worker_id: row.worker_id,
          work_date: date,
          status: "present",
          check_in_at: mode === "in" ? at : row.check_in_at,
          check_out_at: mode === "out" ? at : row.status === "present" ? row.check_out_at : null,
          note: row.note,
        }),
      );
    },
    {
      onSuccess: () => {
        notifySuccess(t(target?.mode === "out" ? "attendance.clock.outSaved" : "attendance.clock.inSaved"));
        onClose();
      },
      onError: notifyError,
    },
  );

  return (
    <Dialog open={target != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {target ? t(target.mode === "out" ? "attendance.clock.outTitle" : "attendance.clock.inTitle", { name: target.row.name }) : ""}
          </DialogTitle>
          <DialogDescription>{target ? dayTitle(target.date, lang) : ""}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (time) save.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="clock-time">{t(target?.mode === "out" ? "attendance.dialog.out" : "attendance.dialog.in")}</Label>
            <Input
              id="clock-time"
              type="time"
              required
              autoFocus
              value={time}
              onChange={(e) => setTime(e.target.value)}
              dir="ltr"
              className="h-12 w-40 text-lg tabular"
            />
            {target?.mode === "out" && target.row.check_in_at && (
              <p className="text-xs text-muted-foreground">
                {t("attendance.day.inAt", { time: timeOf(target.row.check_in_at, lang) })}
              </p>
            )}
            {nextDay && <p className="text-xs font-medium text-status-due_soon">{t("attendance.dialog.nextDay")}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending || !time}>
              {t(target?.mode === "out" ? "attendance.day.checkOut" : "attendance.day.checkIn")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
