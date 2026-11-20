import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Gauge, Loader2, Pencil, RotateCcw, Trash2 } from "lucide-react";

import { commands, unwrap, type WoDetail } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtKm, fmtNumber, parseIntInput } from "@/shared/lib/numbers";
import { fmtAgo, fmtCairo } from "@/shared/lib/time";
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
import { NumberInput } from "@/shared/ui/number-input";

import { PendingBadge, StatusBadge } from "./parts";
import { PrintButton } from "./WoPrintSheet";

/** Who/what/when of the work order, its odometer, and the three things that
 * can happen to the order itself: close (the normal end), reopen, delete. */
export function WoHeader({ d }: { d: WoDetail }) {
  const { t, i18n } = useTranslation();
  const wo = d.wo;
  const isOpen = wo.status === "open";

  return (
    <div className="space-y-4 rounded-xl border bg-card px-4 py-4 shadow-sm sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              to="/trucks/$truckId"
              params={{ truckId: String(wo.vehicle_id) }}
              className="text-2xl font-bold underline-offset-4 [word-spacing:0.12em] hover:underline"
              title={t("wo.goTruck")}
            >
              <bdi>{wo.plate}</bdi>
            </Link>
            <StatusBadge status={wo.status} />
            {wo.pending && <PendingBadge />}
          </div>
          {wo.title?.trim() && (
            <div dir="auto" className="break-words text-sm font-semibold">
              {wo.title}
            </div>
          )}
          <div className="text-sm text-muted-foreground">
            {t("wo.openedOn", { date: fmtCairo(wo.opened_at, "YYYY/MM/DD HH:mm", i18n.language) })}
            <span className="text-xs"> ({fmtAgo(wo.opened_at, i18n.language)})</span>
          </div>
          {wo.closed_at && (
            <div className="text-sm text-muted-foreground">
              {t("wo.closedOn", { date: fmtCairo(wo.closed_at, "YYYY/MM/DD HH:mm", i18n.language) })}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{t("wo.odometerAtOpen")}</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-lg font-semibold tabular">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              {wo.odometer_at_open != null
                ? fmtKm(wo.odometer_at_open, i18n.language)
                : t("wo.odoMissing")}
            </span>
            <EditOdometer woId={wo.id} current={wo.odometer_at_open} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        {isOpen ? <CloseButton d={d} /> : <ReopenButton woId={wo.id} />}
        <PrintButton />
        <DeleteButton d={d} />
      </div>
    </div>
  );
}

function CloseButton({ d }: { d: WoDetail }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const close = useDomainMutation(() => unwrap(commands.woClose(d.wo.id)), {
    onSuccess: () => {
      setOpen(false);
      notifySuccess(t("wo.closedToast"));
    },
    onError: notifyError,
  });

  const n = (v: number) => fmtNumber(v, i18n.language);
  const undone = d.wo.task_count - d.wo.done_count;
  const nothingDone = d.wo.task_count === 0 && d.oil_changes.length === 0 && d.tire_ops.length === 0;

  return (
    <>
      <Button className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <CheckCircle2 />
        {t("wo.closeAction")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("wo.closeTitle")}
        description={t("wo.closeBody")}
        confirmLabel={t("wo.closeAction")}
        pending={close.isPending}
        onConfirm={() => close.mutate()}
      >
        <ul className="space-y-1 rounded-lg bg-muted px-3 py-2 text-sm tabular">
          <li>{t("wo.closeSumTasks", { done: n(d.wo.done_count), total: n(d.wo.task_count) })}</li>
          <li>{t("wo.closeSumOil", { n: n(d.oil_changes.length) })}</li>
          <li>{t("wo.closeSumTires", { n: n(d.tire_ops.length) })}</li>
        </ul>
        {undone > 0 && (
          <p className="rounded-lg bg-status-due_soon-soft px-3 py-2 text-sm text-status-due_soon">
            {t("wo.closeUndoneWarn", { n: n(undone) })}
          </p>
        )}
        {nothingDone && (
          <p className="rounded-lg bg-status-due_soon-soft px-3 py-2 text-sm text-status-due_soon">
            {t("wo.closeEmptyWarn")}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

/** A work order closed too early is reopened here; nothing is lost. */
function ReopenButton({ woId }: { woId: string }) {
  const { t } = useTranslation();
  const reopen = useDomainMutation(() => unwrap(commands.woReopen(woId)), {
    onSuccess: () => notifySuccess(t("wo.reopenedToast")),
    onError: notifyError,
  });
  return (
    <Button
      variant="secondary"
      className="w-full sm:w-auto"
      disabled={reopen.isPending}
      onClick={() => reopen.mutate()}
    >
      {reopen.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
      {t("wo.reopenAction")}
    </Button>
  );
}

/** For a work order opened on the wrong truck or opened twice. Refused by the
 * app once oil or tire work is on it — that work moved stock and tires. */
function DeleteButton({ d }: { d: WoDetail }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const hasWork = d.oil_changes.length > 0 || d.tire_ops.length > 0;

  const del = useDomainMutation(() => unwrap(commands.woDelete(d.wo.id)), {
    onSuccess: () => {
      setOpen(false);
      notifySuccess(t("wo.deletedToast"));
      void navigate({
        to: "/trucks/$truckId",
        params: { truckId: String(d.wo.vehicle_id) },
        replace: true,
      });
    },
    onError: notifyError,
  });

  return (
    <>
      <Button
        variant="ghost"
        className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive sm:ms-auto sm:w-auto"
        onClick={() => setOpen(true)}
      >
        <Trash2 />
        {t("wo.deleteAction")}
      </Button>
      {hasWork ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("wo.deleteBlockedTitle")}</DialogTitle>
              <DialogDescription>{t("wo.deleteBlockedBody")}</DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-1 ps-5 text-sm">
              {d.oil_changes.length > 0 && <li>{t("wo.deleteBlockedOil")}</li>}
              {d.tire_ops.length > 0 && <li>{t("wo.deleteBlockedTires")}</li>}
            </ul>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>{t("wo.understood")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={t("wo.deleteTitle")}
          description={t("wo.deleteBody", { n: fmtNumber(d.wo.task_count, i18n.language) })}
          confirmLabel={t("wo.deleteAction")}
          destructive
          pending={del.isPending}
          onConfirm={() => del.mutate()}
        >
          <p className="text-sm text-muted-foreground">{t("wo.deleteRefusedNote")}</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** The opening odometer is both an odometer reading for the truck and the km
 * baseline of every task done under the order, so a typo has to be fixable —
 * and an empty field must never wipe the reading. */
function EditOdometer({ woId, current }: { woId: string; current: number | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const parsed = parseIntInput(value);

  const save = useDomainMutation(
    (km: number) => unwrap(commands.woSetOdometer(woId, km)),
    {
      onSuccess: () => {
        setOpen(false);
        notifySuccess(t("wo.saved"));
      },
      onError: notifyError,
    },
  );

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setValue(current != null ? String(current) : "");
          setOpen(true);
        }}
      >
        <Pencil />
        {current != null ? t("wo.edit") : t("wo.odoAdd")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !save.isPending && setOpen(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("wo.editOdo")}</DialogTitle>
            <DialogDescription>{t("wo.editOdoHint")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (parsed != null && !save.isPending) save.mutate(parsed);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="wo-odo-edit">{t("wo.odoLabel")}</Label>
              <NumberInput id="wo-odo-edit" value={value} onValueChange={setValue} />
              {parsed == null && (
                <p className="text-xs text-muted-foreground">{t("wo.odoRequired")}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={save.isPending}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={parsed == null || parsed === current || save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" />}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
