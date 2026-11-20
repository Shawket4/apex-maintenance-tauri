import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight, Search, X } from "lucide-react";

import type { WoListRow } from "@/shared/api/client";
import { useWos } from "@/shared/api/queries";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { QueryState } from "@/shared/ui/query-state";
import { EmptyState, ListCard, PageShell, Section } from "@/widgets/layout/PageShell";
import { plateKey } from "@/widgets/wo/lib";
import { PendingBadge, SectionTitle, StatusBadge } from "@/widgets/wo/parts";

type StatusFilter = "all" | "open" | "closed";
type ListSearch = { status?: "open" | "closed"; q?: string };

export const Route = createFileRoute("/_app/wo/")({
  // Filter and search live in the URL so "back" from a work order restores them.
  validateSearch: (s: Record<string, unknown>): ListSearch => ({
    ...(s.status === "open" || s.status === "closed" ? { status: s.status } : {}),
    ...(typeof s.q === "string" && s.q ? { q: s.q } : {}),
  }),
  component: WoListPage,
});

/** Every work order: the open ones first (the work in the bay), then the
 * closed ones, newest first. */
function WoListPage() {
  const { t, i18n } = useTranslation();
  const { status, q = "" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const filter: StatusFilter = status ?? "all";
  const wos = useWos();

  const setSearch = (next: { status?: StatusFilter; q?: string }) => {
    const s = next.status ?? filter;
    const text = next.q ?? q;
    void navigate({
      search: { ...(s !== "all" ? { status: s } : {}), ...(text ? { q: text } : {}) },
      replace: true,
    });
  };

  return (
    <PageShell title={t("wo.listTitle")} subtitle={t("wo.listSubtitle")}>
      <QueryState query={wos}>
        {(all) => {
          const needle = plateKey(q);
          const matching = needle ? all.filter((w) => plateKey(w.plate).includes(needle)) : all;
          const open = matching.filter((w) => w.status === "open");
          const closed = matching.filter((w) => w.status !== "open");
          const showOpen = filter !== "closed";
          const showClosed = filter !== "open";
          const shown = (showOpen ? open.length : 0) + (showClosed ? closed.length : 0);
          const n = (v: number) => fmtNumber(v, i18n.language);
          const filters: { key: StatusFilter; label: string }[] = [
            { key: "all", label: t("wo.listAll", { n: n(matching.length) }) },
            { key: "open", label: t("wo.listOpen", { n: n(open.length) }) },
            { key: "closed", label: t("wo.listClosed", { n: n(closed.length) }) },
          ];

          return (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0 space-y-1.5 sm:w-72">
                  <Label htmlFor="wo-list-search">{t("wo.listSearchLabel")}</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="wo-list-search"
                      value={q}
                      onChange={(e) => setSearch({ q: e.target.value })}
                      placeholder={t("wo.listSearchPlaceholder")}
                      dir="auto"
                      className="bg-card pe-11 ps-9"
                    />
                    {q && (
                      <button
                        type="button"
                        aria-label={t("wo.listClearSearch")}
                        onClick={() => setSearch({ q: "" })}
                        className="absolute end-0 top-0 flex h-full w-10 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div role="group" aria-label={t("wo.listFilterLabel")} className="flex flex-wrap gap-2">
                  {filters.map((f) => (
                    <Button
                      key={f.key}
                      size="sm"
                      variant={filter === f.key ? "default" : "outline"}
                      aria-pressed={filter === f.key}
                      onClick={() => setSearch({ status: f.key })}
                      className="tabular"
                    >
                      {f.label}
                    </Button>
                  ))}
                </div>
              </div>

              {all.length === 0 ? (
                <EmptyState className="space-y-4 p-10">
                  <div>{t("wo.listEmpty")}</div>
                  <Button asChild>
                    <Link to="/trucks">{t("wo.listGoTrucks")}</Link>
                  </Button>
                </EmptyState>
              ) : shown === 0 ? (
                <EmptyState className="space-y-4 p-10">
                  <div>{t("wo.listNoMatch")}</div>
                  <Button
                    variant="outline"
                    onClick={() => void navigate({ search: {}, replace: true })}
                  >
                    {t("wo.listShowAll")}
                  </Button>
                </EmptyState>
              ) : (
                <>
                  {showOpen && open.length > 0 && (
                    <Section title={<SectionTitle>{t("wo.listOpenGroup")}</SectionTitle>}>
                      <ListCard>
                        {open.map((w) => (
                          <WoRow key={w.id} wo={w} />
                        ))}
                      </ListCard>
                    </Section>
                  )}
                  {showClosed && closed.length > 0 && (
                    <Section title={<SectionTitle>{t("wo.listClosedGroup")}</SectionTitle>}>
                      <ListCard>
                        {closed.map((w) => (
                          <WoRow key={w.id} wo={w} />
                        ))}
                      </ListCard>
                    </Section>
                  )}
                </>
              )}
            </div>
          );
        }}
      </QueryState>
    </PageShell>
  );
}

function WoRow({ wo }: { wo: WoListRow }) {
  const { t, i18n } = useTranslation();
  const n = (v: number) => fmtNumber(v, i18n.language);
  const allDone = wo.task_count > 0 && wo.done_count === wo.task_count;
  return (
    <Link
      to="/wo/$woId"
      params={{ woId: wo.id }}
      className="flex items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-primary/[0.03]"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <bdi className="text-base font-bold [word-spacing:0.12em]">{wo.plate}</bdi>
          <StatusBadge status={wo.status} />
          {wo.pending && <PendingBadge />}
        </div>
        {wo.title?.trim() && (
          <div dir="auto" className="break-words text-sm font-medium">
            {wo.title}
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground tabular">
          <span>
            {t("wo.openedOn", { date: fmtCairo(wo.opened_at, "YYYY/MM/DD", i18n.language) })}
          </span>
          {wo.closed_at && (
            <span>
              {t("wo.closedOn", { date: fmtCairo(wo.closed_at, "YYYY/MM/DD", i18n.language) })}
            </span>
          )}
          <span>
            {wo.odometer_at_open != null
              ? t("wo.listOdometer", { km: fmtKm(wo.odometer_at_open, i18n.language) })
              : t("wo.listNoOdometer")}
          </span>
          <span className={cn(allDone && "font-semibold text-status-ok")}>
            {wo.task_count > 0
              ? t("wo.listTasks", { done: n(wo.done_count), total: n(wo.task_count) })
              : t("wo.listNoTasks")}
          </span>
        </div>
      </div>
      <ChevronRight className="h-5 w-5 flex-none text-muted-foreground rtl:-scale-x-100" />
    </Link>
  );
}
