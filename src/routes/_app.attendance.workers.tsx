import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { UserPlus, Users } from "lucide-react";

import { commands, unwrap } from "@/shared/api/client";
import type { AttendanceWorkerRow } from "@/shared/api/client";
import { useAttendanceWorkers, useDomainMutation } from "@/shared/api/queries";
import { fmtNumber } from "@/shared/lib/numbers";
import { notifyError } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { QueryState } from "@/shared/ui/query-state";
import { AttendanceTabs } from "@/widgets/attendance/AttendanceTabs";
import { EmployeePicker } from "@/widgets/attendance/EmployeePicker";
import { WorkerDialog } from "@/widgets/attendance/WorkerDialog";
import { WorkerRow } from "@/widgets/attendance/WorkerRow";
import { EmptyState, ListCard, PageShell, Section } from "@/widgets/layout/PageShell";

export const Route = createFileRoute("/_app/attendance/workers")({
  component: AttendanceWorkersPage,
});

/** Who is on the garage's list: typed in by name, or picked from Falcon. */
function AttendanceWorkersPage() {
  const { t, i18n } = useTranslation();
  const workers = useAttendanceWorkers();
  const [adding, setAdding] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [editing, setEditing] = React.useState<{ w: AttendanceWorkerRow; focusLeft: boolean } | null>(null);
  const [deleting, setDeleting] = React.useState<AttendanceWorkerRow | null>(null);
  const [hasDays, setHasDays] = React.useState<AttendanceWorkerRow | null>(null);

  const remove = useDomainMutation((id: string) => unwrap(commands.workerDelete(id)), {
    onSuccess: () => setDeleting(null),
    onError: (e) => {
      setDeleting(null);
      notifyError(e);
    },
  });

  const askDelete = (w: AttendanceWorkerRow) => (w.day_count > 0 ? setHasDays(w) : setDeleting(w));

  return (
    <PageShell
      title={t("attendance.title")}
      subtitle={t("attendance.subtitle")}
      actions={
        <>
          <Button variant="outline" onClick={() => setPicking(true)}>
            <Users />
            {t("attendance.workers.fromFalcon")}
          </Button>
          <Button onClick={() => setAdding(true)}>
            <UserPlus />
            {t("attendance.workers.add")}
          </Button>
        </>
      }
    >
      <AttendanceTabs />
      <QueryState query={workers}>
        {(all) => {
          const current = all.filter((w) => w.current);
          const left = all.filter((w) => !w.current);
          if (all.length === 0) {
            return (
              <EmptyState className="space-y-4 p-10">
                <div>{t("attendance.workers.empty")}</div>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => setAdding(true)}>
                    <UserPlus />
                    {t("attendance.workers.add")}
                  </Button>
                  <Button variant="outline" onClick={() => setPicking(true)}>
                    <Users />
                    {t("attendance.workers.fromFalcon")}
                  </Button>
                </div>
              </EmptyState>
            );
          }
          const list = (rows: AttendanceWorkerRow[]) => (
            <ListCard>
              {rows.map((w) => (
                <WorkerRow
                  key={w.id}
                  w={w}
                  onEdit={() => setEditing({ w, focusLeft: false })}
                  onDelete={() => askDelete(w)}
                />
              ))}
            </ListCard>
          );
          return (
            <div className="space-y-6">
              {current.length > 0 && (
                <Section title={`${t("attendance.workers.current")} (${fmtNumber(current.length, i18n.language)})`}>{list(current)}</Section>
              )}
              {left.length > 0 && (
                <Section title={`${t("attendance.workers.left")} (${fmtNumber(left.length, i18n.language)})`}>{list(left)}</Section>
              )}
            </div>
          );
        }}
      </QueryState>

      <WorkerDialog open={adding} onOpenChange={setAdding} />
      <WorkerDialog
        open={editing != null}
        onOpenChange={(o) => !o && setEditing(null)}
        worker={editing?.w}
        focusLeft={editing?.focusLeft}
      />
      <EmployeePicker open={picking} onOpenChange={setPicking} onTypeInstead={() => setAdding(true)} />
      <ConfirmDialog
        open={deleting != null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("attendance.workers.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("attendance.workers.deleteBody")}
        confirmLabel={t("attendance.workers.delete")}
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
      <ConfirmDialog
        open={hasDays != null}
        onOpenChange={(o) => !o && setHasDays(null)}
        title={t("attendance.workers.deleteTitle", { name: hasDays?.name ?? "" })}
        description={t("attendance.workers.hasDays")}
        confirmLabel={t("attendance.workers.setLeft")}
        onConfirm={() => {
          if (hasDays) setEditing({ w: hasDays, focusLeft: true });
          setHasDays(null);
        }}
      />
    </PageShell>
  );
}
