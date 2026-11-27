import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CalendarCheck, ChevronLeft, ChevronRight, LogIn, LogOut, MoreHorizontal, Search, UserPlus } from "lucide-react";

import { commands, unwrap } from "@/shared/api/client";
import type { AttendanceDayRow, AttendanceDayView, AttendanceMarkInput } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { matches } from "@/shared/lib/normalize";
import { fmtNumber } from "@/shared/lib/numbers";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { StatusChip } from "@/shared/ui/status-chip";
import { EmptyState, ListCard } from "@/widgets/layout/PageShell";
import { PendingBadge } from "@/widgets/wo/parts";

import { ClockDialog, type ClockTarget } from "./ClockDialog";
import { DayDialog, type DayTarget } from "./DayDialog";
import { KIND_TONE, addDays, cairoInstant, dayTitle, nowCairoHhmm, timeOf } from "./lib";

/** The day's register: the day bar, the counts, the bulk actions, one row per worker. */
export function DayRegister({ v, onGoTo }: { v: AttendanceDayView; onGoTo: (date: string) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [target, setTarget] = React.useState<DayTarget | null>(null);
  const [clock, setClock] = React.useState<ClockTarget | null>(null);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  const goTo = onGoTo;

  const mark = useDomainMutation((inp: AttendanceMarkInput) => unwrap(commands.attendanceMark(inp)), {
    onError: notifyError,
    onSettled: () => setBusy(null),
  });

  const edit = (r: AttendanceDayRow) =>
    setTarget({
      workerId: r.worker_id,
      name: r.name,
      job: r.job,
      date: v.date,
      status: r.status,
      checkInAt: r.check_in_at,
      checkOutAt: r.check_out_at,
      note: r.note,
    });

  const absent = (r: AttendanceDayRow) => {
    setBusy(r.worker_id);
    mark.mutate({
      worker_id: r.worker_id,
      work_date: v.date,
      status: "absent",
      check_in_at: null,
      check_out_at: null,
      note: r.note,
    });
  };

  // Checking in or out always asks for the time (it starts from now).
  const checkIn = (r: AttendanceDayRow) => setClock({ mode: "in", row: r, date: v.date });
  const checkOut = (r: AttendanceDayRow) => setClock({ mode: "out", row: r, date: v.date });

  const n = (x: number) => fmtNumber(x, lang);
  const unmarked = v.rows.filter((r) => r.status == null);
  const shown = search.trim() ? v.rows.filter((r) => matches(`${r.name} ${r.job ?? ""}`, search)) : v.rows;
  const total = v.rows.length;
  const pills: { key: string; count: number }[] = [
    { key: "present", count: v.counts.present },
    { key: "absent", count: v.counts.absent },
    { key: "leave", count: v.counts.leave },
    { key: "sick", count: v.counts.sick },
    { key: "unmarked", count: v.counts.unmarked },
  ].filter((p) => p.count > 0 || p.key === "present");

  return (
    <div className="space-y-5">
      {/* The day */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 shadow-sm">
        <Button variant="ghost" size="icon" aria-label={t("attendance.day.prev")} title={t("attendance.day.prev")} onClick={() => goTo(addDays(v.date, -1))}>
          <ChevronLeft className="rtl:-scale-x-100" />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <h2 className="truncate text-base font-bold">{dayTitle(v.date, lang)}</h2>
          {v.is_today && <div className="text-xs font-semibold text-primary">{t("attendance.day.today")}</div>}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("attendance.day.next")}
          title={t("attendance.day.next")}
          onClick={() => goTo(addDays(v.date, 1))}
          disabled={v.is_today}
        >
          <ChevronRight className="rtl:-scale-x-100" />
        </Button>
        <div className="flex w-full items-center gap-2 border-t pt-2 sm:w-auto sm:border-s sm:border-t-0 sm:ps-2 sm:pt-0">
          <Input
            type="date"
            aria-label={t("attendance.day.pick")}
            value={v.date}
            max={v.today}
            onChange={(e) => e.target.value && goTo(e.target.value)}
            dir="ltr"
            className="h-10 flex-1 sm:w-40"
          />
          {!v.is_today && (
            <Button variant="outline" onClick={() => goTo(v.today)}>
              {t("attendance.day.today")}
            </Button>
          )}
        </div>
      </div>

      {!v.has_workers ? (
        <EmptyState className="space-y-4 p-10">
          <div>{t("attendance.workers.empty")}</div>
          <Button asChild>
            <Link to="/attendance/workers">
              <UserPlus />
              {t("attendance.workers.add")}
            </Link>
          </Button>
        </EmptyState>
      ) : total === 0 ? (
        <EmptyState>{t("attendance.day.noMatch")}</EmptyState>
      ) : (
        <>
          {/* At a glance + the bulk actions */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <ul aria-label={t("attendance.day.countsLabel")} className="flex flex-wrap gap-2">
              {pills.map((p) => (
                <li key={p.key}>
                  <span
                    className={cn(
                      "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold tabular",
                      KIND_TONE[p.key],
                    )}
                  >
                    <span className="text-sm font-bold">
                      {p.key === "present" ? `${n(p.count)} / ${n(total)}` : n(p.count)}
                    </span>
                    {t(`attendance.status.${p.key}`)}
                  </span>
                </li>
              ))}
            </ul>
            {unmarked.length > 0 && (
              <Button variant="outline" onClick={() => setBulkOpen(true)}>
                <CalendarCheck />
                {t("attendance.bulk.allPresent")}
              </Button>
            )}
          </div>

          {total > 8 && (
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("attendance.day.searchPlaceholder")}
                aria-label={t("attendance.day.searchLabel")}
                dir="auto"
                className="bg-card ps-9"
              />
            </div>
          )}

          {shown.length === 0 ? (
            <EmptyState>{t("attendance.day.noMatch")}</EmptyState>
          ) : (
            <ListCard>
              {shown.map((r) => (
                <WorkerDayRow
                  key={r.worker_id}
                  r={r}
                  isToday={v.is_today}
                  busy={busy === r.worker_id}
                  onEdit={() => edit(r)}
                  onCheckIn={() => checkIn(r)}
                  onAbsent={() => absent(r)}
                  onCheckOut={() => checkOut(r)}
                />
              ))}
            </ListCard>
          )}
        </>
      )}

      <DayDialog target={target} onOpenChange={(o) => !o && setTarget(null)} />
      <ClockDialog target={clock} onClose={() => setClock(null)} />
      <BulkDialog open={bulkOpen} v={v} unmarked={unmarked} onClose={() => setBulkOpen(false)} />
    </div>
  );
}

function WorkerDayRow({
  r,
  isToday,
  busy,
  onEdit,
  onCheckIn,
  onAbsent,
  onCheckOut,
}: {
  r: AttendanceDayRow;
  isToday: boolean;
  busy: boolean;
  onEdit: () => void;
  onCheckIn: () => void;
  onAbsent: () => void;
  onCheckOut: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const kind = r.status ?? "unmarked";

  const details: string[] = [];
  if (r.status === "present") {
    details.push(r.check_in_at ? t("attendance.day.inAt", { time: timeOf(r.check_in_at, lang) }) : t("attendance.day.noIn"));
    if (r.check_out_at) details.push(t("attendance.day.outAt", { time: timeOf(r.check_out_at, lang) }));
  } else if (r.job) {
    details.push(r.job);
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-[18px]">
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${r.name} — ${t("attendance.day.edit")}`}
      >
        <span
          className={cn(
            "grid h-10 w-10 flex-none place-items-center rounded-full text-sm font-bold",
            KIND_TONE[kind] || "bg-muted",
          )}
          aria-hidden
        >
          {r.name.trim().charAt(0)}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{r.name}</span>
          <span className="block truncate text-xs text-muted-foreground tabular">
            {details.join(" · ") || (r.job ?? "")}
          </span>
          {r.note && <span className="block truncate text-xs text-muted-foreground">“{r.note}”</span>}
        </span>
      </button>

      <div className="flex flex-wrap items-center gap-2 sm:flex-none sm:justify-end">
        {r.pending && <PendingBadge />}
        {r.status == null ? (
          <>
            <Button
              onClick={onCheckIn}
              disabled={busy}
              className="min-w-24 flex-1 bg-status-ok text-white hover:bg-status-ok/90 sm:flex-none"
            >
              <LogIn className="rtl:-scale-x-100" />
              {t("attendance.day.checkIn")}
            </Button>
            <Button
              variant="outline"
              onClick={onAbsent}
              disabled={busy}
              className="min-w-20 flex-1 text-status-overdue sm:flex-none"
            >
              {t("attendance.day.absent")}
            </Button>
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label={t("attendance.day.more")} title={t("attendance.day.more")}>
              <MoreHorizontal />
            </Button>
          </>
        ) : (
          <>
            <StatusChip tone={KIND_TONE[r.status] ?? ""} size="md">
              {t(`attendance.status.${r.status}`)}
            </StatusChip>
            {r.missing_out && (
              <StatusChip tone={KIND_TONE.unmarked} size="md">
                {t("attendance.day.missingOut")}
              </StatusChip>
            )}
            {r.status === "present" && !r.check_out_at && (isToday || r.missing_out) && (
              <Button variant="outline" onClick={onCheckOut} disabled={busy}>
                <LogOut className="rtl:-scale-x-100" />
                {t("attendance.day.checkOut")}
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label={t("attendance.day.edit")} title={t("attendance.day.edit")}>
              <MoreHorizontal />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Everyone not marked yet, present at one check-in time. */
function BulkDialog({
  open,
  v,
  unmarked,
  onClose,
}: {
  open: boolean;
  v: AttendanceDayView;
  unmarked: AttendanceDayRow[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [time, setTime] = React.useState(nowCairoHhmm);
  React.useEffect(() => {
    if (open) setTime(nowCairoHhmm());
  }, [open]);

  const run = useDomainMutation(
    () =>
      unwrap(
        commands.attendanceMarkMany(
          unmarked.map((r) => ({
            worker_id: r.worker_id,
            work_date: v.date,
            status: "present",
            check_in_at: time ? cairoInstant(v.date, time) : null,
            check_out_at: null,
            note: null,
          })),
        ),
      ),
    {
      onSuccess: (count) => {
        notifySuccess(t("attendance.bulk.done", { n: fmtNumber(count, i18n.language) }));
        onClose();
      },
      onError: notifyError,
    },
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("attendance.bulk.allPresentTitle")}</DialogTitle>
          <DialogDescription>
            {t("attendance.bulk.allPresentBody", { n: fmtNumber(unmarked.length, i18n.language) })}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-3 text-sm">
          {unmarked.map((r) => (
            <li key={r.worker_id} className="truncate">
              {r.name}
            </li>
          ))}
        </ul>
        <div className="space-y-1.5">
          <Label htmlFor="bulk-time">{t("attendance.bulk.time")}</Label>
          <Input id="bulk-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} dir="ltr" className="w-36 tabular" />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending || unmarked.length === 0}>
            {t("attendance.bulk.allPresent")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
