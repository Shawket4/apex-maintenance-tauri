import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import type { PositionRow } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { fmtNumber } from "@/shared/lib/numbers";
import { TIRE_BADGE } from "@/shared/lib/status";

/** The diagram workbench layout: the canvas owns the full row until a wheel
 * is pressed; then the inspector card takes its column beside the canvas.
 * The canvas itself is NEVER overlaid by cards — only the small hint pill
 * floats over it (bottom edge, away from every wheel). */
export function DiagramLayout({
  canvas,
  inspector,
  hint,
  canvasClassName,
}: {
  canvas: React.ReactNode;
  inspector?: React.ReactNode;
  /** Shown as a floating pill over the canvas bottom while no inspector is open. */
  hint?: string;
  canvasClassName?: string;
}) {
  return (
    <div
      className={cn(
        "grid items-start gap-5",
        inspector && "lg:grid-cols-[minmax(0,1fr)_340px]",
      )}
    >
      <div
        className={cn(
          "relative h-[560px] overflow-hidden rounded-xl border bg-card shadow-sm",
          canvasClassName,
        )}
      >
        {canvas}
        {hint && !inspector && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-background/85 px-3.5 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
            {hint}
          </div>
        )}
      </div>
      {inspector && <div className="space-y-5">{inspector}</div>}
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
