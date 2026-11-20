import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Search, X } from "lucide-react";

import type { DueRow, OdoTruth, WoListRow } from "@/shared/api/client";
import { useDue, useTrucks, useWos } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { QueryState } from "@/shared/ui/query-state";
import { BaselineDialog } from "@/widgets/due/BaselineDialog";
import { DueRowItem } from "@/widgets/due/DueList";
import { dueBadge, foldPlate, needsAttention } from "@/widgets/due/dueText";
import { EmptyState, PageShell } from "@/widgets/layout/PageShell";
import { Plate } from "@/widgets/truck/Plate";
import { TruckWoAction } from "@/widgets/truck/TruckWoAction";

const STATUS_FILTERS = ["overdue", "never_done", "due_soon", "unknown", "all"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export const Route = createFileRoute("/_app/due")({
  // Filter and search live in the URL: other screens can link to
  // "/due?status=overdue", and Back restores what was on screen.
  validateSearch: (s: Record<string, unknown>): { status?: StatusFilter; q?: string } => ({
    ...(STATUS_FILTERS.includes(s.status as StatusFilter) ? { status: s.status as StatusFilter } : {}),
    ...(typeof s.q === "string" && s.q ? { q: s.q } : {}),
  }),
  component: DueBoard,
});

type TruckGroup = { vehicleId: number; plate: string; rows: DueRow[]; total: DueRow[] };

/** Fleet board: what needs doing, grouped by truck (most urgent truck
 * first — the Rust view already sorts rows by urgency), filtered by status
 * and by plate. Each truck carries its own "work order" action. */
function DueBoard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { status, q = "" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setSearch = (next: { status?: StatusFilter; q?: string }) =>
    void navigate({
      search: { ...(next.status ? { status: next.status } : {}), ...(next.q ? { q: next.q } : {}) },
      replace: true,
    });

  const due = useDue();
  const trucks = useTrucks();
  const openWos = useWos("open");
  const [baselineFor, setBaselineFor] = useState<DueRow | null>(null);

  const wosByTruck = useMemo(() => {
    const m = new Map<number, WoListRow[]>();
    for (const w of openWos.data ?? []) m.set(w.vehicle_id, [...(m.get(w.vehicle_id) ?? []), w]);
    return m;
  }, [openWos.data]);

  return (
    <PageShell title={t("due.title")} subtitle={t("due.subtitle")}>
      <UnclassifiedNotice trucks={trucks.data ?? []} />

      <QueryState query={due}>
        {(rows) => {
          const needle = foldPlate(q);
          const byPlate = needle ? rows.filter((r) => foldPlate(r.plate).includes(needle)) : rows;
          const pass = (r: DueRow) =>
            status === "all" ? true : status ? r.status === status : needsAttention(r.status);
          const count = (s: StatusFilter | undefined) =>
            s === "all"
              ? byPlate.length
              : s
                ? byPlate.filter((r) => r.status === s).length
                : byPlate.filter((r) => needsAttention(r.status)).length;

          // Group by truck, keeping the order of each truck's first (most
          // urgent) row.
          const groups: TruckGroup[] = [];
          const index = new Map<number, TruckGroup>();
          for (const r of byPlate) {
            let g = index.get(r.vehicle_id);
            if (!g) {
              g = { vehicleId: r.vehicle_id, plate: r.plate, rows: [], total: [] };
              index.set(r.vehicle_id, g);
              groups.push(g);
            }
            g.total.push(r);
            if (pass(r)) g.rows.push(r);
          }
          const shown = groups.filter((g) => g.rows.length > 0);

          return (
            <div className="space-y-4">
              <div className="relative sm:max-w-md">
                <label htmlFor="due-search" className="sr-only">
                  {t("due.searchLabel")}
                </label>
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="due-search"
                  type="text"
                  inputMode="search"
                  value={q}
                  onChange={(e) => setSearch({ status, q: e.target.value })}
                  placeholder={t("due.searchPlaceholder")}
                  className="h-11 ps-9 pe-11"
                  dir="auto"
                  autoComplete="off"
                />
                {q && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute end-0.5 top-1/2 -translate-y-1/2"
                    aria-label={t("due.clearSearch")}
                    onClick={() => setSearch({ status })}
                  >
                    <X />
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap gap-2" role="group" aria-label={t("due.filterLabel")}>
                <FilterChip active={!status} onClick={() => setSearch({ q })}>
                  {t("due.filter.attention")} ({fmtNumber(count(undefined), lang)})
                </FilterChip>
                {STATUS_FILTERS.map((s) => {
                  const n = count(s);
                  // "No odometer" is rare: only offered when it exists.
                  if (s === "unknown" && n === 0 && status !== s) return null;
                  return (
                    <FilterChip
                      key={s}
                      active={status === s}
                      tone={s === "all" ? undefined : dueBadge(s)}
                      onClick={() => setSearch({ q, status: s })}
                    >
                      {s === "all" ? t("common.all") : t(`due.status.${s}`)} ({fmtNumber(n, lang)})
                    </FilterChip>
                  );
                })}
              </div>

              {shown.length === 0 ? (
                <EmptyState className="space-y-3 p-10">
                  <p>
                    {rows.length === 0
                      ? t("due.empty")
                      : q && byPlate.length === 0
                        ? t("due.noPlateMatch", { q })
                        : !status
                          ? t("due.nothingNeeded")
                          : t("due.noneInFilter")}
                  </p>
                  {rows.length > 0 && (q || status) && (
                    <Button variant="outline" onClick={() => setSearch({})}>
                      {t("due.resetFilters")}
                    </Button>
                  )}
                </EmptyState>
              ) : (
                <div className="space-y-4">
                  {shown.map((g) => (
                    <TruckGroupCard
                      key={g.vehicleId}
                      group={g}
                      openWos={wosByTruck.get(g.vehicleId) ?? []}
                      wosLoading={openWos.isPending}
                      wosFailed={openWos.isError && openWos.data === undefined}
                      onRetryWos={() => void openWos.refetch()}
                      onBaseline={setBaselineFor}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        }}
      </QueryState>

      {baselineFor && (
        <BaselineDialog
          key={`${baselineFor.vehicle_id}-${baselineFor.plan_id}`}
          row={baselineFor}
          onClose={() => setBaselineFor(null)}
        />
      )}
    </PageShell>
  );
}

function FilterChip({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-full border px-3.5 text-sm font-semibold tabular transition pointer-coarse:min-h-11",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : cn("border-transparent hover:border-border-strong", tone ?? "border-border bg-card"),
      )}
    >
      {children}
    </button>
  );
}

/** One truck: plate (a link to the truck), its odometer, the work-order
 * action, and its maintenance items underneath. */
function TruckGroupCard({
  group,
  openWos,
  wosLoading,
  wosFailed,
  onRetryWos,
  onBaseline,
}: {
  group: TruckGroup;
  openWos: WoListRow[];
  wosLoading: boolean;
  wosFailed: boolean;
  onRetryWos: () => void;
  onBaseline: (row: DueRow) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const first = group.total[0];
  const odometer: OdoTruth | null =
    first.current_odometer != null
      ? {
          km: first.current_odometer,
          source: first.odometer_source ?? "",
          observed_at: first.odometer_observed_at,
        }
      : null;
  const truckId = String(group.vehicleId);

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <header className="flex flex-col gap-3 border-b bg-muted/40 p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link
            to="/trucks/$truckId"
            params={{ truckId }}
            className="inline-flex min-h-10 items-center text-lg font-bold underline-offset-4 hover:underline"
          >
            <Plate>{group.plate}</Plate>
          </Link>
          <div className="text-sm text-muted-foreground tabular">
            {odometer ? t("due.truckOdometer", { km: fmtKm(odometer.km, lang) }) : t("due.truckNoOdometer")}
          </div>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-2">
          <TruckWoAction
            vehicleId={group.vehicleId}
            odometer={odometer}
            openWos={openWos}
            loading={wosLoading}
            failed={wosFailed}
            onRetry={onRetryWos}
            size="sm"
          />
        </div>
      </header>
      <div className="divide-y">
        {group.rows.map((d) => (
          <DueRowItem
            key={d.plan_id}
            row={d}
            action={
              <>
                {d.status === "unknown" && (
                  <Button asChild size="sm">
                    <Link to="/trucks/$truckId" params={{ truckId }}>
                      {t("truck.enterOdometer")}
                    </Link>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={d.status === "never_done" ? "default" : "outline"}
                  onClick={() => onBaseline(d)}
                >
                  {t("due.baseline")}
                </Button>
              </>
            }
          />
        ))}
      </div>
      {group.rows.length < group.total.length && (
        <Link
          to="/trucks/$truckId/due"
          params={{ truckId }}
          className="flex min-h-10 items-center border-t px-3.5 text-sm font-semibold text-primary hover:underline"
        >
          {t("due.truckSeeAll", { n: fmtNumber(group.total.length, lang) })}
        </Link>
      )}
    </section>
  );
}

/** Trucks with no maintenance class are not on the board at all — nothing is
 * tracked for them. Say so, and list them: each plate opens the truck page,
 * where the class is chosen. */
function UnclassifiedNotice({ trucks }: { trucks: { id: number; plate: string; class_id: string | null }[] }) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const missing = trucks.filter((tr) => !tr.class_id);
  if (missing.length === 0) return null;
  const LIMIT = 8;
  const list = expanded ? missing : missing.slice(0, LIMIT);

  return (
    <section className="rounded-xl border border-status-overdue/40 bg-status-overdue-soft p-4">
      <h2 className="flex items-start gap-2 text-sm font-bold text-status-overdue">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
        {t("due.unclassifiedTitle", { n: fmtNumber(missing.length, i18n.language) })}
      </h2>
      <p className="mt-1 text-sm">{t("due.unclassifiedBody")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {list.map((tr) => (
          <Link
            key={tr.id}
            to="/trucks/$truckId"
            params={{ truckId: String(tr.id) }}
            hash="class"
            className="inline-flex min-h-10 items-center rounded-lg border bg-card px-3 text-sm font-semibold hover:border-border-strong pointer-coarse:min-h-11"
          >
            <Plate>{tr.plate}</Plate>
          </Link>
        ))}
        {missing.length > LIMIT && (
          <Button variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded
              ? t("due.unclassifiedLess")
              : t("due.unclassifiedMore", { n: fmtNumber(missing.length - LIMIT, i18n.language) })}
          </Button>
        )}
      </div>
    </section>
  );
}
