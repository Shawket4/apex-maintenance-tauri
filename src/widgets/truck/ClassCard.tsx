import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, Tags } from "lucide-react";

import { commands, unwrap, type TruckRow } from "@/shared/api/client";
import { useAuth } from "@/shared/api/auth";
import { useClasses, useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { cn } from "@/shared/lib/cn";
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
import { Label } from "@/shared/ui/label";
import { ErrorState } from "@/shared/ui/query-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

/** The truck's maintenance class — the thing that decides which maintenance
 * plans apply to it. With no class nothing is tracked, so that case is a
 * loud call to action instead of a quiet grey label. */
export function ClassCard({ truck }: { truck: TruckRow }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const classes = useClasses();
  const [picking, setPicking] = useState(false);
  const [clearing, setClearing] = useState(false);
  const ar = i18n.language.startsWith("ar");
  // Classes and plans are a supervisor's job (the server refuses below 3).
  const canEdit = (user?.permission ?? 0) >= 3;

  const current = (classes.data ?? []).find((c) => c.id === truck.class_id);
  const currentName = current ? (ar ? current.name_ar : current.name_en) : truck.class_name_ar;

  const unassign = useDomainMutation(() => unwrap(commands.classUnassign(truck.id)), {
    onSuccess: () => {
      setClearing(false);
      notifySuccess(t("truck.classCleared"));
    },
    onError: notifyError,
  });

  const unclassified = !truck.class_id;

  return (
    <section
      id="class"
      className={cn(
        "scroll-mt-4 rounded-xl border bg-card p-4 shadow-sm sm:p-5",
        unclassified && "border-status-overdue/40 bg-status-overdue-soft",
      )}
    >
      <h2 className="flex items-center gap-2 text-base font-bold">
        <Tags className="h-4 w-4 text-muted-foreground" />
        {t("truck.classTitle")}
      </h2>

      {unclassified ? (
        <div className="mt-3 space-y-3">
          <p className="flex items-start gap-2 text-sm font-semibold text-status-overdue">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            {t("truck.noClassTitle")}
          </p>
          <p className="text-sm">{t("truck.noClassBody")}</p>
          {canEdit ? (
            <Button onClick={() => setPicking(true)}>{t("truck.chooseClass")}</Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t("truck.classNeedsSupervisor")}</p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="text-xl font-bold">{currentName ?? "—"}</div>
          <p className="text-sm text-muted-foreground">
            {truck.plan_count > 0 ? t("truck.classExplain") : t("truck.classNoPlans")}
          </p>
          {truck.plan_count === 0 && (
            <Link to="/settings" className="inline-block text-sm font-semibold text-primary underline">
              {t("truck.goToPlans")}
            </Link>
          )}
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setPicking(true)}>
                {t("truck.changeClass")}
              </Button>
              <Button variant="ghost" onClick={() => setClearing(true)}>
                {t("truck.clearClass")}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("truck.classNeedsSupervisor")}</p>
          )}
        </div>
      )}

      {picking && (
        <PickClassDialog truck={truck} currentName={currentName ?? null} onClose={() => setPicking(false)} />
      )}
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title={t("truck.clearClassTitle")}
        description={t("truck.clearClassBody", { name: currentName ?? "" })}
        confirmLabel={t("truck.clearClass")}
        destructive
        pending={unassign.isPending}
        onConfirm={() => unassign.mutate()}
      />
    </section>
  );
}

function PickClassDialog({
  truck,
  currentName,
  onClose,
}: {
  truck: TruckRow;
  currentName: string | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const classes = useClasses();
  const ar = i18n.language.startsWith("ar");
  const [classId, setClassId] = useState("");

  const assign = useDomainMutation(() => unwrap(commands.classAssign(truck.id, classId)), {
    onSuccess: () => {
      notifySuccess(t("truck.classSaved"));
      onClose();
    },
    onError: notifyError,
  });

  const options = (classes.data ?? []).filter((c) => c.id !== truck.class_id);
  const picked = options.find((c) => c.id === classId);
  const pickedName = picked ? (ar ? picked.name_ar : picked.name_en) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && !assign.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{truck.class_id ? t("truck.changeClass") : t("truck.chooseClass")}</DialogTitle>
          <DialogDescription>{t("truck.pickClassBody")}</DialogDescription>
        </DialogHeader>

        {classes.isError && classes.data === undefined ? (
          <ErrorState error={classes.error} onRetry={() => void classes.refetch()} retrying={classes.isFetching} />
        ) : classes.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("truck.classesLoading")}
          </div>
        ) : options.length === 0 ? (
          <div className="space-y-2 text-sm">
            <p>{truck.class_id ? t("truck.noOtherClasses") : t("truck.noClassesYet")}</p>
            <Link to="/settings" className="font-semibold text-primary underline">
              {t("truck.goToPlans")}
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="class-pick">{t("truck.classTitle")}</Label>
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger id="class-pick" className="w-full data-[size=default]:h-11">
                  <SelectValue placeholder={t("truck.classPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {ar ? c.name_ar : c.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {pickedName && (
              <p role="status" className="rounded-lg bg-status-due_soon-soft px-3 py-2.5 text-sm text-status-due_soon">
                {currentName
                  ? t("truck.classChangeWarn", { from: currentName, to: pickedName })
                  : t("truck.classSetWarn", { to: pickedName })}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={assign.isPending}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!classId || assign.isPending} onClick={() => assign.mutate()}>
            {assign.isPending && <Loader2 className="animate-spin" />}
            {currentName ? t("truck.classConfirmChange") : t("truck.classConfirmSet")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
