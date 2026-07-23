import { Link, createFileRoute, useCanGoBack, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { ArrowRight, Wrench, Recycle, PackageCheck, Ban, Undo2, Pencil } from "lucide-react";

import { commands, unwrap, type TireOpRow } from "@/shared/api/client";
import { useDomainMutation, useTire } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { TIRE_BADGE } from "@/shared/lib/status";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Skeleton } from "@/shared/ui/skeleton";
import { EmptyState, ListCard, PageShell, Section } from "@/widgets/layout/PageShell";

export const Route = createFileRoute("/_app/tires/$tireId")({
  component: TireFilePage,
});

/** Lifecycle transitions allowed from each non-mounted status. Mount/dismount
 * happen only on the diagram (they carry position + WO context). */
const TRANSITIONS: Record<
  string,
  { to: string; event: string; key: string; icon: typeof Wrench }[]
> = {
  in_stock_used: [
    { to: "in_repair", event: "repair_out", key: "tires.actions.sendRepair", icon: Wrench },
    { to: "retreading", event: "retread", key: "tires.actions.sendRetread", icon: Recycle },
    { to: "scrapped", event: "scrap", key: "tires.actions.scrap", icon: Ban },
  ],
  in_repair: [
    { to: "in_stock_used", event: "repair_in", key: "tires.actions.backFromRepair", icon: Undo2 },
    { to: "scrapped", event: "scrap", key: "tires.actions.scrap", icon: Ban },
  ],
  retreading: [
    { to: "in_stock_used", event: "restock", key: "tires.actions.backFromRetread", icon: PackageCheck },
    { to: "scrapped", event: "scrap", key: "tires.actions.scrap", icon: Ban },
  ],
  scrapped: [],
  mounted: [],
};

function TireFilePage() {
  const { t, i18n } = useTranslation();
  const { tireId } = Route.useParams();
  const tire = useTire(tireId);
  const [editing, setEditing] = useState<TireOpRow | null>(null);

  const transition = useDomainMutation(
    (p: { to: string; event: string }) =>
      unwrap(commands.tireSetStatus(tireId, p.to, p.event, null)),
    { onError: notifyError },
  );

  if (tire.isLoading) {
    return (
      <PageShell>
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </PageShell>
    );
  }
  const d = tire.data;
  if (!d) {
    return (
      <PageShell>
        <EmptyState className="p-10">{t("tires.notFound")}</EmptyState>
      </PageShell>
    );
  }

  const actions = TRANSITIONS[d.tire.status] ?? [];

  return (
    <PageShell>
      <BackLink fallbackLabel={t("tires.title")} />

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold" dir="ltr">
                {d.tire.dot_code ?? `${d.tire.brand} ${d.tire.model ?? ""}`}
              </span>
              <span className={cn("rounded-full px-2.5 py-1 text-xs", TIRE_BADGE[d.tire.status])}>
                {t(`tires.status.${d.tire.status}`)}
              </span>
              {d.tire.pending && <Badge variant="outline">{t("wo.pending")}</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span dir="ltr">
                {d.tire.brand} {d.tire.model ?? ""} {d.tire.size ?? ""}
              </span>
              <span className="tabular">
                {fmtNumber(d.tire.total_km, i18n.language)} {t("common.km")}
              </span>
              <span>{t(`tires.origin.${d.tire.origin}`)}</span>
              {d.tire.retread_count > 0 && (
                <span className="tabular">
                  {t("tires.retreads")}: {fmtNumber(d.tire.retread_count, i18n.language)}
                </span>
              )}
              {d.tire.mounted_plate && (
                <span>
                  {t("tires.mountedOn")} {d.tire.mounted_plate}{" "}
                  <span dir="ltr">{d.tire.mounted_position_code}</span>
                </span>
              )}
            </div>
          </div>
          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => (
                <Button
                  key={a.event}
                  size="sm"
                  variant={a.to === "scrapped" ? "destructive" : "secondary"}
                  disabled={transition.isPending}
                  onClick={() => transition.mutate({ to: a.to, event: a.event })}
                >
                  <a.icon className="h-4 w-4" />
                  {t(a.key)}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Section title={t("tires.history")}>
        {d.mounts.length === 0 ? (
          <EmptyState className="p-6">{t("common.empty")}</EmptyState>
        ) : (
          <ListCard>
            {d.mounts.map((m) => (
              <div key={m.assignment_id} className="group px-[18px] py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium" dir="ltr">
                    {m.position_code ?? "—"}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground tabular">
                    {fmtCairo(m.mounted_at, "YYYY/MM/DD", i18n.language)}
                    {m.dismounted_at &&
                      ` ← ${fmtCairo(m.dismounted_at, "YYYY/MM/DD", i18n.language)}`}
                    <button
                      title={t("tires.editOdo.title")}
                      aria-label={t("tires.editOdo.title")}
                      onClick={() => setEditing(m)}
                      className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground tabular">
                  {m.mounted_odometer != null && fmtNumber(m.mounted_odometer, i18n.language)}
                  {m.dismounted_odometer != null &&
                    ` ← ${fmtNumber(m.dismounted_odometer, i18n.language)}`}
                  {m.dismount_reason && ` · ${t(`diagram.reason.${m.dismount_reason}`)}`}
                </div>
              </div>
            ))}
          </ListCard>
        )}
      </Section>

      {d.events.length > 0 && (
        <Section title={t("tires.events")}>
          <ListCard>
            {d.events.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between px-[18px] py-3 text-sm">
                <span>
                  {ev.from_status && t(`tires.status.${ev.from_status}`)}
                  {" ← "}
                  {ev.to_status && t(`tires.status.${ev.to_status}`)}
                </span>
                <span className="text-xs text-muted-foreground tabular">
                  {fmtCairo(ev.occurred_at, "YYYY/MM/DD", i18n.language)}
                </span>
              </div>
            ))}
          </ListCard>
        </Section>
      )}

      {editing && <EditOdoDialog op={editing} onClose={() => setEditing(null)} />}
    </PageShell>
  );
}

