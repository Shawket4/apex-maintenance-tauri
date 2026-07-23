import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Wrench, ReceiptText, ArrowRight } from "lucide-react";
import { EmptyState } from "@/widgets/layout/PageShell";

import { useInvoice, useInvoices, useWos } from "@/shared/api/queries";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { Badge } from "@/shared/ui/badge";
import { Skeleton } from "@/shared/ui/skeleton";

export const Route = createFileRoute("/_app/trucks/$truckId/history")({
  component: TruckHistory,
});

type TimelineItem =
  | { kind: "wo"; id: string; date: string | null; title: string; count: number }
  | { kind: "invoice"; id: number; date: string | null; title: string; count: number };

/** One story of the truck from two systems: workshop work orders (local,
 * offline) ∪ Falcon service invoices (local cache), sorted together. */
function TruckHistory() {
  const { t, i18n } = useTranslation();
  const { truckId } = Route.useParams();
  const vid = Number(truckId);
  const navigate = useNavigate();
  const wos = useWos("closed", vid);
  const invoices = useInvoices(vid);
  const [openInvoice, setOpenInvoice] = useState<number | null>(null);
  const invoice = useInvoice(openInvoice);

  const timeline = useMemo<TimelineItem[]>(() => {
    const a: TimelineItem[] = (wos.data ?? []).map((w) => ({
      kind: "wo",
      id: w.id,
      date: w.closed_at ?? w.opened_at,
      title: w.plate,
      count: w.task_count,
    }));
    const b: TimelineItem[] = (invoices.data?.rows ?? []).map((inv) => ({
      kind: "invoice",
      id: inv.id,
      date: inv.date,
      title: inv.services_preview ?? "",
      count: Number(inv.item_count ?? 0),
    }));
    return [...a, ...b].sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""));
  }, [wos.data, invoices.data]);

  if (wos.isLoading || invoices.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (openInvoice != null) {
    return (
      <div>
        <button
          onClick={() => setOpenInvoice(null)}
          className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="h-4 w-4 ltr:rotate-180" /> {t("common.back")}
        </button>
        {invoice.data ? (
          <div className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm text-muted-foreground tabular">
                {fmtCairo(invoice.data.date, "YYYY/MM/DD", i18n.language)}
                {invoice.data.meter_reading != null &&
                  ` · ${fmtNumber(invoice.data.meter_reading, i18n.language)} ${t("common.km")}`}
              </div>
              <Badge variant="secondary">{t("truck.history.falcon")}</Badge>
            </div>
            <div className="mb-2 text-sm font-semibold">{t("truck.history.invoiceItems")}</div>
            <ul className="space-y-2">
              {invoice.data.items.map((it) => (
                <li key={it.id} className="rounded-lg bg-muted/50 p-3 text-sm">
                  <div>{it.service}</div>
                  {it.notes && <div className="mt-1 text-xs text-muted-foreground">{it.notes}</div>}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Skeleton className="h-40 rounded-2xl" />
        )}
      </div>
    );
  }

  if (timeline.length === 0) {
    return <EmptyState className="p-10">{t("truck.history.empty")}</EmptyState>;
  }

  return (
    <div className="space-y-2">
      {timeline.map((item) => (
        <button
          key={`${item.kind}-${item.id}`}
          onClick={() =>
            item.kind === "wo"
              ? void navigate({ to: "/wo/$woId", params: { woId: item.id } })
              : setOpenInvoice(item.id)
          }
          className="flex w-full items-center justify-between rounded-xl border bg-card p-4 text-start shadow-sm transition hover:border-border-strong hover:shadow-md"
        >
          <div className="flex min-w-0 items-center gap-3">
            {item.kind === "wo" ? (
              <Wrench className="h-4 w-4 shrink-0 text-primary" />
            ) : (
              <ReceiptText className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold tabular">
                {fmtCairo(item.date, "YYYY/MM/DD", i18n.language)}
              </div>
              {item.kind === "invoice" && item.title && (
                <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.title}</div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground tabular">
              {fmtNumber(item.count, i18n.language)} {t("common.items")}
            </span>
            <Badge variant={item.kind === "wo" ? "default" : "secondary"}>
              {item.kind === "wo" ? t("truck.history.workshop") : t("truck.history.falcon")}
            </Badge>
          </div>
        </button>
      ))}
    </div>
  );
}
