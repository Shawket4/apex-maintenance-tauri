import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ClipboardCheck, CloudOff, Loader2, RefreshCw } from "lucide-react";

import { commands, isOffline, unwrap, type StockMovementRow } from "@/shared/api/client";
import { useStockMovementsRefresh, useSyncStatus } from "@/shared/api/queries";
import { errorText, notifyError } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";
import {
  MOVEMENT_RANGES,
  describeMovement,
  movementItemLabel,
  movementTotals,
  rangeToDays,
  rangeToFrom,
  type MovementRange,
} from "@/shared/lib/movements";
import { Button } from "@/shared/ui/button";
import { QueryState } from "@/shared/ui/query-state";
import { PageShell } from "@/widgets/layout/PageShell";
import { Chip } from "@/widgets/tires/parts";

const KINDS = ["all", "tire", "oil", "battery"] as const;
type Kind = (typeof KINDS)[number];
const RANGES = MOVEMENT_RANGES;

/** Rows shown at first, and added by each "show more". */
const PAGE = 50;
/** The app reads the saved ledger in pages of this size (its own maximum). */
const READ_PAGE = 200;
const READ_PAGES_MAX = 100;

/** When this device last brought the ledger from the fleet system. */
const STAMP_KEY = "apex-movements-updated";
type Stamp = { at: string; days: number };
function readStamp(): Stamp | null {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(STAMP_KEY) ?? "null");
    if (v && typeof v === "object" && "at" in v && "days" in v && typeof v.at === "string" && typeof v.days === "number") {
      return { at: v.at, days: v.days };
    }
  } catch {
    // storage unavailable — the hint just does not show
  }
  return null;
}
function writeStamp(s: Stamp) {
  try {
    window.localStorage.setItem(STAMP_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable
  }
}

export const Route = createFileRoute("/_app/stock/movements")({
  // Filter + range live in the URL so back-navigation restores them.
  validateSearch: (s: Record<string, unknown>): { kind?: "tire" | "oil" | "battery"; range?: MovementRange } => {
    const range = (RANGES as readonly unknown[]).includes(s.range) ? (s.range as MovementRange) : undefined;
    return {
      ...(s.kind === "tire" || s.kind === "oil" || s.kind === "battery" ? { kind: s.kind } : {}),
      ...(range && range !== "30" ? { range } : {}),
    };
  },
  component: StockMovements,
});

/** Every saved movement of the period, read from this device (works with no
 * network). It is read whole, not page by page, so the totals are true. */
function useRangeMovements(from: string | undefined) {
  return useQuery({
    queryKey: ["stock-movements", "range", from ?? "all"],
    queryFn: async () => {
      const rows: StockMovementRow[] = [];
      for (let page = 0; page < READ_PAGES_MAX; page++) {
        const chunk = await unwrap(commands.stockMovements(null, from ?? null, READ_PAGE, page * READ_PAGE));
        rows.push(...chunk);
        if (chunk.length < READ_PAGE) break;
      }
      return rows;
    },
  });
}

/** The stock in/out ledger for tires, oil and batteries. The list is read from this
 * device; opening the screen (or picking a period) brings that period from
 * the fleet system when there is a connection. */
function StockMovements() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const search = Route.useSearch();
  const kind: Kind = search.kind ?? "all";
  const range: MovementRange = search.range ?? "30";
  const navigate = Route.useNavigate();

  const from = rangeToFrom(range);
  const movements = useRangeMovements(from);
  const online = useSyncStatus().data?.online;

  const refresh = useStockMovementsRefresh();
  const { mutate: refreshMutate } = refresh;
  const [stamp, setStamp] = useState<Stamp | null>(readStamp);
  // Which periods were brought fresh while this screen has been open.
  const [fresh, setFresh] = useState<ReadonlySet<MovementRange>>(new Set());
  const [failed, setFailed] = useState<{ range: MovementRange; error: unknown } | null>(null);

  const pull = (r: MovementRange, loud: boolean) => {
    const days = rangeToDays(r);
    refreshMutate(days, {
      onSuccess: () => {
        const s = { at: new Date().toISOString(), days };
        writeStamp(s);
        setStamp(s);
        setFailed(null);
        // A wider period covers the narrower ones.
        setFresh((prev) => new Set([...prev, ...RANGES.filter((x) => rangeToDays(x) <= days)]));
      },
      onError: (error) => {
        setFailed({ range: r, error });
        if (loud) notifyError(error);
      },
    });
  };

  // Once per period per visit — never in a loop. Known-offline: do not even
  // try; the notice below says what is being shown.
  const tried = useRef(new Set<MovementRange>());
  useEffect(() => {
    if (tried.current.has(range) || online === false) return;
    tried.current.add(range);
    pull(range, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, online]);

  const setKind = (k: Kind) =>
    void navigate({ search: (p) => ({ ...p, kind: k === "all" ? undefined : k }), replace: true });
  const setRange = (r: MovementRange) =>
    void navigate({ search: (p) => ({ ...p, range: r === "30" ? undefined : r }), replace: true });

  const isFresh = fresh.has(range);
  const failure = failed?.range === range ? failed.error : null;
  const offline = online === false || (failure != null && isOffline(failure));

  return (
    <PageShell title={t("movements.title")} subtitle={<span className="text-sm">{t("movements.subtitle")}</span>}>
      <div className="space-y-3">
        <div role="group" aria-label={t("movements.rangeLabel")} className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <Chip key={r} active={range === r} onClick={() => setRange(r)}>
              {t(`movements.range.${r}`)}
            </Chip>
          ))}
        </div>
        <div role="group" aria-label={t("movements.kindLabel")} className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
              {t(`movements.filter.${k}`)}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border bg-card p-3 text-sm">
          <div className="min-w-0 space-y-1">
            {refresh.isPending ? (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-4 w-4 flex-none animate-spin" />
                {t("movements.updating")}
              </p>
            ) : isFresh ? (
              <p className="text-muted-foreground">{t("movements.upToDate")}</p>
            ) : offline ? (
              <p className="flex items-start gap-1.5 text-status-due_soon">
                <CloudOff className="mt-0.5 h-4 w-4 flex-none" />
                <span>{t("movements.offlineNotice")}</span>
              </p>
            ) : failure != null ? (
              <p className="flex items-start gap-1.5 text-status-due_soon">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                <span>{t("movements.refreshFailed", { why: errorText(failure) })}</span>
              </p>
            ) : null}
            {stamp && !refresh.isPending && (
              <p className="text-muted-foreground">
                {t("movements.lastUpdated", { at: fmtCairo(stamp.at, "YYYY/MM/DD HH:mm", lang) })}
              </p>
            )}
            {!isFresh && !refresh.isPending && (offline || failure != null) && (
              <p className="text-muted-foreground">{t("movements.savedOnly")}</p>
            )}
          </div>
          <Button variant="outline" disabled={refresh.isPending} onClick={() => pull(range, true)}>
            {refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("movements.refresh")}
          </Button>
        </div>
      </div>

      <QueryState query={movements}>
        {(all) => (
          <Ledger
            // A new filter starts from the top of the list again.
            key={`${kind}|${range}`}
            all={all}
            kind={kind}
            rangeLabel={t(`movements.range.${range}`)}
            refreshing={refresh.isPending}
          />
        )}
      </QueryState>
    </PageShell>
  );
}

