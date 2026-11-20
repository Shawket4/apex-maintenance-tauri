import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";

import { commands, unwrap } from "@/shared/api/client";
import { useStock, useSyncStatus } from "@/shared/api/queries";
import { errorText, notifySuccess } from "@/shared/lib/notify";
import { fmtAgo, fmtCairo, nowUtcIso } from "@/shared/lib/time";
import { Button } from "@/shared/ui/button";

import { Note, SettingsCard } from "./parts";

type Key = "vehicles" | "reference" | "stock" | "invoices";
const ORDER: Key[] = ["vehicles", "reference", "stock", "invoices"];

const ACTIONS: Record<Key, () => Promise<unknown>> = {
  vehicles: () => unwrap(commands.vehiclesRefresh()),
  reference: () => unwrap(commands.referenceRefresh()),
  stock: () => unwrap(commands.stockRefresh()),
  invoices: () => unwrap(commands.invoicesRefresh()),
};

/** Query keys each download rewrites (never the AI answers: those are kept). */
const TOUCHES: Record<Key, string[]> = {
  vehicles: ["trucks", "truck", "home", "due", "search", "wos"],
  reference: ["classes", "categories", "plans", "due", "home", "trucks", "truck"],
  stock: ["stock", "home", "stock-movements"],
  invoices: ["invoices", "invoice"],
};

const WHEN = "YYYY/MM/DD h:mm A";

/** The lists this device copies from the fleet system (trucks, maintenance
 * types and plans, stock, old service invoices). They refresh by themselves;
 * this is the manual "get them now", one list at a time or all together,
 * with when each was last fetched. */
export function DataSection() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const qc = useQueryClient();
  const online = useSyncStatus().data?.online ?? false;
  const stock = useStock();
  const freshness = useQuery({
    queryKey: ["cache-freshness"],
    queryFn: () => unwrap(commands.cacheFreshnessGet()),
  });
  const [busy, setBusy] = useState<Partial<Record<Key, boolean>>>({});
  // The reference lists keep no "fetched at" of their own: remember this session's.
  const [doneAt, setDoneAt] = useState<Partial<Record<Key, string>>>({});
  const anyBusy = ORDER.some((k) => busy[k]);

  /** Runs one download; resolves to the error, or null when it worked. */
  const run = async (key: Key): Promise<unknown> => {
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await ACTIONS[key]();
      setDoneAt((d) => ({ ...d, [key]: nowUtcIso() }));
      return null;
    } catch (e) {
      console.error("[apex]", e);
      return e ?? new Error("refresh failed");
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
      for (const k of [...TOUCHES[key], "cache-freshness"]) void qc.invalidateQueries({ queryKey: [k] });
    }
  };

  const one = async (key: Key) => {
    if (busy[key]) return;
    const err = await run(key);
    if (err) toast.error(`${t(`settings.data.${key}`)}: ${errorText(err)}`);
    else notifySuccess(t("settings.data.updatedOne", { what: t(`settings.data.${key}`) }));
  };

  const all = async () => {
    if (anyBusy) return;
    const failed: Key[] = [];
    let firstError: unknown = null;
    for (const key of ORDER) {
      const err = await run(key);
      if (err) {
        failed.push(key);
        firstError ??= err;
      }
    }
    if (failed.length === 0) notifySuccess(t("settings.data.updatedAll"));
    else {
      toast.error(
        `${t("settings.data.someFailed", { list: failed.map((k) => t(`settings.data.${k}`)).join(t("settings.data.listJoin")) })} ${errorText(firstError)}`,
      );
    }
  };

  const fetchedAt = (key: Key): string | null => {
    const fresh = (name: string) => freshness.data?.find((r) => r.cache_name === name)?.fetched_at ?? null;
    if (key === "vehicles") return fresh("vehicles");
    if (key === "invoices") return fresh("service_invoices");
    if (key === "stock") {
      const times = [...(stock.data?.tires ?? []), ...(stock.data?.oil ?? [])]
        .map((l) => l.fetched_at)
        .filter((x): x is string => x != null)
        .sort();
      return times.length > 0 ? times[times.length - 1] : (doneAt.stock ?? null);
    }
    return doneAt.reference ?? null;
  };

  return (
    <SettingsCard
      id="data"
      title={t("settings.data.title")}
      description={t("settings.data.intro")}
      action={
        <Button variant="outline" disabled={!online || anyBusy} onClick={() => void all()}>
          {anyBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {t("settings.data.all")}
        </Button>
      }
    >
      {!online && <Note>{t("settings.data.offline")}</Note>}
      <ul className="divide-y rounded-lg border">
        {ORDER.map((key) => {
          const at = fetchedAt(key);
          return (
            <li key={key} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{t(`settings.data.${key}`)}</div>
                <div className="text-sm text-muted-foreground tabular">
                  {at
                    ? t("settings.data.lastAt", { when: `${fmtCairo(at, WHEN, locale)} (${fmtAgo(at, locale)})` })
                    : key === "reference"
                      ? t("settings.data.autoNote")
                      : t("settings.data.neverAt")}
                </div>
              </div>
              <Button variant="outline" size="sm" className="flex-none" disabled={!online || busy[key] === true} onClick={() => void one(key)}>
                {busy[key] ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {t("settings.data.one")}
              </Button>
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}