/** Correct the odometer snapshots on a historical mount. Lifetime km is
 * derived from these, so the fix repropagates everywhere instantly. */
function EditOdoDialog({ op, onClose }: { op: TireOpRow; onClose: () => void }) {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(
    op.mounted_odometer != null ? String(op.mounted_odometer) : "",
  );
  const [dismounted, setDismounted] = useState(
    op.dismounted_odometer != null ? String(op.dismounted_odometer) : "",
  );
  const closed = op.dismounted_at != null;

  const save = useDomainMutation(
    () =>
      unwrap(
        commands.assignmentSetOdometers(
          op.assignment_id,
          mounted ? Number(mounted) : null,
          closed && dismounted ? Number(dismounted) : null,
        ),
      ),
    { onSuccess: onClose, onError: notifyError },
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("tires.editOdo.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("tires.editOdo.hint")}</p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="eo-m">{t("tires.editOdo.mounted")}</Label>
            <Input
              id="eo-m"
              inputMode="numeric"
              className="tabular"
              value={mounted}
              onChange={(e) => setMounted(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
          {closed && (
            <div className="space-y-1.5">
              <Label htmlFor="eo-d">{t("tires.editOdo.dismounted")}</Label>
              <Input
                id="eo-d"
                inputMode="numeric"
                className="tabular"
                value={dismounted}
                onChange={(e) => setDismounted(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </div>
          )}
          <Button
            className="w-full"
            disabled={save.isPending || (!mounted && !dismounted)}
            onClick={() => save.mutate()}
          >
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** History-aware back: returns to wherever the user actually came from
 * (truck diagram with its selection intact, search results, …); falls back
 * to the tires list on a cold entry. */
function BackLink({ fallbackLabel }: { fallbackLabel: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  if (canGoBack) {
    return (
      <button
        onClick={() => router.history.back()}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowRight className="h-4 w-4 ltr:rotate-180" /> {t("common.back")}
      </button>
    );
  }
  return (
    <Link
      to="/tires"
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowRight className="h-4 w-4 ltr:rotate-180" /> {fallbackLabel}
    </Link>
  );
}