function Ledger({
  all,
  kind,
  rangeLabel,
  refreshing,
}: {
  all: StockMovementRow[];
  kind: Kind;
  rangeLabel: string;
  refreshing: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [shown, setShown] = useState(PAGE);
  const totals = movementTotals(all);
  const rows = kind === "all" ? all : all.filter((m) => describeMovement(m).item === kind);
  const unmirrored = all.filter((m) => m.mirror_error).length;

  return (
    <>
      <section aria-labelledby="mv-totals">
        <h2 id="mv-totals" className="mb-2 text-base font-bold">
          {t("movements.totalsTitle", { range: rangeLabel })}
        </h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Total label={t("movements.totals.tiresIn")} value={fmtNumber(totals.tiresIn, lang)} tone="in" />
          <Total label={t("movements.totals.tiresOut")} value={fmtNumber(totals.tiresOut, lang)} tone="out" />
          <Total label={t("movements.totals.oilIn")} value={fmtNumber(totals.oilIn, lang)} tone="in" />
          <Total label={t("movements.totals.oilOut")} value={fmtNumber(totals.oilOut, lang)} tone="out" />
          <Total label={t("movements.totals.batteriesIn")} value={fmtNumber(totals.batteriesIn, lang)} tone="in" />
          <Total label={t("movements.totals.batteriesOut")} value={fmtNumber(totals.batteriesOut, lang)} tone="out" />
        </dl>
        {(totals.tiresCounted !== 0 || totals.oilCounted !== 0 || totals.batteriesCounted !== 0) && (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("movements.countsNote", {
              tires: signed(totals.tiresCounted, lang),
              oil: signed(totals.oilCounted, lang),
              batteries: signed(totals.batteriesCounted, lang),
            })}
          </p>
        )}
        {unmirrored > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-sm text-status-due_soon">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <span>{t("movements.unmirroredCount", { n: fmtNumber(unmirrored, lang) })}</span>
          </p>
        )}
      </section>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {refreshing ? t("movements.updating") : all.length > 0 ? t("movements.emptyKind") : t("movements.empty")}
        </div>
      ) : (
        <section aria-label={t("movements.title")}>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
            {rows.slice(0, shown).map((m) => (
              <MovementRow key={m.id} m={m} />
            ))}
          </ul>
          <div className="mt-3 flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {t("movements.shownOf", {
                shown: fmtNumber(Math.min(shown, rows.length), lang),
                total: fmtNumber(rows.length, lang),
              })}
            </p>
            {rows.length > shown && (
              <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                {t("movements.loadMore")}
              </Button>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone: "in" | "out" }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("text-2xl font-bold tabular", tone === "in" ? "text-status-ok" : "text-status-overdue")}>
        {value}
      </dd>
    </div>
  );
}

