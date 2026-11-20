import { useTranslation } from "react-i18next";
import { EmptyState } from "@/widgets/layout/PageShell";

import type { DueRow } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { StatusChip } from "@/shared/ui/status-chip";
import { Plate } from "@/widgets/truck/Plate";

import { dueBadge, dueDot, intervalText, lastDoneText, nextDueText, remainingParts } from "./dueText";

/** One maintenance item of one truck: what it is, how late it is or how much
 * is left, when it was last done and how often it repeats. */
export function DueRowItem({
  row: d,
  showPlate = false,
  action,
  className,
}: {
  row: DueRow;
  showPlate?: boolean;
  action?: React.ReactNode;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const name = lang.startsWith("ar") ? d.category_name_ar : d.category_name_en;

  const parts = remainingParts(d, t, lang);
  const last = lastDoneText(d, t, lang);
  const next = nextDueText(d, t, lang);
  const every = intervalText(d, t, lang);
  // Recorded with a date but no odometer: the km clock has nothing to count from.
  const kmClockStopped = d.interval_km != null && d.last_at != null && d.last_km == null;

  let headline: React.ReactNode = null;
  if (d.status === "never_done" && d.last_at == null) {
    headline = <span className="text-status-never_done">{t("due.neverDoneHint")}</span>;
  } else if (d.status === "unknown" && parts.length === 0) {
    headline = <span>{t("due.unknownHint")}</span>;
  } else if (parts.length > 0) {
    headline = parts.map((p, i) => (
      <span key={i}>
        {i > 0 && <span className="text-muted-foreground"> · </span>}
        <span
          className={cn(
            "font-semibold",
            p.tone === "late" && "text-status-overdue",
            p.tone === "now" && "text-status-due_soon",
          )}
        >
          {p.text}
        </span>
      </span>
    ));
  }

  const meta = [last, next, every].filter(Boolean) as string[];

  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", dueDot(d.status))} />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {showPlate && <Plate className="font-bold">{d.plate}</Plate>}
            <span className="text-[15px] font-semibold">{name}</span>
            <StatusChip tone={dueBadge(d.status)}>{t(`due.status.${d.status}`, t("due.status.unknown"))}</StatusChip>
          </div>
          {headline && <div className="text-sm tabular">{headline}</div>}
          {kmClockStopped && (
            <div className="text-sm text-status-due_soon">{t("due.kmClockStopped")}</div>
          )}
          {meta.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular">
              {meta.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      {action && <div className="flex flex-none flex-wrap items-center gap-2 ps-[22px] sm:ps-0">{action}</div>}
    </div>
  );
}

/** One due row list, shared by the fleet board, the truck tab and the WO
 * cockpit's suggestion panel. `action` renders the per-row CTA. */
export function DueList({
  rows,
  showPlate = false,
  action,
  emptyText,
}: {
  rows: DueRow[];
  showPlate?: boolean;
  action?: (row: DueRow) => React.ReactNode;
  emptyText: React.ReactNode;
}) {
  if (rows.length === 0) {
    return <EmptyState>{emptyText}</EmptyState>;
  }

  return (
    <div className="space-y-2">
      {rows.map((d) => (
        <DueRowItem
          key={`${d.vehicle_id}-${d.plan_id}`}
          row={d}
          showPlate={showPlate}
          action={action?.(d)}
          className="rounded-xl border bg-card"
        />
      ))}
    </div>
  );
}
