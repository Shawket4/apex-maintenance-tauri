import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { MousePointerClick, X } from "lucide-react";

import type { AxleRow, PositionRow } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { TIRE_BADGE } from "@/shared/lib/status";
import { fmtCairo } from "@/shared/lib/time";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { StatusChip } from "@/shared/ui/status-chip";
import { positionLabel, tireName } from "apex-tire-diagram";

import { kmOnTruck } from "./pick";

const WIDE = "(min-width: 1024px)";

/** True from the `lg` breakpoint up: the inspector then sits beside the map. */
function useIsWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(WIDE);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

/**
 * The tire workbench: the wheel map, and the inspector for the chosen wheel.
 *
 *  - Wide screens: map and inspector side by side; the inspector column is
 *    always there (a prompt until a wheel is chosen) so the map never jumps.
 *  - Narrow screens: the inspector opens as a sheet from the bottom, in view,
 *    instead of somewhere below the map. A tap outside does not close it —
 *    that used to throw away a half-filled form.
 */
export function DiagramLayout({
  diagram,
  inspector,
  inspectorTitle,
  onCloseInspector,
}: {
  diagram: React.ReactNode;
  inspector: React.ReactNode | null;
  /** Read out as the sheet's name on narrow screens. */
  inspectorTitle: string;
  onCloseInspector: () => void;
}) {
  const { t } = useTranslation();
  const wide = useIsWide();

  if (!wide) {
    return (
      <>
        {diagram}
        <Dialog open={inspector != null} onOpenChange={(open) => !open && onCloseInspector()}>
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            onInteractOutside={(e) => e.preventDefault()}
            className="top-auto bottom-0 block max-h-[88dvh] w-full max-w-full translate-y-0 gap-0 rounded-b-none rounded-t-2xl p-0 sm:max-w-xl"
          >
            <DialogTitle className="sr-only">{inspectorTitle}</DialogTitle>
            {inspector}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(300px,380px)] items-start gap-5">
      <div className="min-w-0">{diagram}</div>
      <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border bg-card shadow-sm">
        {inspector ?? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <MousePointerClick aria-hidden className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("diagram.selectHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Inspector frame for the chosen wheel: its name in words, the code as a
 * small secondary detail, and a close button. */
export function InspectorShell({
  position,
  axles,
  onClose,
  children,
}: {
  position: PositionRow;
  axles: AxleRow[];
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold leading-snug">
            {positionLabel(position, axles, i18n.language)}
          </h2>
          <div className="text-xs text-muted-foreground">
            {t("diagram.codeLabel")} <bdi dir="ltr">{position.position_code}</bdi>
          </div>
        </div>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <X aria-hidden className="h-5 w-5" />
        </button>
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </div>
  );
}

/** Who is on this wheel: brand / size / DOT, how far it has run, since when. */
export function TireSummary({ position: p, currentKm }: { position: PositionRow; currentKm: number | null }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const run = kmOnTruck(p, currentKm);

  return (
    <div>
      <div className="text-base font-bold">
        <bdi dir="ltr">{tireName(p) || t("diagram.tire.unknownBrand")}</bdi>
      </div>
      <div className="mt-0.5 text-sm text-muted-foreground">
        {p.dot_code ? (
          <>
            {t("diagram.tire.dot")} <bdi dir="ltr">{p.dot_code}</bdi>
          </>
        ) : (
          t("diagram.tire.noDot")
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {p.tire_status && <StatusChip tone={TIRE_BADGE[p.tire_status] ?? "bg-muted"}>{t(`tires.status.${p.tire_status}`)}</StatusChip>}
        {p.is_spare && (
          <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-semibold text-info">{t("diagram.spare")}</span>
        )}
        {p.pending && (
          <span className="rounded-full bg-status-due_soon-soft px-2 py-0.5 text-xs font-semibold text-status-due_soon">
            {t("diagram.legend.pending")}
          </span>
        )}
      </div>
      <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {!p.is_spare && (
          <Fact label={t("diagram.tire.kmOnTruck")}>{run != null ? fmtKm(run, lang) : t("diagram.tire.kmUnknown")}</Fact>
        )}
        <Fact label={t("diagram.tire.totalKm")}>{fmtKm(p.total_km ?? 0, lang)}</Fact>
        <Fact label={t("diagram.tire.mountedSince")}>
          {p.mounted_at ? fmtCairo(p.mounted_at, "YYYY/MM/DD", lang) : t("diagram.tire.kmUnknown")}
        </Fact>
        <Fact label={t("diagram.tire.mountedOdo")}>
          {p.mounted_odometer != null ? fmtKm(p.mounted_odometer, lang) : t("diagram.tire.kmUnknown")}
        </Fact>
        {p.mount_reason && <Fact label={t("diagram.tire.how")}>{t(`tires.mountReason.${p.mount_reason}`)}</Fact>}
        {(p.retread_count ?? 0) > 0 && <Fact label={t("tires.retreads")}>{fmtNumber(p.retread_count, lang)}</Fact>}
      </dl>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular">{children}</dd>
    </div>
  );
}

/** One option of a "pick one" list: a real radio (keyboard + screen reader),
 * a full-width 44px+ target, with a line saying what choosing it does. */
export function RadioCard({
  checked,
  onSelect,
  title,
  description,
  tone = "default",
  disabled,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-start transition",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
        checked
          ? tone === "danger"
            ? "border-destructive bg-destructive/5"
            : "border-primary bg-primary/5"
          : "hover:bg-accent",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border-2",
          checked ? (tone === "danger" ? "border-destructive" : "border-primary") : "border-border-strong",
        )}
      >
        {checked && <span className={cn("h-2 w-2 rounded-full", tone === "danger" ? "bg-destructive" : "bg-primary")} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</span>}
        {children}
      </span>
    </button>
  );
}

/** A short note under a field or above a button. */
export function Note({ tone = "muted", children }: { tone?: "muted" | "warn" | "error"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "text-xs leading-relaxed",
        tone === "muted" && "text-muted-foreground",
        tone === "warn" && "rounded-md bg-status-due_soon-soft px-2.5 py-1.5 text-sm text-status-due_soon",
        tone === "error" && "rounded-md bg-status-overdue-soft px-2.5 py-1.5 text-sm text-status-overdue",
      )}
    >
      {children}
    </p>
  );
}
