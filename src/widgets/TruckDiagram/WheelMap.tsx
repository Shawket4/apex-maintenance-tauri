import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, Clock, Plus } from "lucide-react";

import type { AxleRow, PositionRow } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { fmtNumber } from "@/shared/lib/numbers";

import {
  buildMapLayout,
  positionLabel,
  tireName,
  wheelShortLabel,
  wheelState,
  type MapAxleRow,
  type WheelState,
} from "./layout";

/** State → look. Every state differs by icon and border style as well as by
 * colour, and the colours are theme tokens, so dark mode follows. */
const STATE_CLASS: Record<WheelState, string> = {
  mounted: "border-status-ok bg-status-ok-soft text-status-ok",
  spare: "border-info bg-info-soft text-info",
  pending: "border-status-due_soon bg-status-due_soon-soft text-status-due_soon",
  empty: "border-dashed border-border-strong bg-background text-muted-foreground",
};
const STATE_ICON = { mounted: Check, spare: Check, pending: Clock, empty: Plus } as const;
const STATES: WheelState[] = ["mounted", "empty", "spare", "pending"];

/** What the colours and marks mean. Shown with both the 2D map and the 3D view. */
export function WheelLegend({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground", className)}>
      {STATES.map((s) => {
        const Icon = STATE_ICON[s];
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn("flex h-5 w-5 items-center justify-center rounded-md border-2", STATE_CLASS[s])}
            >
              <Icon className="h-3 w-3" />
            </span>
            {t(`diagram.legend.${s}`)}
          </li>
        );
      })}
    </ul>
  );
}

export interface WheelMapProps {
  axles: AxleRow[];
  positions: PositionRow[];
  selectedId?: string | null;
  /** Omit for a picture only (the layout preview): wheels are then not buttons. */
  onSelect?: (p: PositionRow) => void;
  /** Smaller wheels with the code only — for the layout preview. */
  compact?: boolean;
}

/**
 * The truck from above, cab at the top, drawn with plain HTML: no WebGL, so
 * it works on any machine. Every wheel is a real button — reachable with the
 * keyboard and a screen reader, and big enough for a thumb.
 *
 * The drawing is laid out left-to-right in both languages (the truck's left
 * side is on the left of the screen); only the words follow the language.
 */
