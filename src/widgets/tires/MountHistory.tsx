import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Gauge, ListChecks, Undo2 } from "lucide-react";

import { commands, unwrap, type TireEventRow, type TireOpRow, type TireRow } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";

import { ts } from "./lib";
import { PositionLabel } from "./parts";
import { EditOdoDialog, ReasonDialog } from "./TireDialogs";

type Pending =
  | { kind: "odo"; op: TireOpRow }
  | { kind: "reason"; op: TireOpRow }
  | { kind: "undoDismount"; op: TireOpRow }
  | { kind: "undoMount"; op: TireOpRow };

/** Every time this tire was fitted: which truck, which wheel, when, the
 * odometer at fitting and removal, and why it came off — with the ways to
 * correct each of those. */
export function MountHistory({
  tire,
  mounts,
  events,
  onTireGone,
}: {
  tire: TireRow;
  mounts: TireOpRow[];
  events: TireEventRow[];
  /** The tire record itself was removed by undoing the mount that created it. */
  onTireGone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [pending, setPending] = useState<Pending | null>(null);
  const close = () => setPending(null);

  // Newest first.
  const rows = [...mounts].sort((a, b) => (ts(b.mounted_at) ?? 0) - (ts(a.mounted_at) ?? 0));

  // The LAST dismount is the only one whose reason still decides the tire's
  // status, and the only one that can be undone.
  const lastOff =
    tire.status === "mounted"
      ? null
      : rows
          .filter((m) => m.dismounted_at != null)
          .reduce<TireOpRow | null>(
            (best, m) => (best == null || (ts(m.dismounted_at) ?? 0) > (ts(best.dismounted_at) ?? 0) ? m : best),
            null,
          );
  const lastOffAt = ts(lastOff?.dismounted_at);
  // The same rule the app enforces: nothing happened to the tire since.
  const untouchedSince =
    lastOff != null &&
    lastOffAt != null &&
    !events.some((e) => (ts(e.occurred_at) ?? 0) >= lastOffAt) &&
    !rows.some((m) => m.assignment_id !== lastOff.assignment_id && (ts(m.mounted_at) ?? 0) >= lastOffAt);

  // A tire that exists only because of this fitting disappears with it.
  const bornHere = (op: TireOpRow) =>
    (op.mount_reason === "new" || op.mount_reason === "onboard") && mounts.length === 1 && events.length === 0;

  const undoDismount = useDomainMutation((id: string) => unwrap(commands.dismountUndo(id)), {
    onSuccess: () => {
      notifySuccess(t("tires.undoDismount.done"));
      close();
    },
    onError: (e) => {
      close();
      notifyError(e);
    },
  });
  const undoMount = useDomainMutation((op: TireOpRow) => unwrap(commands.mountUndo(op.assignment_id)), {
    onSuccess: (_d, op) => {
      notifySuccess(t("tires.undoMount.done"));
      close();
      if (bornHere(op)) onTireGone();
    },
    onError: (e) => {
      close();
      notifyError(e);
    },
  });

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        {t("tires.historyEmpty")}
      </p>
    );
  }

  const date = (iso: string | null) => fmtCairo(iso, "YYYY/MM/DD", lang);

  return (
    <>
      <ol className="space-y-3">
        {rows.map((m) => {
          const open = m.dismounted_at == null;
          const isLastOff = lastOff?.assignment_id === m.assignment_id;
          return (
            <li key={m.assignment_id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {m.plate ? (
                  m.vehicle_id != null ? (
                    <Link
                      to="/trucks/$truckId"
                      params={{ truckId: String(m.vehicle_id) }}
                      className="font-bold text-primary underline-offset-4 hover:underline"
                    >
                      <bdi>{m.plate}</bdi>
                    </Link>
                  ) : (
                    <bdi className="font-bold">{m.plate}</bdi>
                  )
                ) : (
                  <span className="font-bold text-muted-foreground">{t("tires.unknownTruck")}</span>
                )}
                <PositionLabel code={m.position_code} className="text-sm" />
                {open && <Badge>{t("tires.stillOn")}</Badge>}
                {m.pending && <Badge variant="outline">{t("tires.pending")}</Badge>}
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-semibold">{t("tires.mountedLabel")}</dt>
                  <dd className="tabular">{date(m.mounted_at)}</dd>
                  <dd className="text-muted-foreground">
                    {t("tires.odoAt")}{" "}
                    <span className="tabular text-foreground">
                      {m.mounted_odometer != null ? fmtNumber(m.mounted_odometer, lang) : t("tires.odoMissing")}
                    </span>
                  </dd>
                  {m.mount_reason && (
                    <dd className="text-muted-foreground">{t(`tires.mountReason.${m.mount_reason}`)}</dd>
                  )}
                </div>
                <div>
                  <dt className="font-semibold">{t("tires.dismountedLabel")}</dt>
                  {open ? (
                    <dd className="text-muted-foreground">{t("tires.notYetOff")}</dd>
                  ) : (
                    <>
                      <dd className="tabular">{date(m.dismounted_at)}</dd>
                      <dd className="text-muted-foreground">
                        {t("tires.odoAt")}{" "}
                        <span className="tabular text-foreground">
                          {m.dismounted_odometer != null
                            ? fmtNumber(m.dismounted_odometer, lang)
                            : t("tires.odoMissing")}
                        </span>
                      </dd>
                      <dd className="text-muted-foreground">
                        {t("tires.reasonLabel")}{" "}
                        <span className="text-foreground">
                          {m.dismount_reason ? t(`diagram.reason.${m.dismount_reason}`) : t("tires.reasonMissing")}
                        </span>
                      </dd>
                    </>
                  )}
                </div>
              </dl>

              <p className="mt-3 text-sm">
                {m.km_run != null ? (
                  <>
                    {open ? t("tires.kmRunSoFar") : t("tires.kmRun")}{" "}
                    <span className="font-semibold tabular">{fmtKm(m.km_run, lang)}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">{t("tires.kmRunUnknown")}</span>
                )}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setPending({ kind: "odo", op: m })}>
                  <Gauge />
                  {t("tires.editOdo.open")}
                </Button>
                {open && (
                  <Button variant="outline" size="sm" onClick={() => setPending({ kind: "undoMount", op: m })}>
                    <Undo2 />
                    {t("tires.undoMount.open")}
                  </Button>
                )}
                {isLastOff && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setPending({ kind: "reason", op: m })}>
                      <ListChecks />
                      {t("tires.reason.open")}
                    </Button>
                    {untouchedSince && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPending({ kind: "undoDismount", op: m })}
                      >
                        <Undo2 />
                        {t("tires.undoDismount.open")}
                      </Button>
                    )}
                  </>
                )}
              </div>
              {isLastOff && !untouchedSince && (
                <p className="mt-2 text-sm text-muted-foreground">{t("tires.undoDismount.notPossible")}</p>
              )}
            </li>
          );
        })}
      </ol>

      {pending?.kind === "odo" && <EditOdoDialog op={pending.op} onClose={close} />}
      {pending?.kind === "reason" && (
        <ReasonDialog op={pending.op} statusFollows={untouchedSince} onClose={close} />
      )}
      {pending?.kind === "undoDismount" && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t("tires.undoDismount.title")}
          description={t("tires.undoDismount.body", {
            plate: pending.op.plate ?? t("tires.unknownTruck"),
          })}
          confirmLabel={t("tires.undoDismount.confirm")}
          pending={undoDismount.isPending}
          onConfirm={() => undoDismount.mutate(pending.op.assignment_id)}
        />
      )}
      {pending?.kind === "undoMount" && (
        <ConfirmDialog
          open
          destructive
          onOpenChange={(o) => !o && close()}
          title={t("tires.undoMount.title")}
          description={
            !bornHere(pending.op)
              ? t("tires.undoMount.bodyUsed")
              : pending.op.mount_reason === "new"
                ? t("tires.undoMount.bodyNew")
                : t("tires.undoMount.bodyOnboard")
          }
          confirmLabel={t("tires.undoMount.confirm")}
          pending={undoMount.isPending}
          onConfirm={() => undoMount.mutate(pending.op)}
        />
      )}
    </>
  );
}
