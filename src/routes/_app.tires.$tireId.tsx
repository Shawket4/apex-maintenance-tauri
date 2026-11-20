import { useState } from "react";
import { Link, createFileRoute, useCanGoBack, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Ban, PackageCheck, Pencil, Recycle, Trash2, Undo2, Wrench } from "lucide-react";

import { commands, unwrap, type TireFile } from "@/shared/api/client";
import { useDomainMutation, useTire } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { TIRE_BADGE } from "@/shared/lib/status";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { QueryState } from "@/shared/ui/query-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { StatusChip } from "@/shared/ui/status-chip";
import { PageShell } from "@/widgets/layout/PageShell";
import { LIFE_ACTIONS, tireName, type LifeAction } from "@/widgets/tires/lib";
import { MountHistory } from "@/widgets/tires/MountHistory";
import { Heading, PositionLabel } from "@/widgets/tires/parts";
import { LifecycleDialog, TireEditDialog } from "@/widgets/tires/TireDialogs";

export const Route = createFileRoute("/_app/tires/$tireId")({
  component: TireFilePage,
});

const ACTION_ICON: Record<LifeAction["id"], typeof Wrench> = {
  sendRepair: Wrench,
  backFromRepair: Undo2,
  sendRetread: Recycle,
  backFromRetread: PackageCheck,
  scrap: Ban,
  unscrap: Undo2,
};

function TireFilePage() {
  const { t } = useTranslation();
  const { tireId } = Route.useParams();
  const tire = useTire(tireId);

  return (
    <PageShell>
      <BackLink />
      <QueryState
        query={tire}
        skeleton={
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        }
      >
        {(d) =>
          d ? (
            <TireFileBody d={d} />
          ) : (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              <p>{t("tires.notFoundLong")}</p>
              <Button asChild variant="outline" className="mt-4">
                <Link to="/tires">{t("tires.backToList")}</Link>
              </Button>
            </div>
          )
        }
      </QueryState>
    </PageShell>
  );
}

