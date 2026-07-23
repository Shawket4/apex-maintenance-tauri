import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PackagePlus, Plus, Trash2 } from "lucide-react";

import { commands, unwrap, type LegacyTireInput } from "@/shared/api/client";
import { useDomainMutation, useStock, useTires } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { TIRE_BADGE } from "@/shared/lib/status";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { EmptyState, ListCard, PageShell, Section } from "@/widgets/layout/PageShell";

export const Route = createFileRoute("/_app/tires/")({
  // Filter + search live in the URL so back-navigation (e.g. from a tire
  // file) restores the exact list state.
  validateSearch: (s: Record<string, unknown>): { status?: string; q?: string } => ({
    ...(typeof s.status === "string" && s.status !== "all" && s.status ? { status: s.status } : {}),
    ...(typeof s.q === "string" && s.q ? { q: s.q } : {}),
  }),
  component: TiresPage,
});

const STATUS_FILTERS = ["all", "mounted", "in_stock_used", "in_repair", "retreading", "scrapped"] as const;

function TiresPage() {
  const { t, i18n } = useTranslation();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const status = search.status ?? "all";
  const q = search.q ?? "";
  const setStatus = (v: string) =>
    void navigate({
      search: (prev) => ({ ...prev, status: v === "all" ? undefined : v }),
      replace: true,
    });
  const setQ = (v: string) =>
    void navigate({ search: (prev) => ({ ...prev, q: v || undefined }), replace: true });
  const stock = useStock();
  const tires = useTires(status === "all" ? undefined : status, q || undefined);

  return (
    <PageShell title={t("tires.title")} actions={<LegacyIntakeDialog />}>
      {/* Fungible stock — projected on-hand with pending debits visible. */}
      <Section title={t("tires.stock.title")}>
        {stock.isLoading ? (
          <Skeleton className="h-16" />
        ) : (stock.data?.tires ?? []).length === 0 ? (
          <EmptyState className="p-6">{t("tires.stock.empty")}</EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(stock.data?.tires ?? []).map((line) => (
              <div key={line.id} className="rounded-xl border bg-card p-3.5 shadow-sm">
                <div className="font-semibold" dir="ltr">
                  {line.brand} {line.model ?? ""}
                </div>
                <div className="text-xs text-muted-foreground" dir="ltr">
                  {line.size ?? ""}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    className={cn(
                      "text-2xl font-bold tabular",
                      line.projected_qty <= 0 && "text-status-overdue",
                      line.projected_qty > 0 && line.projected_qty <= 4 && "text-status-due_soon",
                    )}
                  >
                    {fmtNumber(line.projected_qty, i18n.language)}
                  </span>
                  <span className="text-xs text-muted-foreground">{t("tires.stock.projected")}</span>
                  {line.pending_debits > 0 && (
                    <span className="text-xs text-info tabular">
                      −{fmtNumber(line.pending_debits, i18n.language)} {t("tires.stock.pending")}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div className="rounded-xl border border-dashed p-3.5">
              <div className="text-xs text-muted-foreground">{t("tires.stock.usedPool")}</div>
              <div className="mt-2 text-2xl font-bold tabular">
                {fmtNumber(stock.data?.used_pool_count ?? 0, i18n.language)}
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* Individual assets */}
      <Section
        title={t("tires.assets.title")}
        action={
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("tires.assets.searchPlaceholder")}
            className="h-8 w-56"
            dir="auto"
          />
        }
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition",
                status === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card hover:bg-accent",
              )}
            >
              {s === "all" ? t("common.all") : t(`tires.status.${s}`)}
            </button>
          ))}
        </div>

        {tires.isLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : (tires.data ?? []).length === 0 ? (
          <EmptyState className="p-10">{t("tires.assets.empty")}</EmptyState>
        ) : (
          <ListCard>
            <table className="w-full text-sm">
              <thead className="bg-background/70 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start">{t("tires.dot")}</th>
                  <th className="px-3 py-2 text-start">{t("tires.brand")}</th>
                  <th className="px-3 py-2 text-start">{t("tires.totalKm")}</th>
                  <th className="px-3 py-2 text-start">{t("tires.mountedOn")}</th>
                  <th className="px-3 py-2 text-start" />
                </tr>
              </thead>
              <tbody>
                {(tires.data ?? []).map((tire) => (
                  <tr key={tire.id} className="border-t transition hover:bg-primary/[0.03]">
                    <td className="px-3 py-2">
                      <Link
                        to="/tires/$tireId"
                        params={{ tireId: tire.id }}
                        className="font-medium text-primary hover:underline"
                        dir="ltr"
                      >
                        {tire.dot_code ?? "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {tire.brand} {tire.model ?? ""}
                    </td>
                    <td className="px-3 py-2 tabular">{fmtNumber(tire.total_km, i18n.language)}</td>
                    <td className="px-3 py-2">
                      {tire.mounted_plate ? (
                        <span>
                          {tire.mounted_plate}
                          <span className="ms-1 text-xs text-muted-foreground" dir="ltr">
                            {tire.mounted_position_code}
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs", TIRE_BADGE[tire.status])}>
                        {t(`tires.status.${tire.status}`)}
                      </span>
                      {tire.pending && (
                        <Badge variant="outline" className="ms-1 text-[10px]">
                          {t("wo.pending")}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ListCard>
        )}
      </Section>
    </PageShell>
  );
}

/** Bulk intake of used tires sitting in the yard → individuated used stock. */
function LegacyIntakeDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const empty = { brand: "", model: null, size: null, dot_code: null, estimated_km: null };
  const [rows, setRows] = useState<LegacyTireInput[]>([{ ...empty }]);

  const set = (i: number, patch: Partial<LegacyTireInput>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const valid = rows.filter((r) => r.brand.trim());
  const submit = useDomainMutation(() => unwrap(commands.intakeLegacy(valid)), {
    onSuccess: () => {
      notifySuccess(t("tires.intake.done"));
      setOpen(false);
      setRows([{ ...empty }]);
    },
    onError: notifyError,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <PackagePlus className="h-4 w-4" />
          {t("tires.intake.title")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("tires.intake.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("tires.intake.subtitle")}</p>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder={t("tires.brand")}
                value={row.brand}
                onChange={(e) => set(i, { brand: e.target.value })}
                dir="ltr"
              />
              <Input
                placeholder={t("tires.size")}
                value={row.size ?? ""}
                onChange={(e) => set(i, { size: e.target.value || null })}
                dir="ltr"
                className="w-32"
              />
              <Input
                placeholder={t("tires.dot")}
                value={row.dot_code ?? ""}
                onChange={(e) => set(i, { dot_code: e.target.value || null })}
                dir="ltr"
                className="w-36"
              />
              <Input
                placeholder={t("tires.intake.estimatedKm")}
                inputMode="numeric"
                className="w-28 tabular"
                value={row.estimated_km ?? ""}
                onChange={(e) =>
                  set(i, { estimated_km: e.target.value ? Number(e.target.value) : null })
                }
              />
              <button
                aria-label={t("common.delete")}
                onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => setRows((r) => [...r, { ...empty }])}>
            <Plus className="h-4 w-4" />
            {t("tires.intake.addRow")}
          </Button>
          <Button disabled={valid.length === 0 || submit.isPending} onClick={() => submit.mutate()}>
            {t("tires.intake.submit", { count: valid.length })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
