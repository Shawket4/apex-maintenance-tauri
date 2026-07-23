import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import type { ChassisPayload, PositionRow } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { fmtNumber } from "@/shared/lib/numbers";
import { TIRE_BADGE } from "@/shared/lib/status";
import { ListCard } from "@/widgets/layout/PageShell";

/** The diagram workbench layout: the canvas owns its column and is NEVER
 * overlaid — everything informational lives in the inspector column beside
 * it, so the top-down pair view stays fully visible. */
export function DiagramLayout({
  canvas,
  inspector,
  canvasClassName,
}: {
  canvas: React.ReactNode;
  inspector: React.ReactNode;
  canvasClassName?: string;
}) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div
        className={cn(
          "relative h-[560px] overflow-hidden rounded-xl border bg-card shadow-sm",
          canvasClassName,
        )}
      >
        {canvas}
      </div>
      <div className="space-y-5">{inspector}</div>
    </div>
  );
}

/** Inspector card for the selected position: code chip header + close. */
export function InspectorShell({
  position,
  title,
  subtitle,
  accent = "primary",
  onClose,
  children,
}: {
  position: PositionRow;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  accent?: "primary" | "destructive";
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b bg-background/70 px-4 py-3">
        <span
          className={cn(
            "rounded-lg px-2.5 py-1 text-sm font-bold tracking-wider tabular",
            accent === "destructive"
              ? "bg-destructive/10 text-destructive"
              : "bg-primary/10 text-primary",
          )}
          dir="ltr"
        >
          {position.position_code}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold leading-tight">{title}</div>
          {subtitle && (
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{subtitle}</div>
          )}
        </div>
        <button
          aria-label={t("common.close")}
          onClick={onClose}
          className="flex-none rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/** Every position as a scannable list — the other way to reach a wheel, and
 * the at-a-glance answer to "what's on this truck". Click = select + focus. */
export function PositionList({
  chassis,
  selectedId,
  onSelect,
}: {
  chassis: ChassisPayload;
  selectedId: string | null;
  onSelect: (p: PositionRow) => void;
}) {
  const { t } = useTranslation();

  const groups: { label: string; rows: PositionRow[] }[] = [
    {
      label: t("diagram.positions"),
      rows: chassis.positions.filter((p) => !p.is_spare),
    },
    {
      label: t("diagram.spare"),
      rows: chassis.positions.filter((p) => p.is_spare),
    },
  ].filter((g) => g.rows.length > 0);

  return (
    <ListCard>
      {groups.map((g) => (
        <div key={g.label}>
          <div className="bg-background/70 px-4 py-1.5 text-[11px] font-semibold text-muted-foreground">
            {g.label}
          </div>
          <div className="divide-y">
            {g.rows.map((p) => {
              const occupied = !!p.tire_id;
              return (
                <button
                  key={p.id}
                  onClick={() => onSelect(p)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-4 py-2 text-start text-[13px] transition hover:bg-primary/[0.03]",
                    selectedId === p.id && "bg-primary/[0.06]",
                  )}
                >
                  <span
                    className="w-14 flex-none rounded-md bg-muted px-1.5 py-0.5 text-center text-[11px] font-bold tabular"
                    dir="ltr"
                  >
                    {p.position_code}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", !occupied && "text-muted-foreground")} dir="auto">
                    {occupied ? (p.dot_code ?? p.brand ?? "") : t("diagram.emptyPosition")}
                  </span>
                  {p.pending && (
                    <span className="flex-none rounded-full border px-1.5 text-[10px] text-muted-foreground">
                      {t("diagram.queued")}
                    </span>
                  )}
                  <span
                    className={cn(
                      "h-2 w-2 flex-none rounded-full",
                      occupied
                        ? p.pending
                          ? "bg-status-due_soon"
                          : "bg-status-ok"
                        : "bg-border-strong",
                    )}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </ListCard>
  );
}

/** Fact grid for an occupied position. `currentKm` = the truck's odometer
 * (for the live run-this-mount figure). */
export function TireFacts({
  position: p,
  currentKm,
}: {
  position: PositionRow;
  currentKm: number | null;
}) {
  const { t, i18n } = useTranslation();
  const runThisMount =
    p.mounted_odometer != null && currentKm != null && !p.is_spare
      ? Math.max(0, currentKm - p.mounted_odometer)
      : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {p.tire_status && (
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", TIRE_BADGE[p.tire_status])}>
            {t(`tires.status.${p.tire_status}`)}
          </span>
        )}
        {p.is_spare && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            {t("diagram.spare")}
          </span>
        )}
        {p.origin && (
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {t(`tires.origin.${p.origin}`)}
          </span>
        )}
        {p.pending && (
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {t("diagram.queued")}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-3.5 gap-y-2.5 text-xs">
        <Fact label={t("diagram.inspect.lifetimeKm")}>
          <span className="tabular">
            {fmtNumber(p.total_km ?? 0, i18n.language)} {t("common.km")}
          </span>
        </Fact>
        {runThisMount != null && (
          <Fact label={t("diagram.inspect.currentRun")}>
            <span className="tabular">
              {fmtNumber(runThisMount, i18n.language)} {t("common.km")}
            </span>
          </Fact>
        )}
        {p.mounted_odometer != null && (
          <Fact label={t("diagram.inspect.mountedOdo")}>
            <span className="tabular">
              {fmtNumber(p.mounted_odometer, i18n.language)} {t("common.km")}
            </span>
          </Fact>
        )}
        {p.mount_reason && (
          <Fact label={t("diagram.inspect.mountReason")}>
            {t(`tires.mountReason.${p.mount_reason}`)}
          </Fact>
        )}
        {(p.retread_count ?? 0) > 0 && (
          <Fact label={t("tires.retreads")}>
            <span className="tabular">{fmtNumber(p.retread_count, i18n.language)}</span>
          </Fact>
        )}
      </dl>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold">{children}</dd>
    </div>
  );
}
