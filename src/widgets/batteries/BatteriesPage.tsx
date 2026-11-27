import { useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { History, Search, X } from "lucide-react";

import type { BatteryRow } from "@/shared/api/client";
import { useBatteries } from "@/shared/api/queries";
import { matches } from "@/shared/lib/normalize";
import { fmtCairo } from "@/shared/lib/time";
import { fmtNumber } from "@/shared/lib/numbers";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { QueryState } from "@/shared/ui/query-state";
import { StatusChip } from "@/shared/ui/status-chip";
import { PageShell } from "@/widgets/layout/PageShell";
import { StockPanel } from "@/widgets/stock/StockPanel";
import { Chip, Heading } from "@/widgets/tires/parts";

import { BatteryStatusActions } from "./BatteryBay";
import { BatteryHistoryDialog } from "./BatteryDialogs";
import { BATTERY_BADGE, BATTERY_STATUSES, batteryName, batteryRating, fmtYmd, warrantyPast } from "./lib";

const FILTERS = ["all", ...BATTERY_STATUSES] as const;
type Filter = (typeof FILTERS)[number];
const PAGE = 60;

/** Every battery the garage has a record of: new ones on the shelf at the
 * top (with receiving and counting), then each battery — where it is, its
 * warranty, and for one that is off a truck, where it is now. */
export function BatteriesPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const search = useSearch({ from: "/_app/batteries/" });
  const navigate = useNavigate({ from: "/batteries/" });
  const status = (search.status ?? "all") as Filter;
  const q = search.q ?? "";
  const [shown, setShown] = useState(PAGE);
  const [opened, setOpened] = useState<BatteryRow | null>(null);
  const batteries = useBatteries();

  const setStatus = (v: Filter) => {
    setShown(PAGE);
    void navigate({ search: (prev) => ({ ...prev, status: v === "all" ? undefined : v }), replace: true });
  };
  const setQ = (v: string) => {
    setShown(PAGE);
    void navigate({ search: (prev) => ({ ...prev, q: v || undefined }), replace: true });
  };

  const found = useMemo(
    () =>
      (batteries.data ?? []).filter((b) =>
        matches(
          `${b.brand} ${b.model ?? ""} ${batteryRating(b)} ${b.serial ?? ""} ${b.date_code ?? ""} ${b.plate ?? ""}`,
          q,
        ),
      ),
    [batteries.data, q],
  );

  return (
    <PageShell title={t("batteries.page.title")} subtitle={t("batteries.page.subtitle")}>
      <StockPanel only="battery" />

      <section aria-labelledby="batteries-heading">
        <Heading>
          <span id="batteries-heading">{t("batteries.page.listTitle")}</span>
        </Heading>

        <div className="mb-3 space-y-1.5">
          <Label htmlFor="battery-search">{t("batteries.page.searchLabel")}</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="battery-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("batteries.page.searchPlaceholder")}
              className="ps-9 pe-12 [&::-webkit-search-cancel-button]:hidden"
              dir="auto"
              autoComplete="off"
            />
            {q && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("batteries.page.clearSearch")}
                className="absolute end-0 top-1/2 -translate-y-1/2"
                onClick={() => setQ("")}
              >
                <X />
              </Button>
            )}
          </div>
        </div>

        <QueryState query={batteries}>
          {() => {
            const counts: Record<string, number> = {};
            for (const b of found) counts[b.status] = (counts[b.status] ?? 0) + 1;
            const list = status === "all" ? found : found.filter((b) => b.status === status);
            return (
              <>
                <div role="group" aria-label={t("batteries.page.filterLabel")} className="mb-3 flex flex-wrap gap-2">
                  {FILTERS.map((s) => (
                    <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
                      {s === "all" ? t("common.all") : t(`batteries.status.${s}`)}
                      <span className="tabular opacity-80">
                        {fmtNumber(s === "all" ? found.length : (counts[s] ?? 0), lang)}
                      </span>
                    </Chip>
                  ))}
                </div>

                {list.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    <p>
                      {q.trim()
                        ? t("batteries.page.noMatch")
                        : status !== "all"
                          ? t("batteries.page.noneInStatus")
                          : t("batteries.page.empty")}
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
                        {t("batteries.page.showAll")}
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
                      {list.slice(0, shown).map((b) => (
                        <BatteryListRow key={b.id} battery={b} onOpen={() => setOpened(b)} />
                      ))}
                    </ul>
                    {list.length > shown && (
                      <div className="mt-3 flex flex-col items-center gap-1">
                        <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                          {t("batteries.page.showMore")}
                        </Button>
                        <p className="text-sm text-muted-foreground">
                          {t("batteries.page.shownOf", {
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

      {opened && <BatteryHistoryDialog battery={opened} onClose={() => setOpened(null)} />}
    </PageShell>
  );
}

function BatteryListRow({ battery: b, onOpen }: { battery: BatteryRow; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const rating = batteryRating(b, true);
  const expired = warrantyPast(b.warranty_until);
  return (
    <li className="space-y-2.5 px-4 py-3.5">
      <div className="grid gap-x-6 gap-y-1.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1fr)] md:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <bdi className="font-semibold">{batteryName(b)}</bdi>
            <StatusChip tone={BATTERY_BADGE[b.status] ?? ""}>{t(`batteries.status.${b.status}`)}</StatusChip>
            {b.pending && <Badge variant="outline">{t("batteries.pending")}</Badge>}
          </div>
          {rating && (
            <div className="text-sm text-muted-foreground">
              <bdi dir="ltr">{rating}</bdi>
            </div>
          )}
          <div className="text-sm text-muted-foreground">
            {b.serial ? (
              <>
                {t("batteries.serialShort")} <bdi dir="ltr" className="whitespace-nowrap">{b.serial}</bdi>
              </>
            ) : (
              t("batteries.noSerial")
            )}
            {b.date_code && (
              <>
                {" · "}
                {t("batteries.dateCodeShort")} <bdi dir="ltr">{b.date_code}</bdi>
              </>
            )}
          </div>
        </div>

        <div className="min-w-0 text-sm">
          {b.vehicle_id != null ? (
            <>
              <span className="text-muted-foreground">{t("batteries.page.onTruck")}</span>{" "}
              <Link
                to="/trucks/$truckId/batteries"
                params={{ truckId: String(b.vehicle_id) }}
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                <bdi>{b.plate ?? `#${b.vehicle_id}`}</bdi>
              </Link>
              {b.slot != null && (
                <span className="block text-muted-foreground">
                  {t("batteries.slot", { n: fmtNumber(b.slot, lang) })}
                  {b.installed_at && ` · ${t("batteries.page.since", { date: fmtCairo(b.installed_at, "YYYY/MM/DD", lang) })}`}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">{t(`batteries.where.${b.status}`, t("batteries.where.other"))}</span>
          )}
        </div>

        <div className="text-sm">
          {b.warranty_until ? (
            <span className={expired ? "font-semibold text-status-overdue" : undefined}>
              {expired
                ? t("batteries.warrantyEnded", { date: fmtYmd(b.warranty_until, lang) })
                : t("batteries.warrantyUntil", { date: fmtYmd(b.warranty_until, lang) })}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("batteries.noWarranty")}</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onOpen}>
          <History />
          {t("batteries.page.openHistory")}
        </Button>
        <BatteryStatusActions battery={b} />
      </div>
    </li>
  );
}
