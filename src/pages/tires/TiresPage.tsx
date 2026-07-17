/**
 * Tire inventory — the storeman's surface. Filter by lifecycle status, add
 * tires by DOT, expand a row for its mount history.
 */

import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  useTireCreate,
  useTireHistory,
  useTires,
  type TireRow,
  type TireStatus,
} from "@/shared/api/tires";
import { appErrorMessage } from "@/shared/api/tauri";
import { SearchInput } from "@/shared/ui/SearchInput";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { cn } from "@/shared/lib/cn";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";

const STATUSES: Array<TireStatus | "all"> = ["all", "in_stock", "mounted", "in_repair", "retreading", "scrapped"];

const STATUS_DOT: Record<TireStatus, string> = {
  in_stock: "bg-sky-500",
  mounted: "bg-emerald-500",
  in_repair: "bg-amber-500",
  retreading: "bg-violet-500",
  scrapped: "bg-red-500",
};

function HistoryRows({ tireId }: { tireId: string }) {
  const { t } = useTranslation();
  const { data } = useTireHistory(tireId);
  if (!data) return <p className="px-4 py-3 text-xs text-muted-foreground">{t("common.loading")}</p>;
  if (data.length === 0)
    return <p className="px-4 py-3 text-xs text-muted-foreground">{t("tiresPage.noHistory")}</p>;
  return (
    <div className="divide-y divide-border/60 bg-muted/20">
      {data.map((h) => (
        <div key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-6 py-2 text-xs">
          <span className="font-semibold tabular-nums">{h.position_code}</span>
          <span dir="rtl" className="tabular-nums">{h.car_no_plate}</span>
          <span className="text-muted-foreground tabular-nums">
            {fmtCairo(h.mounted_at, "YYYY/MM/DD")}
            {h.dismounted_at ? ` ← ${fmtCairo(h.dismounted_at, "YYYY/MM/DD")}` : ` — ${t("tiresPage.stillMounted")}`}
          </span>
          {h.mounted_odometer != null && h.dismounted_odometer != null && (
            <span className="tabular-nums text-muted-foreground">
              {fmtNumber(h.dismounted_odometer - h.mounted_odometer)} {t("common.km")}
            </span>
          )}
          <span className="text-muted-foreground">{t(`tires.reasons.${h.mount_reason}`)}</span>
        </div>
      ))}
    </div>
  );
}

export function TiresPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TireStatus | "all">("all");
  const { data: tires } = useTires(status === "all" ? undefined : status);
  const createTire = useTireCreate();

  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [dot, setDot] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [cost, setCost] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (tires ?? []).filter(
      (x) =>
        !needle ||
        x.dot_code.toLowerCase().includes(needle) ||
        x.brand.toLowerCase().includes(needle) ||
        (x.model ?? "").toLowerCase().includes(needle),
    );
  }, [tires, q]);

  const submit = async () => {
    if (!dot.trim() || !brand.trim()) {
      toast.error(t("tiresPage.missingFields"));
      return;
    }
    try {
      await createTire.mutateAsync({
        dot_code: dot.trim(),
        brand: brand.trim(),
        model: model || null,
        purchase_cost: cost ? Number(cost) : null,
      });
      toast.success(t("tiresPage.added"));
      setOpen(false);
      setDot("");
      setBrand("");
      setModel("");
      setCost("");
    } catch (e) {
      toast.error(appErrorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("tiresPage.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("tiresPage.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("tiresPage.search")} />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                {t("tiresPage.add")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t("tiresPage.add")}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="tire-dot">{t("tiresPage.dot")}</Label>
                  <Input id="tire-dot" dir="ltr" className="font-mono" value={dot} onChange={(e) => setDot(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tire-brand">{t("tiresPage.brand")}</Label>
                  <Input id="tire-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tire-model">{t("tiresPage.model")}</Label>
                  <Input id="tire-model" value={model} onChange={(e) => setModel(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tire-cost">{t("records.cost")}</Label>
                  <Input id="tire-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={submit} disabled={createTire.isPending}>
                  {t("actions.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <Button
            key={s}
            variant={status === s ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setStatus(s)}
          >
            {s === "all" ? t("common.all") : t(`tires.statuses.${s}`)}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {filtered.map((tire: TireRow) => (
            <Fragment key={tire.id}>
              <button
                type="button"
                className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-start hover:bg-muted/40 transition-colors"
                onClick={() => setExpanded(expanded === tire.id ? null : tire.id)}
              >
                <i className={cn("h-2.5 w-2.5 rounded-full", STATUS_DOT[tire.status])} />
                <span className="font-mono text-sm min-w-44" dir="ltr">
                  {tire.dot_code}
                </span>
                <span className="min-w-28">{tire.brand}</span>
                {tire.model && <span className="text-sm text-muted-foreground">{tire.model}</span>}
                <span className="text-xs text-muted-foreground">{t(`tires.statuses.${tire.status}`)}</span>
                {tire.is_retread ? (
                  <span className="text-xs rounded-full bg-violet-500/10 text-violet-600 border border-violet-500/30 px-2 py-0.5">
                    {t("tiresPage.retread")}
                  </span>
                ) : null}
                {tire.purchase_cost != null && (
                  <span className="ms-auto text-sm tabular-nums text-muted-foreground">
                    {fmtNumber(tire.purchase_cost)} {t("common.egp")}
                  </span>
                )}
                <ChevronDown
                  className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded === tire.id && "rotate-180")}
                />
              </button>
              {expanded === tire.id && <HistoryRows tireId={tire.id} />}
            </Fragment>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-sm text-muted-foreground text-center">{t("tiresPage.empty")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