function MovementRow({ m }: { m: StockMovementRow }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const info = describeMovement(m);
  const isIn = info.direction === "in";
  // A count correction ("we counted N") is neither a delivery nor a use.
  const isCount = m.is_count;
  const signed = `${isIn ? "+" : "−"}${fmtNumber(info.amount, lang)}`;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full",
          isCount
            ? "bg-info-soft text-info"
            : isIn
              ? "bg-status-ok-soft text-status-ok"
              : "bg-status-overdue-soft text-status-overdue",
        )}
      >
        {isCount ? (
          <ClipboardCheck className="h-4 w-4" />
        ) : isIn ? (
          <ArrowDownLeft className="h-4 w-4" />
        ) : (
          <ArrowUpRight className="h-4 w-4" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <bdi className="font-semibold">{movementItemLabel(m)}</bdi>
          <span
            className={cn(
              "flex-none rounded-full px-2 py-0.5 text-xs font-semibold",
              info.item === "oil"
                ? "bg-info-soft text-info"
                : info.item === "battery"
                  ? "bg-violet-soft text-violet"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {t(`movements.filter.${info.item}`)}
          </span>
        </div>

        <p className="mt-0.5 text-sm">
          {isCount ? (
            <>
              <span className="font-semibold">
                {t("movements.what.count")}{" "}
                <bdi dir="ltr" className="tabular">
                  {signed}
                </bdi>
                {info.item === "oil" && ` ${t("common.liters")}`}
              </span>
              <span className="text-muted-foreground">
                {" — "}
                {t(isIn ? "movements.what.countMore" : "movements.what.countLess")}
              </span>
            </>
          ) : info.adjustment ? (
            t(isIn ? "movements.what.adjustIn" : "movements.what.adjustOut")
          ) : isIn ? (
            t("movements.what.received")
          ) : m.plate ? (
            <>
              {t("movements.what.usedOn")}{" "}
              {m.work_order_id ? (
                <Link
                  to="/wo/$woId"
                  params={{ woId: m.work_order_id }}
                  className="font-semibold text-primary underline-offset-4 hover:underline"
                >
                  <bdi>{m.plate}</bdi>
                </Link>
              ) : (
                <bdi className="font-semibold">{m.plate}</bdi>
              )}
            </>
          ) : (
            t("movements.what.used")
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          <span className="tabular">{fmtCairo(m.created_at, "YYYY/MM/DD HH:mm", lang)}</span>
          {m.user_name?.trim() && (
            <>
              {" · "}
              {t("movements.by")} <bdi className="font-medium text-foreground">{m.user_name.trim()}</bdi>
            </>
          )}
        </p>

        {m.note && (
          <p className="mt-1 text-sm">
            <span className="text-muted-foreground">{t("movements.note")}</span> <bdi>{m.note}</bdi>
          </p>
        )}

        {m.mirror_error && (
          <details className="mt-1.5 rounded-lg bg-status-due_soon-soft px-3 py-2 text-sm">
            <summary className="cursor-pointer font-semibold text-status-due_soon">
              {t("movements.notMirrored")}{" "}
              <span className="font-normal text-muted-foreground">{t("movements.notMirroredWhy")}</span>
            </summary>
            <p className="mt-1 text-muted-foreground">{t("movements.notMirroredHelp")}</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              <bdi dir="ltr">{m.mirror_error}</bdi>
            </p>
          </details>
        )}
      </div>

      <div
        className={cn(
          "flex-none text-end font-bold",
          isCount ? "text-info" : isIn ? "text-status-ok" : "text-status-overdue",
        )}
      >
        <span dir="ltr" className="text-base tabular">
          {signed}
        </span>
        {info.item === "oil" && <span className="ms-1 text-sm font-semibold">{t("common.liters")}</span>}
      </div>
    </li>
  );
}

/** "+3" / "−2" / "0", in the language's digits, read left to right. */
function signed(n: number, lang: string): string {
  const body = fmtNumber(Math.abs(n), lang);
  return n > 0 ? `\u2066+${body}\u2069` : n < 0 ? `\u2066−${body}\u2069` : body;
}
