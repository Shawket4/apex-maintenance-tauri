import { Link, createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";

import { commands, unwrap, type TruckRow } from "@/shared/api/client";
import { keys } from "@/shared/api/queries";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { QueryState } from "@/shared/ui/query-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { EmptyState, PageShell } from "@/widgets/layout/PageShell";
import { Plate } from "@/widgets/truck/Plate";

const FILTERS = ["overdue", "never_done", "due_soon", "untracked", "open_wo"] as const;
type Filter = (typeof FILTERS)[number];

export const Route = createFileRoute("/_app/trucks/")({
  // Search text and filter live in the URL so back-navigation restores them.
  validateSearch: (s: Record<string, unknown>): { q?: string; f?: Filter } => ({
    ...(typeof s.q === "string" && s.q ? { q: s.q } : {}),
    ...(FILTERS.includes(s.f as Filter) ? { f: s.f as Filter } : {}),
  }),
  component: TrucksPage,
});

/** The single most important fact about a truck's maintenance, in order:
 * nothing tracked → overdue → never recorded → due soon → all fine. */
type TruckState = "untracked" | "overdue" | "never_done" | "due_soon" | "ok";

function truckState(tr: TruckRow): TruckState {
  if (tr.plan_count === 0) return "untracked";
  if (tr.overdue_count > 0) return "overdue";
  if (tr.never_done_count > 0) return "never_done";
  if (tr.due_soon_count > 0) return "due_soon";
  return "ok";
}

const matches: Record<Filter, (tr: TruckRow) => boolean> = {
  overdue: (tr) => tr.overdue_count > 0,
  never_done: (tr) => tr.never_done_count > 0,
  due_soon: (tr) => tr.due_soon_count > 0,
  untracked: (tr) => tr.plan_count === 0,
  open_wo: (tr) => tr.open_wo_count > 0,
};

function TrucksPage() {
  const { t, i18n } = useTranslation();
  const { q = "", f } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setSearch = (next: { q?: string; f?: Filter }) =>
    void navigate({
      search: { ...(next.q ? { q: next.q } : {}), ...(next.f ? { f: next.f } : {}) },
      replace: true,
    });
  // The text goes to the Rust side as typed: it matches the plate with or
  // without spaces and in either digit script. The previous result stays on
  // screen while the next one loads, so typing does not flash a skeleton.
  const trucks = useQuery({
    queryKey: keys.trucks(q || undefined),
    queryFn: () => unwrap(commands.truckList(q || null)),
    placeholderData: keepPreviousData,
  });

  return (
    <PageShell title={t("trucks.title")}>
      <div className="relative sm:max-w-md">
        <label htmlFor="truck-search" className="sr-only">
          {t("trucks.searchLabel")}
        </label>
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="truck-search"
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={q}
          onChange={(e) => setSearch({ q: e.target.value, f })}
          placeholder={t("trucks.searchPlaceholder")}
          className="h-11 ps-9 pe-11"
          dir="auto"
          autoComplete="off"
        />
        {q && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute end-0.5 top-1/2 -translate-y-1/2"
            aria-label={t("trucks.clearSearch")}
            onClick={() => setSearch({ f })}
          >
            <X />
          </Button>
        )}
      </div>

      <QueryState
        query={trucks}
        skeleton={
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        }
      >
        {(all) => {
          const shown = f ? all.filter(matches[f]) : all;
          return (
            <div className="space-y-4">
              {all.length > 0 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label={t("trucks.filterLabel")}>
                  <FilterChip active={!f} onClick={() => setSearch({ q })}>
                    {t("common.all")} · {fmtNumber(all.length, i18n.language)}
                  </FilterChip>
                  {FILTERS.map((key) => {
                    const n = all.filter(matches[key]).length;
                    if (n === 0 && f !== key) return null;
                    return (
                      <FilterChip
                        key={key}
                        active={f === key}
                        onClick={() => setSearch({ q, f: f === key ? undefined : key })}
                      >
                        {t(`trucks.filter.${key}`)} · {fmtNumber(n, i18n.language)}
                      </FilterChip>
                    );
                  })}
                </div>
              )}

              {shown.length === 0 ? (
                <EmptyState className="space-y-3 p-10">
                  <p>{q ? t("trucks.noMatch", { q }) : f ? t("trucks.noneInFilter") : t("trucks.empty")}</p>
                  {(q || f) && (
                    <Button variant="outline" onClick={() => setSearch({})}>
                      {t("trucks.showAll")}
                    </Button>
                  )}
                </EmptyState>
              ) : (
                <div
                  className={cn(
                    "grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3",
                    trucks.isPlaceholderData && "opacity-60",
                  )}
                >
                  {shown.map((tr) => (
                    <TruckCard key={tr.id} truck={tr} />
                  ))}
                </div>
              )}
            </div>
          );
        }}
      </QueryState>
    </PageShell>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-full border px-3.5 text-sm font-medium tabular transition pointer-coarse:min-h-11",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-card text-foreground hover:border-border-strong hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

const STATE_FOOTER: Record<TruckState, string> = {
  untracked: "bg-muted text-foreground",
  overdue: "bg-status-overdue-soft text-status-overdue",
  never_done: "bg-status-never_done-soft text-status-never_done",
  due_soon: "bg-status-due_soon-soft text-status-due_soon",
  ok: "bg-status-ok-soft text-status-ok",
};

/** The fleet card: plate up top, odometer and driver, and a status FOOTER
 * that carries the single most important fact about this truck. "All fine"
 * is only said when plans exist and none of them needs anything. */
function TruckCard({ truck: tr }: { truck: TruckRow }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const state = truckState(tr);
  const n = (v: number) => fmtNumber(v, lang);

  let headline: string;
  let hint: string | null = null;
  if (state === "untracked") {
    headline = t("trucks.state.untracked");
    hint = tr.class_id ? t("trucks.state.untrackedNoPlans") : t("trucks.state.untrackedNoClass");
  } else if (state === "ok") {
    headline = t("trucks.state.ok");
  } else {
    // Every count that is not zero, most urgent first.
    headline = [
      tr.overdue_count > 0 && t("trucks.state.overdue", { n: n(tr.overdue_count) }),
      tr.never_done_count > 0 && t("trucks.state.neverDone", { n: n(tr.never_done_count) }),
      tr.due_soon_count > 0 && t("trucks.state.dueSoon", { n: n(tr.due_soon_count) }),
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return (
    <Link
      to="/trucks/$truckId"
      params={{ truckId: String(tr.id) }}
      className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition hover:border-border-strong hover:shadow-md"
    >
      <div className="flex-1 px-4 pb-3 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <Plate className="text-lg font-bold">{tr.plate}</Plate>
          {tr.open_wo_count > 0 && (
            <Badge className="flex-none bg-status-ok-soft text-status-ok hover:bg-status-ok-soft">
              {t("trucks.openWoBadge")}
            </Badge>
          )}
        </div>
        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-sm">
          <dt className="whitespace-nowrap text-muted-foreground">{t("truck.odometer")}</dt>
          <dd className={cn("truncate tabular", tr.odometer ? "font-semibold" : "text-muted-foreground")}>
            {tr.odometer ? fmtKm(tr.odometer.km, lang) : t("trucks.noOdometer")}
          </dd>
          <dt className="whitespace-nowrap text-muted-foreground">{t("trucks.driver")}</dt>
          <dd className={cn("truncate", tr.driver_name ? "font-semibold" : "text-muted-foreground")}>
            {tr.driver_name ?? t("trucks.noDriver")}
          </dd>
          <dt className="whitespace-nowrap text-muted-foreground">{t("truck.class")}</dt>
          <dd className={cn("truncate", tr.class_id ? "font-semibold" : "text-muted-foreground")}>
            {tr.class_name_ar ?? t("trucks.unclassified")}
          </dd>
        </dl>
        {!tr.has_chassis && (
          <p className="mt-2 text-xs text-muted-foreground">{t("trucks.noChassis")}</p>
        )}
      </div>
      <div className={cn("border-t px-4 py-2.5", STATE_FOOTER[state])}>
        <div className="text-sm font-semibold tabular">{headline}</div>
        {hint && <div className="mt-0.5 text-xs">{hint}</div>}
      </div>
    </Link>
  );
}
