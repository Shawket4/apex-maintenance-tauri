import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Search } from "lucide-react";

import { commands, unwrap, type PositionRow } from "@/shared/api/client";
import { useCatalog, useDomainMutation, useTires } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { norm } from "@/shared/lib/normalize";
import { fmtKm, fmtNumber, parseIntInput } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { NumberInput } from "@/shared/ui/number-input";
import { ErrorState } from "@/shared/ui/query-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { TireProductPicker, type TireSpec } from "@/widgets/catalog/pickers";

import { matchesSearch, sameSize, sortUsedTires } from "./pick";
import { Note, RadioCard } from "./Workbench";

type Source = "new" | "used";
const USED_REASONS = ["replacement", "rotation", "repair_return"] as const;

/** Fit a tire onto an empty wheel, inside an open work order. Two sources:
 *  - NEW from stock: one tire of the chosen type leaves stock; its DOT is
 *    written down now if the mechanic has it. A type the stock does not have
 *    never blocks the job: the tire is in the mechanic's hands and the count
 *    is corrected afterwards.
 *  - USED: one particular tire from the used pool. */
export function MountForm({
  position,
  vehicleId,
  workOrderId,
  defaultOdometer,
  preferredSize: likelySize,
  previousTireId,
  recentTireIds,
  onDone,
  onDirtyChange,
}: {
  position: PositionRow;
  vehicleId: number;
  workOrderId: string;
  /** The truck's current odometer, prefilled. */
  defaultOdometer: number | null;
  /** The size this wheel most likely takes, judged from the truck's other wheels. */
  preferredSize: string | null;
  /** The tire last taken off this wheel in this work order: when it is in
   * the used pool its size is the one to match. */
  previousTireId: string | null;
  /** Tires taken off this truck in this work order — a rotation picks from these. */
  recentTireIds: readonly string[];
  onDone: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const catalog = useCatalog();
  const usedPool = useTires("in_stock_used");

  const [source, setSource] = useState<Source>("new");
  const [spec, setSpec] = useState<TireSpec | null>(null);
  const [usedId, setUsedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dot, setDot] = useState("");
  const [odometer, setOdometer] = useState(defaultOdometer != null ? String(defaultOdometer) : "");
  const [usedReason, setUsedReason] = useState<string>("replacement");

  const previousSize = previousTireId ? usedPool.data?.find((x) => x.id === previousTireId)?.size : null;
  const preferredSize = previousSize ?? likelySize;

  const usedTires = useMemo(
    () => sortUsedTires(usedPool.data ?? [], { preferredSize, recentIds: recentTireIds }),
    [usedPool.data, preferredSize, recentTireIds],
  );
  const used = usedTires.find((x) => x.id === usedId) ?? null;
  // New-tire stock of the chosen type: null = this type is not in stock at
  // all; undefined = not known yet (the list is still loading).
  const onHand = useMemo(() => {
    if (!spec || !catalog.data) return undefined;
    const key = (x: TireSpec) => `${norm(x.brand)}|${norm(x.model)}|${norm(x.size)}`;
    return catalog.data.tire_products.find((p) => key(p) === key(spec))?.on_hand ?? null;
  }, [spec, catalog.data]);
  const km = parseIntInput(odometer);

  const dirty = !!(spec || usedId || dot.trim());
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const done = () => {
    notifySuccess(t("diagram.mount.done"));
    onDone();
  };

  const mountNew = useDomainMutation(
    () =>
      unwrap(
        commands.mountFromStock({
          position_id: position.id,
          vehicle_id: vehicleId,
          work_order_id: workOrderId,
          brand: spec!.brand.trim(),
          model: spec!.model.trim() || null,
          size: spec!.size.trim() || null,
          dot_code: dot.trim() || null,
          odometer: km,
        }),
      ),
    { onSuccess: done, onError: notifyError },
  );

  const mountUsed = useDomainMutation(
    () =>
      unwrap(
        commands.mountUsed({
          tire_id: usedId!,
          position_id: position.id,
          vehicle_id: vehicleId,
          work_order_id: workOrderId,
          odometer: km,
          reason: usedReason,
        }),
      ),
    { onSuccess: done, onError: notifyError },
  );

  const busy = mountNew.isPending || mountUsed.isPending;
  const newReady = !!spec?.brand.trim();
  const shownUsed = usedTires.filter((x) => matchesSearch(x, search));

  const sourceButton = (s: Source) => (
    <button
      type="button"
      role="radio"
      aria-checked={source === s}
      disabled={busy}
      onClick={() => {
        setSource(s);
        setSearch("");
      }}
      className={cn(
        "min-h-11 flex-1 rounded-md px-2 py-1.5 text-sm font-semibold transition",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        source === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {t(s === "new" ? "diagram.mount.fromNew" : "diagram.mount.fromUsed")}
    </button>
  );

  const searchBox = (id: string) => (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        type="search"
        aria-label={t("diagram.mount.search")}
        placeholder={t("diagram.mount.search")}
        className="ps-9"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
    </div>
  );

  const odometerField = (
    <div className="space-y-1.5">
      <Label htmlFor="mount-odo">{t("diagram.field.odometerNow")}</Label>
      <NumberInput id="mount-odo" value={odometer} onValueChange={setOdometer} />
      {km == null && !position.is_spare && <Note tone="warn">{t("diagram.field.odometerMissing")}</Note>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label={t("diagram.mount.sourceLabel")} className="flex gap-1 rounded-lg bg-muted p-1">
        {sourceButton("new")}
        {sourceButton("used")}
      </div>

      {source === "new" ? (
        <div className="space-y-4">
          <Note>{t("diagram.mount.newExplain")}</Note>

          <div className="space-y-1.5">
            <Label id="mount-type-label" htmlFor="mount-type">
              {t("diagram.mount.pickLine")}
            </Label>
            <TireProductPicker
              id="mount-type"
              aria-labelledby="mount-type-label"
              showStock
              disabled={busy}
              value={spec}
              onChange={setSpec}
            />
            {!newReady && <Note>{t("diagram.field.tireTypeRequired")}</Note>}
            {spec && onHand === null && <Note tone="warn">{t("diagram.mount.customWarn")}</Note>}
            {spec && onHand != null && onHand <= 0 && <Note tone="warn">{t("diagram.mount.zeroWarn")}</Note>}
            {spec && preferredSize && spec.size && !sameSize(spec.size, preferredSize) && (
              <Note tone="warn">{t("diagram.mount.sizeDiffers", { size: preferredSize })}</Note>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mount-dot">{t("diagram.field.dot")}</Label>
            <Input id="mount-dot" dir="ltr" autoComplete="off" value={dot} onChange={(e) => setDot(e.target.value)} />
            <Note>{t("diagram.field.dotHint")}</Note>
          </div>
          {odometerField}
          <Button className="w-full" disabled={!newReady || busy} onClick={() => mountNew.mutate()}>
            {mountNew.isPending && <Loader2 className="animate-spin" />}
            {t("diagram.mount.submitNew")}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {usedPool.isError && usedPool.data === undefined ? (
            <ErrorState error={usedPool.error} onRetry={() => void usedPool.refetch()} retrying={usedPool.isFetching} />
          ) : usedPool.isPending ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : usedTires.length === 0 ? (
            <div className="space-y-2 rounded-lg border border-dashed p-4 text-sm">
              <p className="font-semibold">{t("diagram.mount.noUsed")}</p>
              <p className="leading-relaxed text-muted-foreground">{t("diagram.mount.noUsedHow")}</p>
              <Link to="/tires" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
                {t("diagram.mount.goTires")}
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div id="mount-used" className="text-sm font-semibold">
                  {t("diagram.mount.pickUsed")}
                </div>
                {searchBox("mount-used-search")}
                <div role="radiogroup" aria-labelledby="mount-used" className="grid max-h-72 gap-2 overflow-y-auto pe-0.5">
                  {shownUsed.map((x) => (
                    <RadioCard
                      key={x.id}
                      checked={usedId === x.id}
                      onSelect={() => setUsedId(x.id)}
                      disabled={busy}
                      title={
                        <>
                          <bdi dir="ltr">{[x.brand, x.model].filter(Boolean).join(" ")}</bdi>
                          {" · "}
                          {x.size ? <bdi dir="ltr">{x.size}</bdi> : t("diagram.mount.noSize")}
                        </>
                      }
                      description={
                        <>
                          {x.dot_code ? (
                            <>
                              {t("diagram.tire.dot")} <bdi dir="ltr">{x.dot_code}</bdi>
                            </>
                          ) : (
                            <span className="font-semibold text-status-due_soon">{t("diagram.tire.noDot")}</span>
                          )}
                          {" · "}
                          {t("diagram.mount.ran", { km: fmtKm(x.total_km, lang) })}
                          {x.km_incomplete ? ` ${t("diagram.mount.kmAtLeast")}` : ""}
                          {" · "}
                          {x.retread_count > 0
                            ? t("diagram.mount.retreaded", { n: fmtNumber(x.retread_count, lang) })
                            : t("diagram.mount.notRetreaded")}
                        </>
                      }
                    >
                      {(recentTireIds.includes(x.id) || sameSize(x.size, preferredSize)) && (
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {recentTireIds.includes(x.id) && (
                            <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-semibold text-info">
                              {t("diagram.mount.justOff")}
                            </span>
                          )}
                          {sameSize(x.size, preferredSize) && (
                            <span className="rounded-full bg-status-ok-soft px-2 py-0.5 text-xs font-semibold text-status-ok">
                              {t("diagram.mount.sameSize")}
                            </span>
                          )}
                        </span>
                      )}
                    </RadioCard>
                  ))}
                  {shownUsed.length === 0 && <Note>{t("diagram.mount.noMatch")}</Note>}
                </div>
                {used && preferredSize && used.size && !sameSize(used.size, preferredSize) && (
                  <Note tone="warn">{t("diagram.mount.sizeDiffers", { size: preferredSize })}</Note>
                )}
              </div>

              <div className="space-y-2">
                <div id="mount-why" className="text-sm font-semibold">
                  {t("diagram.mount.reason")}
                </div>
                <div role="radiogroup" aria-labelledby="mount-why" className="grid gap-2">
                  {USED_REASONS.map((r) => (
                    <RadioCard
                      key={r}
                      checked={usedReason === r}
                      onSelect={() => setUsedReason(r)}
                      disabled={busy}
                      title={t(`diagram.mount.why.${r}`)}
                    />
                  ))}
                </div>
              </div>

              {odometerField}
              <Button className="w-full" disabled={!usedId || busy} onClick={() => mountUsed.mutate()}>
                {mountUsed.isPending && <Loader2 className="animate-spin" />}
                {t("diagram.mount.submitUsed")}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
