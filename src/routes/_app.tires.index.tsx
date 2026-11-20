import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Search, X } from "lucide-react";

import { commands, unwrap, type TireRow } from "@/shared/api/client";
import { keys } from "@/shared/api/queries";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { TIRE_BADGE } from "@/shared/lib/status";
import { useDebouncedValue } from "@/shared/lib/useDebouncedValue";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { QueryState } from "@/shared/ui/query-state";
import { StatusChip } from "@/shared/ui/status-chip";
import { PageShell } from "@/widgets/layout/PageShell";
import { StockPanel } from "@/widgets/stock/StockPanel";
import { LegacyIntakeDialog } from "@/widgets/tires/LegacyIntakeDialog";
import { tireName } from "@/widgets/tires/lib";
import { Chip, Heading, PositionLabel } from "@/widgets/tires/parts";

const STATUS_FILTERS = ["all", "mounted", "in_stock_used", "in_repair", "retreading", "scrapped"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const PAGE = 60;

export const Route = createFileRoute("/_app/tires/")({
  // Filter + search live in the URL so back-navigation (e.g. from a tire
  // file) restores the exact list state.
  validateSearch: (s: Record<string, unknown>): { status?: string; q?: string } => ({
    ...(typeof s.status === "string" && s.status !== "all" && (STATUS_FILTERS as readonly string[]).includes(s.status)
      ? { status: s.status }
      : {}),
    ...(typeof s.q === "string" && s.q ? { q: s.q } : {}),
  }),
  component: TiresPage,
});

function TiresPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const status = (search.status ?? "all") as StatusFilter;
  const q = search.q ?? "";
  const [intake, setIntake] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const setStatus = (v: StatusFilter) => {
    setShown(PAGE);
    void navigate({ search: (prev) => ({ ...prev, status: v === "all" ? undefined : v }), replace: true });
  };
  const setQ = (v: string) => {
    setShown(PAGE);
    void navigate({ search: (prev) => ({ ...prev, q: v || undefined }), replace: true });
  };

  // One read for every status (so the chips can show counts); the search
  // text goes to the app's own matcher (brand, model, size, DOT, plate).
  // The previous answer stays on screen while the next one loads, so typing
  // does not flash a skeleton.
  const dq = useDebouncedValue(q.trim(), 200);
  const tires = useQuery({
    queryKey: keys.tires(undefined, dq || undefined),
    queryFn: () => unwrap(commands.tiresList(null, dq || null)),
    placeholderData: keepPreviousData,
  });

  return (
    <PageShell title={t("tires.title")}>
      <StockPanel />

      <section aria-labelledby="tires-heading">
        <Heading
          action={
            <Button variant="outline" onClick={() => setIntake(true)}>
              {t("tires.intake.open")}
            </Button>
          }
        >
          <span id="tires-heading">{t("tires.assets.title")}</span>
        </Heading>

        <div className="mb-3 space-y-1.5">
          <Label htmlFor="tire-search">{t("tires.assets.searchLabel")}</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="tire-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("tires.assets.searchPlaceholder")}
              className="ps-9 pe-12 [&::-webkit-search-cancel-button]:hidden"
              dir="auto"
              autoComplete="off"
            />
            {q && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("tires.assets.clearSearch")}
                className="absolute end-0 top-1/2 -translate-y-1/2"
                onClick={() => setQ("")}
              >
                <X />
              </Button>
            )}
          </div>
        </div>

        <QueryState query={tires}>
          {(all) => {
            const counts: Record<string, number> = {};
            for (const tire of all) counts[tire.status] = (counts[tire.status] ?? 0) + 1;
            const list = status === "all" ? all : all.filter((tire) => tire.status === status);
            return (
              <>
                <div role="group" aria-label={t("tires.assets.filterLabel")} className="mb-3 flex flex-wrap gap-2">
                  {STATUS_FILTERS.map((s) => (
                    <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
                      {s === "all" ? t("common.all") : t(`tires.status.${s}`)}
                      <span className="tabular opacity-80">
                        {fmtNumber(s === "all" ? all.length : (counts[s] ?? 0), lang)}
                      </span>
                    </Chip>
                  ))}
                </div>

                {list.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    <p>
                      {q.trim()
                        ? t("tires.assets.noMatch")
                        : status !== "all"
                          ? t("tires.assets.noneInStatus")
                          : t("tires.assets.empty")}
                    </p>
                    {(q.trim() || status !== "all") && (
                      <Button
                        variant="outline"
                        className="mt-3"
                        onClick={() => {
                          setShown(PAGE);
                          void navigate({ search: {}, replace: true });
                        }}
                      >
                        {t("tires.assets.showAll")}
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
                      {list.slice(0, shown).map((tire) => (
                        <li key={tire.id}>
                          <TireCard tire={tire} />
                        </li>
                      ))}
                    </ul>
                    {list.length > shown && (
                      <div className="mt-3 flex flex-col items-center gap-1">
                        <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                          {t("tires.assets.showMore")}
                        </Button>
                        <p className="text-sm text-muted-foreground">
                          {t("tires.assets.shownOf", {
                            shown: fmtNumber(shown, lang),
                            total: fmtNumber(list.length, lang),
                          })}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </>
            );
          }}
        </QueryState>
      </section>

      {intake && <LegacyIntakeDialog open onOpenChange={setIntake} />}
    </PageShell>
  );
}

/** One tire. The whole card opens the tire file — a tire with no DOT used to
 * be reachable only by clicking a dash. */
function TireCard({ tire }: { tire: TireRow }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return (
    <Link
      to="/tires/$tireId"
      params={{ tireId: tire.id }}
      className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-primary/[0.04] focus-visible:bg-primary/[0.06] focus-visible:outline-none"
    >
      <div className="grid min-w-0 flex-1 gap-x-6 gap-y-1.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <bdi className="font-semibold">{tireName(tire)}</bdi>
            <StatusChip tone={TIRE_BADGE[tire.status] ?? ""}>{t(`tires.status.${tire.status}`)}</StatusChip>
            {tire.pending && <Badge variant="outline">{t("tires.pending")}</Badge>}
          </div>
          <div className="text-sm text-muted-foreground">
            {tire.dot_code ? (
              <>
                {t("tires.dotShort")} <bdi dir="ltr">{tire.dot_code}</bdi>
              </>
            ) : (
              t("tires.noDot")
            )}
          </div>
        </div>

        <div className="min-w-0 text-sm">
          {tire.mounted_plate ? (
            <>
              <span className="text-muted-foreground">{t("tires.onTruck")}</span>{" "}
              <bdi className="font-semibold">{tire.mounted_plate}</bdi>
              <PositionLabel code={tire.mounted_position_code} className="block text-muted-foreground" />
            </>
          ) : (
            <span className="text-muted-foreground">{t(`tires.where.${tire.status}`, t("tires.where.other"))}</span>
          )}
        </div>

        <div className="text-sm">
          <span className="font-semibold tabular">{fmtKm(tire.total_km, lang)}</span>
          {tire.km_incomplete && (
            <span className="ms-1.5 rounded-full bg-status-due_soon-soft px-2 py-0.5 text-xs font-semibold text-status-due_soon">
              {t("tires.approx")}
            </span>
          )}
          {tire.retread_count > 0 && (
            <div className="text-muted-foreground">
              {t("tires.retreadCount", { n: fmtNumber(tire.retread_count, lang) })}
            </div>
          )}
        </div>
      </div>
      <ChevronLeft className="h-5 w-5 flex-none text-muted-foreground ltr:-scale-x-100" aria-hidden />
    </Link>
  );
}