export function WheelMap({ axles, positions, selectedId = null, onSelect, compact = false }: WheelMapProps) {
  const { t, i18n } = useTranslation();
  const layout = useMemo(() => buildMapLayout(axles, positions), [axles, positions]);
  const fmt = (n: number) => fmtNumber(n, i18n.language);
  const dir = i18n.dir();

  // Sized so a dual axle (4 wheels + the axle name) fits a 360px phone
  // without sideways scrolling, and every wheel is still a 44px+ target.
  const wheelBox = compact ? "h-9 w-7 rounded-md" : "h-16 w-11 rounded-xl sm:w-14";
  const gap = compact ? "gap-1" : "gap-1 sm:gap-1.5";

  const wheel = (p: PositionRow, wide = false) => {
    const state = wheelState(p);
    const Icon = STATE_ICON[state];
    const label = positionLabel(p, axles, t, fmt);
    const said =
      state === "empty"
        ? t("diagram.map.ariaEmpty", { pos: label })
        : state === "pending"
          ? t("diagram.map.ariaPending", { pos: label, tire: tireName(p) })
          : t("diagram.map.ariaMounted", { pos: label, tire: tireName(p) });
    const selected = selectedId === p.id;
    const cls = cn(
      "flex flex-none flex-col items-center justify-center border-2 leading-none transition",
      wide ? "h-16 min-w-16 rounded-xl px-2" : wheelBox,
      STATE_CLASS[state],
      selected && "ring-2 ring-primary ring-offset-2 ring-offset-card",
    );
    const body = compact ? (
      <bdi dir="ltr" className="text-[9px] font-semibold">
        {p.position_code}
      </bdi>
    ) : (
      <>
        <Icon aria-hidden className="h-4 w-4" />
        <span dir={dir} className="mt-1 max-w-full truncate px-0.5 text-xs font-bold">
          {wheelShortLabel(p, axles, t, fmt)}
        </span>
        <bdi dir="ltr" className="mt-1 text-[10px] opacity-70">
          {p.position_code}
        </bdi>
      </>
    );
    if (!onSelect) {
      return (
        <div key={p.id} className={cls} title={label}>
          {body}
        </div>
      );
    }
    return (
      <button
        key={p.id}
        type="button"
        aria-label={said}
        aria-pressed={selected}
        title={said}
        onClick={() => onSelect(p)}
        className={cn(
          cls,
          "cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring dark:hover:brightness-125",
        )}
      >
        {body}
      </button>
    );
  };

  /** One side of an axle, padded so single wheels line up with the OUTER
   * wheel of the dual axles (as they do on the truck). */
  const sideCells = (wheels: PositionRow[], side: "left" | "right") => {
    const pad = Array.from({ length: layout.maxPerSide - wheels.length }, (_, i) => (
      <div key={`pad-${i}`} aria-hidden className={cn("flex-none", compact ? "w-7" : "w-11 sm:w-14")} />
    ));
    return (
      <div className={cn("flex items-center", gap)}>
        {side === "left" ? [...wheels.map((p) => wheel(p)), ...pad] : [...pad, ...wheels.map((p) => wheel(p))]}
      </div>
    );
  };

  const axleRow = (row: MapAxleRow<PositionRow>) => (
    <li key={row.axle.id} className={cn("flex items-center justify-center", gap)}>
      {sideCells(row.left, "left")}
      <div
        dir={dir}
        className={cn(
          "flex flex-none flex-col items-center justify-center rounded-md bg-muted text-center font-semibold text-foreground/80",
          compact ? "h-5 w-12 text-[10px]" : "min-h-9 w-12 px-0.5 py-1 text-xs sm:w-16",
        )}
      >
        {row.axle.is_steering ? t("diagram.map.front") : t("diagram.map.axle", { n: fmt(row.axle.section_index) })}
        {row.axle.is_lifted && !compact && (
          <span className="mt-0.5 text-[10px] font-normal text-muted-foreground">{t("diagram.map.lifted")}</span>
        )}
      </div>
      {sideCells(row.right, "right")}
    </li>
  );

  const section = (rows: MapAxleRow<PositionRow>[], title: string, cab: boolean) =>
    rows.length > 0 && (
      <section className={cn("rounded-2xl border bg-card", compact ? "p-2" : "p-2 sm:p-3")}>
        <h3
          dir={dir}
          className={cn("text-center font-semibold text-muted-foreground", compact ? "mb-1.5 text-[11px]" : "mb-2.5 text-sm")}
        >
          {title}
        </h3>
        {cab && (
          <div
            aria-hidden
            className={cn(
              "mx-auto mb-2 rounded-t-[1.25rem] rounded-b-md border bg-muted/70",
              compact ? "h-4 w-16" : "h-7 w-28",
            )}
          />
        )}
        <ul className={cn("flex flex-col", compact ? "gap-1.5" : "gap-3")}>{rows.map(axleRow)}</ul>
      </section>
    );

  return (
    <div dir="ltr" className="mx-auto flex w-fit max-w-full select-none flex-col gap-2.5">
      {!compact && (
        <div dir="ltr" className="flex items-center justify-between px-2 text-xs font-semibold text-muted-foreground">
          <span dir={dir}>{t("diagram.pos.side.left")}</span>
          <span dir={dir}>{t("diagram.map.frontOfTruck")}</span>
          <span dir={dir}>{t("diagram.pos.side.right")}</span>
        </div>
      )}
      {section(layout.tractor, t("diagram.map.tractor"), true)}
      {section(layout.trailer, t("diagram.map.trailer"), false)}
      {layout.spares.length > 0 && (
        <section className={cn("rounded-2xl border bg-card", compact ? "p-2" : "p-2 sm:p-3")}>
          <h3
            dir={dir}
            className={cn(
              "text-center font-semibold text-muted-foreground",
              compact ? "mb-1.5 text-[11px]" : "mb-2.5 text-sm",
            )}
          >
            {t("diagram.map.spares")}
          </h3>
          <div className={cn("flex flex-wrap items-center justify-center", gap)}>
            {layout.spares.map((p) => wheel(p, !compact))}
          </div>
        </section>
      )}
    </div>
  );
}
