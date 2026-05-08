/**
 * Tiny "last refreshed Xm ago" pill, plus a refresh button.
 *
 * Status is derived from the cache_freshness row:
 *   fresh:    fetched_at + ttl > now      → green dot
 *   stale:    fetched_at + ttl <= now     → amber dot
 *   missing:  no row yet                   → grey dot, "—"
 */

import { useTranslation } from "react-i18next";
import { RefreshCw, Loader2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { dayjs, CAIRO_TZ } from "@/shared/lib/time";
import { freshnessFor, useCacheFreshness } from "@/shared/api/freshness";
import { cn } from "@/shared/lib/cn";

interface Props {
  cacheName: string;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function CacheFreshnessIndicator({ cacheName, onRefresh, isRefreshing }: Props) {
  const { t, i18n } = useTranslation();
  const { data: rows } = useCacheFreshness();
  const row = freshnessFor(rows, cacheName);
  const locale = i18n.language ?? "ar";

  const state: "fresh" | "stale" | "missing" = (() => {
    if (!row) return "missing";
    const fetchedAt = dayjs.utc(row.fetched_at);
    const ageSec = dayjs.utc().diff(fetchedAt, "second");
    return ageSec > row.ttl_seconds ? "stale" : "fresh";
  })();

  const dot =
    state === "fresh"
      ? "bg-emerald-500"
      : state === "stale"
        ? "bg-amber-500"
        : "bg-muted-foreground/40";

  const label = (() => {
    if (!row) return t("freshness.never");
    const fromNow = dayjs.utc(row.fetched_at).tz(CAIRO_TZ).locale(locale).fromNow();
    return t("freshness.last_refreshed", { ago: fromNow });
  })();

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="flex items-center gap-2 text-muted-foreground">
        <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />
        <span>{label}</span>
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={isRefreshing}
        title={t("actions.refresh")}
      >
        {isRefreshing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        <span className="ms-1.5">{t("actions.refresh")}</span>
      </Button>
    </div>
  );
}