function TireFileBody({ d }: { d: TireFile }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = Route.useNavigate();
  const tire = d.tire;
  const mounted = tire.status === "mounted";
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [action, setAction] = useState<LifeAction | null>(null);

  const goToList = () => void navigate({ to: "/tires", replace: true });

  const remove = useDomainMutation(() => unwrap(commands.tireDelete(tire.id)), {
    onSuccess: () => {
      notifySuccess(t("tires.delete.done"));
      setDeleting(false);
      goToList();
    },
    onError: (e) => {
      setDeleting(false);
      notifyError(e);
    },
  });

  const actions = LIFE_ACTIONS[tire.status] ?? [];

  return (
    <>
      <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-xl font-bold">
            <bdi>{tireName(tire)}</bdi>
          </h1>
          <StatusChip tone={TIRE_BADGE[tire.status] ?? ""} size="md">
            {t(`tires.status.${tire.status}`)}
          </StatusChip>
          {tire.pending && <Badge variant="outline">{t("tires.pending")}</Badge>}
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t("tires.form.dot")}>
            {tire.dot_code ? <bdi dir="ltr">{tire.dot_code}</bdi> : t("tires.noDot")}
          </Fact>
          <Fact label={t("tires.whereLabel")}>
            {tire.mounted_plate ? (
              <>
                {t("tires.onTruck")}{" "}
                {tire.mounted_vehicle_id != null ? (
                  <Link
                    to="/trucks/$truckId"
                    params={{ truckId: String(tire.mounted_vehicle_id) }}
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    <bdi>{tire.mounted_plate}</bdi>
                  </Link>
                ) : (
                  <bdi className="font-semibold">{tire.mounted_plate}</bdi>
                )}
                <PositionLabel code={tire.mounted_position_code} className="block" />
              </>
            ) : (
              t(`tires.where.${tire.status}`, t("tires.where.other"))
            )}
          </Fact>
          <Fact label={t("tires.totalKmLabel")}>
            <span className="font-semibold tabular">{fmtKm(tire.total_km, lang)}</span>
            {tire.km_incomplete && (
              <>
                <span className="ms-1.5 rounded-full bg-status-due_soon-soft px-2 py-0.5 text-xs font-semibold text-status-due_soon">
                  {t("tires.approx")}
                </span>
                <span className="block text-muted-foreground">{t("tires.approxWhy")}</span>
              </>
            )}
          </Fact>
          <Fact label={t("tires.edit.baseKm")}>
            <span className="tabular">{fmtKm(tire.base_km, lang)}</span>
          </Fact>
          <Fact label={t("tires.originLabel")}>{t(`tires.origin.${tire.origin}`)}</Fact>
          <Fact label={t("tires.retreads")}>
            <span className="tabular">{fmtNumber(tire.retread_count, lang)}</span>
          </Fact>
          {tire.notes && (
            <Fact label={t("tires.form.notes")} className="sm:col-span-2 lg:col-span-3">
              <bdi className="whitespace-pre-wrap">{tire.notes}</bdi>
            </Fact>
          )}
        </dl>

        <div className="mt-5 border-t pt-4">
          <h2 className="mb-2 text-sm font-semibold">{t("tires.life.heading")}</h2>
          {mounted ? (
            <p className="text-sm text-muted-foreground">{t("tires.life.mountedFirst")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => {
                const Icon = ACTION_ICON[a.id];
                return (
                  <Button
                    key={a.id}
                    variant={a.id === "scrap" ? "destructive" : "secondary"}
                    onClick={() => setAction(a)}
                  >
                    <Icon />
                    {t(`tires.life.${a.id}.label`)}
                  </Button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 border-t pt-4">
          <h2 className="mb-2 text-sm font-semibold">{t("tires.fix.heading")}</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil />
              {t("tires.edit.open")}
            </Button>
            <Button variant="outline" disabled={mounted} onClick={() => setDeleting(true)}>
              <Trash2 />
              {t("tires.delete.open")}
            </Button>
          </div>
          {mounted && <p className="mt-2 text-sm text-muted-foreground">{t("tires.delete.mounted")}</p>}
        </div>
      </div>

      <section>
        <Heading>{t("tires.history")}</Heading>
        <MountHistory tire={tire} mounts={d.mounts} events={d.events} onTireGone={goToList} />
      </section>

      <section>
        <Heading>{t("tires.events")}</Heading>
        {d.events.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("tires.eventsEmpty")}
          </p>
        ) : (
          <ol className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
            {d.events.map((ev) => (
              <li key={ev.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                  <span className="font-semibold">
                    {t(`tires.eventType.${ev.event_type}`, t("tires.eventType.other"))}
                  </span>
                  <span className="tabular text-muted-foreground">
                    {fmtCairo(ev.occurred_at, "YYYY/MM/DD HH:mm", lang)}
                  </span>
                </div>
                {ev.from_status && ev.to_status ? (
                  <p className="text-muted-foreground">
                    {t("tires.fromTo", {
                      from: t(`tires.status.${ev.from_status}`),
                      to: t(`tires.status.${ev.to_status}`),
                    })}
                  </p>
                ) : ev.to_status ? (
                  <p className="text-muted-foreground">
                    {t("tires.became", { to: t(`tires.status.${ev.to_status}`) })}
                  </p>
                ) : null}
                {ev.notes && (
                  <p className="mt-1">
                    <span className="text-muted-foreground">{t("tires.noteShown")}</span> <bdi>{ev.notes}</bdi>
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {editing && <TireEditDialog tire={tire} onClose={() => setEditing(false)} />}
      {action && <LifecycleDialog tireId={tire.id} action={action} onClose={() => setAction(null)} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        destructive
        title={t("tires.delete.title")}
        description={tire.origin === "shipment" ? t("tires.delete.bodyShipment") : t("tires.delete.body")}
        confirmLabel={t("tires.delete.confirm")}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

function Fact({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** History-aware back: returns to wherever the user actually came from
 * (truck diagram with its selection intact, search results, …); falls back
 * to the tires list on a cold entry. */
function BackLink() {
  const { t } = useTranslation();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const cls =
    "inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground pointer-coarse:min-h-11";
  if (canGoBack) {
    return (
      <button type="button" onClick={() => router.history.back()} className={cls}>
        <ArrowRight className="h-4 w-4 ltr:-scale-x-100" /> {t("common.back")}
      </button>
    );
  }
  return (
    <Link to="/tires" className={cls}>
      <ArrowRight className="h-4 w-4 ltr:-scale-x-100" /> {t("tires.backToList")}
    </Link>
  );
}
