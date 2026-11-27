import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RefreshCw, Search } from "lucide-react";

import { commands, unwrap } from "@/shared/api/client";
import type { AttendanceEmployeeRow } from "@/shared/api/client";
import { useAttendanceEmployees, useDomainMutation } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { matches } from "@/shared/lib/normalize";
import { fmtNumber } from "@/shared/lib/numbers";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

/** Pick workers from Falcon's employees. Refreshes the list when it opens;
 * an account Falcon will not show the list to is pointed at typing names. */
export function EmployeePicker({
  open,
  onOpenChange,
  onTypeInstead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTypeInstead: () => void;
}) {
  const { t, i18n } = useTranslation();
  const employees = useAttendanceEmployees();
  const [q, setQ] = React.useState("");
  const [picked, setPicked] = React.useState<Set<number>>(new Set());

  const refresh = useMutation({
    mutationFn: () => unwrap(commands.attendanceEmployeesRefresh()),
    onSuccess: () => void employees.refetch(),
  });
  const { mutate: refreshNow } = refresh;
  React.useEffect(() => {
    if (!open) return;
    setQ("");
    setPicked(new Set());
    refreshNow();
  }, [open, refreshNow]);

  const add = useDomainMutation(
    (rows: AttendanceEmployeeRow[]) =>
      unwrap(
        commands.workersAddMany(
          rows.map((e) => ({
            name: e.name,
            job: null,
            phone: null,
            falcon_employee_id: e.id,
            joined_on: null,
            left_on: null,
            notes: null,
          })),
        ),
      ),
    {
      onSuccess: (ids) => {
        notifySuccess(t("attendance.workers.addedMany", { n: fmtNumber(ids.length, i18n.language) }));
        onOpenChange(false);
      },
      onError: notifyError,
    },
  );

  const all = employees.data ?? [];
  const shown = q.trim() ? all.filter((e) => matches(e.name, q)) : all;
  const isSuggested = (e: AttendanceEmployeeRow) => e.looks_garage && e.is_active && !e.added;
  const suggested = shown.filter(isSuggested);
  const others = shown.filter((e) => !isSuggested(e));
  const unavailable = refresh.data?.available === false;
  const failed = refresh.isError && all.length === 0;
  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (e: AttendanceEmployeeRow) => {
    const id = `emp-${e.id}`;
    return (
      <label
        key={e.id}
        htmlFor={id}
        className={cn(
          "flex min-h-12 items-center gap-3 px-4 py-2",
          e.added ? "opacity-60" : "cursor-pointer hover:bg-primary/[0.03]",
        )}
      >
        <Checkbox
          id={id}
          checked={e.added || picked.has(e.id)}
          disabled={e.added}
          onCheckedChange={() => toggle(e.id)}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{e.name}</span>
          {e.kind && <span className="block truncate text-xs text-muted-foreground">{e.kind}</span>}
        </span>
        {e.added && <Badge variant="outline">{t("attendance.picker.added")}</Badge>}
        {!e.added && !e.is_active && <Badge variant="outline">{t("attendance.picker.inactive")}</Badge>}
      </label>
    );
  };

  const typeInstead = (
    <Button
      variant="outline"
      onClick={() => {
        onOpenChange(false);
        onTypeInstead();
      }}
    >
      {t("attendance.picker.typeInstead")}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(720px,calc(100dvh-2rem))] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("attendance.picker.title")}</DialogTitle>
          <DialogDescription>{t("attendance.picker.subtitle")}</DialogDescription>
        </DialogHeader>

        {unavailable || failed ? (
          <div className="space-y-4 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            <p>{unavailable ? t("attendance.picker.unavailable") : t("attendance.picker.loadFailed")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {typeInstead}
              {failed && (
                <Button variant="ghost" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                  <RefreshCw className={refresh.isPending ? "animate-spin" : undefined} />
                  {t("attendance.picker.refresh")}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("attendance.picker.search")}
                  aria-label={t("attendance.picker.search")}
                  dir="auto"
                  className="ps-9"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("attendance.picker.refresh")}
                title={t("attendance.picker.refresh")}
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
              >
                <RefreshCw className={refresh.isPending ? "animate-spin" : undefined} />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border">
              {all.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {refresh.isPending ? "…" : t("attendance.picker.none")}
                </p>
              ) : shown.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">{t("attendance.picker.noMatch")}</p>
              ) : (
                <>
                  {suggested.length > 0 && (
                    <div>
                      <div className="sticky top-0 z-10 border-b bg-muted/80 px-4 py-1.5 text-xs font-bold backdrop-blur">
                        {t("attendance.picker.suggested")}
                      </div>
                      <div className="divide-y">{suggested.map(row)}</div>
                    </div>
                  )}
                  {others.length > 0 && (
                    <div>
                      {suggested.length > 0 && (
                        <div className="sticky top-0 z-10 border-y bg-muted/80 px-4 py-1.5 text-xs font-bold backdrop-blur">
                          {t("attendance.picker.others")}
                        </div>
                      )}
                      <div className="divide-y">{others.map(row)}</div>
                    </div>
                  )}
                </>
              )}
            </div>

            <DialogFooter className="gap-2">
              {typeInstead}
              <Button
                disabled={picked.size === 0 || add.isPending}
                onClick={() => add.mutate(all.filter((e) => picked.has(e.id)))}
              >
                {t("attendance.picker.addN", { n: fmtNumber(picked.size, i18n.language) })}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
