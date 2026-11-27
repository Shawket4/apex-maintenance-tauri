import * as React from "react";
import { useTranslation } from "react-i18next";
import { CalendarPlus, X } from "lucide-react";

import { commands, unwrap } from "@/shared/api/client";
import type { AttendanceWorkerRow, WorkerInput } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

type Draft = { name: string; job: string; phone: string; joined: string; left: string; notes: string };
const EMPTY: Draft = { name: "", job: "", phone: "", joined: "", left: "", notes: "" };

const draftOf = (w: AttendanceWorkerRow | null | undefined): Draft =>
  w
    ? {
        name: w.name,
        job: w.job ?? "",
        phone: w.phone ?? "",
        joined: w.joined_on ?? "",
        left: w.left_on ?? "",
        notes: w.notes ?? "",
      }
    : EMPTY;

/** Add a worker by typing their name (everything else is optional), or edit
 * one. `focusLeft` opens an edit with the "left on" field focused. */
export function WorkerDialog({
  open,
  onOpenChange,
  worker,
  focusLeft = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker?: AttendanceWorkerRow | null;
  focusLeft?: boolean;
}) {
  const { t } = useTranslation();
  const editing = worker != null;
  const [d, setD] = React.useState<Draft>(EMPTY);
  const [nameMissing, setNameMissing] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const leftRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setD(draftOf(worker));
    setNameMissing(false);
  }, [open, worker]);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setD((prev) => ({ ...prev, [k]: v }));
    if (k === "name" && v.trim()) setNameMissing(false);
  };

  const input = (): WorkerInput => ({
    name: d.name,
    job: d.job || null,
    phone: d.phone || null,
    falcon_employee_id: worker?.falcon_employee_id ?? null,
    joined_on: d.joined || null,
    left_on: d.left || null,
    notes: d.notes || null,
  });

  const save = useDomainMutation(
    async (another: boolean) => {
      if (editing) await unwrap(commands.workerUpdate(worker.id, input()));
      else await unwrap(commands.workerAdd(input()));
      return another;
    },
    {
      onSuccess: (another) => {
        notifySuccess(editing ? t("attendance.workers.saved") : t("attendance.workers.added"));
        if (another) {
          setD(EMPTY);
          nameRef.current?.focus();
        } else {
          onOpenChange(false);
        }
      },
      onError: notifyError,
    },
  );

  const submit = (another: boolean) => {
    if (!d.name.trim()) {
      setNameMissing(true);
      nameRef.current?.focus();
      return;
    }
    save.mutate(another);
  };

  const optional = <span className="font-normal text-muted-foreground"> ({t("attendance.workers.optional")})</span>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (focusLeft ? leftRef : nameRef).current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{editing ? t("attendance.workers.editTitle") : t("attendance.workers.addTitle")}</DialogTitle>
          <DialogDescription>{t("attendance.workers.datesHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="w-name">{t("attendance.workers.name")}</Label>
            <Input
              id="w-name"
              ref={nameRef}
              value={d.name}
              onChange={set("name")}
              placeholder={t("attendance.workers.namePlaceholder")}
              dir="auto"
              maxLength={120}
              aria-invalid={nameMissing || undefined}
              aria-describedby={nameMissing ? "w-name-err" : undefined}
            />
            {nameMissing && (
              <p id="w-name-err" className="text-xs text-status-overdue">
                {t("errors.codes.worker_name_required")}
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="w-job">
                {t("attendance.workers.job")}
                {optional}
              </Label>
              <Input id="w-job" value={d.job} onChange={set("job")} placeholder={t("attendance.workers.jobPlaceholder")} dir="auto" maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-phone">
                {t("attendance.workers.phone")}
                {optional}
              </Label>
              <Input id="w-phone" value={d.phone} onChange={set("phone")} inputMode="tel" dir="ltr" maxLength={40} />
            </div>
            <OptionalDate
              id="w-joined"
              label={t("attendance.workers.joined")}
              value={d.joined}
              onChange={(v) => setD((prev) => ({ ...prev, joined: v }))}
            />
            <OptionalDate
              id="w-left"
              inputRef={leftRef}
              label={t("attendance.workers.leftField")}
              value={d.left}
              min={d.joined || undefined}
              startOpen={focusLeft}
              onChange={(v) => setD((prev) => ({ ...prev, left: v }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-notes">
              {t("attendance.workers.notes")}
              {optional}
            </Label>
            <Input id="w-notes" value={d.notes} onChange={set("notes")} dir="auto" maxLength={500} />
          </div>
          <DialogFooter className="gap-2">
            {!editing && (
              <Button type="button" variant="outline" disabled={save.isPending} onClick={() => submit(true)}>
                {t("attendance.workers.addAnother")}
              </Button>
            )}
            <Button type="submit" disabled={save.isPending}>
              {t("attendance.workers.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** An optional date. A desktop date box shows today's date even when empty,
 * which reads as "set" — so an unset date is a button until someone wants it. */
function OptionalDate({
  id,
  label,
  value,
  onChange,
  min,
  startOpen = false,
  inputRef,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  startOpen?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(startOpen);
  React.useEffect(() => setOpen(startOpen), [startOpen]);
  const shown = open || value !== "";
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        <span className="font-normal text-muted-foreground"> ({t("attendance.workers.optional")})</span>
      </Label>
      {shown ? (
        <div className="flex gap-1.5">
          <Input
            id={id}
            ref={inputRef}
            type="date"
            value={value}
            min={min}
            onChange={(e) => onChange(e.target.value)}
            dir="ltr"
            autoFocus={open && value === ""}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${t("attendance.dialog.clear")} ${label}`}
            title={t("attendance.dialog.clear")}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            <X />
          </Button>
        </div>
      ) : (
        <Button
          id={id}
          type="button"
          variant="outline"
          className="w-full justify-start border-dashed font-normal text-muted-foreground"
          onClick={() => setOpen(true)}
        >
          <CalendarPlus />
          {t("attendance.workers.addDate")}
        </Button>
      )}
    </div>
  );
}
