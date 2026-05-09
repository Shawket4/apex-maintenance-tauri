/**
 * Service-invoices step 3: full invoice detail.
 *
 * Visual model follows the user's reference component (Falcon dashboard
 * `ServiceInvoiceDetails`):
 *   - Header with back button + invoice ID + plate/date + Print
 *   - Stat-card row: date, meter, driver, supervisor, region, plate
 *   - Receipt-style items table (Notes column + Service column)
 *   - Sidebar: vehicle billing info + verification note
 *
 * Differences from the reference:
 *   - No semantic-search match highlighting (no embeddings on the client)
 *   - Stat cards use the local `Card` shadcn primitive instead of a custom
 *     `StatCard` widget — same visual weight, fewer files
 */

import { useTranslation } from "react-i18next";
import {
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Gauge,
  Info,
  MapPin,
  Printer,
  ChevronLeft,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState, useCallback } from "react";

import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { useInvoiceDetailQuery } from "@/shared/api/invoices";
import { fmtCairo } from "@/shared/lib/time";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { cn } from "@/shared/lib/cn";
import { invoke } from "@/shared/api/tauri";
import { renderInvoicePdfBytes } from "./ServiceInvoicePdf";
import { toast } from "@/shared/lib/toast-store";

export function ServiceInvoiceDetailPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language ?? "ar";
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as {
    vehicleId?: string;
    invoiceId?: string;
  };
  const invoiceId = Number(params.invoiceId ?? 0);
  const vehicleId = params.vehicleId;

  const detailQ = useInvoiceDetailQuery(invoiceId);
  const [printing, setPrinting] = useState(false);

  const printPdf = useCallback(async () => {
    const inv = detailQ.data;
    if (!inv || typeof inv !== "object") {
      toast.error(t("serviceInvoices.noDataToPrint"));
      return;
    }
    
    setPrinting(true);
    try {
      console.log("[print] starting for invoice:", inv.id);
      const bytes = await renderInvoicePdfBytes({
        inv,
        isRtl: i18n.dir() === "rtl",
        formatted: {
          id:         fmtNumber(inv.id, locale),
          date:       inv.date ? fmtCairo(inv.date, "YYYY/MM/DD", locale) : "—",
          meter:      fmtKm(inv.meter_reading, locale),
          driver:     inv.driver_name ?? "—",
          supervisor: inv.supervisor ?? "—",
          region:     inv.operating_region ?? "—",
          plate:      inv.plate_number ?? "—",
          fetchedAt:  fmtCairo(inv.fetched_at, "YYYY/MM/DD HH:mm", locale),
        },
        labels: {
          receiptTitle:    t("serviceInvoices.receiptTitle"),
          checklistTitle:  t("serviceInvoices.checklistTitle"),
          truckSubtitle:   t("serviceInvoices.truckSubtitle"),
          colService:      t("serviceInvoices.fields.service"),
          colNotes:        t("serviceInvoices.fields.notes"),
          noItems:         t("serviceInvoices.noItems"),
          labelDate:       t("invoices.col.date"),
          labelMeter:      t("invoices.col.meter"),
          labelDriver:     t("invoices.col.driver"),
          labelSupervisor: t("serviceInvoices.fields.supervisor"),
          labelRegion:     t("invoices.col.region"),
          labelPlate:      t("invoices.col.plate"),
          verificationNote: t("serviceInvoices.verificationNote"),
        },
      });
      console.log("[print] PDF ready, bytes length:", bytes.length);
      
      // Call the native Rust command to trigger the OS print dialog
      await invoke("print_pdf", {
        bytes,
      });
      
      console.log("[print] done");
    } catch (err) {
      console.error("[print] FAILED:", err);
      const msg = typeof err === "object" && err !== null && "message" in err 
        ? (err as any).message 
        : String(err);
      toast.error("Print failed: " + msg);
    } finally {
      setPrinting(false);
    }
  }, [detailQ.data, locale, t]);

  const back = () => {
    if (vehicleId) {
      navigate({
        to: "/service-invoices/$vehicleId",
        params: { vehicleId },
      });
    } else {
      navigate({ to: "/service-invoices" });
    }
  };

  if (detailQ.isLoading) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        {t("actions.loading")}
      </div>
    );
  }

  if (detailQ.isError || !detailQ.data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={back} className="gap-2">
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          {t("actions.back")}
        </Button>
        <Card>
          <CardContent className="p-12 text-center text-sm text-destructive">
            {t("serviceInvoices.detailError")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const inv = detailQ.data;

  const statsGrid = (
    <>
      <StatCard
        label={t("invoices.col.date")}
        value={inv.date ? fmtCairo(inv.date, "YYYY/MM/DD", locale) : "—"}
        icon={Calendar}
        tone="primary"
      />
      <StatCard
        label={t("invoices.col.meter")}
        value={fmtKm(inv.meter_reading, locale)}
        icon={Gauge}
        tone="success"
      />
      <StatCard
        label={t("invoices.col.driver")}
        value={inv.driver_name ?? "—"}
        icon={User}
      />
      <StatCard
        label={t("serviceInvoices.fields.supervisor")}
        value={inv.supervisor ?? "—"}
        icon={AlertCircle}
        tone="warning"
      />
      <StatCard
        label={t("invoices.col.region")}
        value={inv.operating_region ?? "—"}
        icon={MapPin}
      />
      <StatCard
        label={t("invoices.col.plate")}
        value={inv.plate_number ?? "—"}
        icon={CheckCircle2}
        tone="primary"
      />
    </>
  );

  return (
    <div className="flex flex-col gap-6 print:block print:space-y-6 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={back} aria-label={t("actions.back")}>
            <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("serviceInvoices.receiptTitle")} #{fmtNumber(inv.id, locale)}
            </h1>
            <p className="text-sm text-muted-foreground tabular">
              {(inv.plate_number ?? "—") + " • "}
              {inv.date ? fmtCairo(inv.date, "YYYY/MM/DD", locale) : "—"}
            </p>
          </div>
        </div>
        <Button onClick={printPdf} disabled={printing}>
          <Printer className="h-4 w-4" />
          <span className="ms-2">
            {printing ? "…" : t("actions.print")}
          </span>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print:block">
        {/* Main */}
        <div className="lg:col-span-2 space-y-6 print:col-span-3 print:w-full print:block">
          {/* Stat cards (Screen Only) */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 print:hidden">
            {statsGrid}
          </div>

          {/* Receipt */}
          <Card className="border-2 shadow-lg print:shadow-none print:border-none">
            <CardContent className="p-8 print:p-0">
              <div className="text-center mb-10 border-b border-border pb-8">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground mb-4 print:h-8 print:w-8">
                  <CheckCircle2 className="h-6 w-6 print:h-4 print:w-4" />
                </div>
                <h2 className="text-3xl font-black uppercase tracking-tighter print:text-xl">
                  {t("serviceInvoices.checklistTitle")}
                </h2>
                <h3 className="text-lg font-medium text-muted-foreground uppercase tracking-[0.3em] mt-1 print:text-sm">
                  {t("serviceInvoices.truckSubtitle")}
                </h3>
              </div>

              <div className="rounded-xl border-2 border-border overflow-hidden print:overflow-visible print:border-none">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead className="hidden md:table-header-group bg-foreground text-background font-bold text-[10px] uppercase tracking-widest print:table-header-group">
                    <tr>
                      <th className="p-3 text-center border-e-2 border-border w-[40%]">
                        {t("serviceInvoices.fields.service")}
                      </th>
                      <th className="p-3 text-center w-[60%]">
                        {t("serviceInvoices.fields.notes")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="block md:table-row-group divide-y-2 divide-border">
                    {inv.items.length === 0 ? (
                      <tr className="block md:table-row">
                        <td colSpan={2} className="block md:table-cell p-12 text-center text-muted-foreground italic">
                          {t("serviceInvoices.noItems")}
                        </td>
                      </tr>
                    ) : (
                      inv.items.map((item) => (
                        <tr key={item.id} className="block md:table-row break-inside-avoid min-h-[60px]">
                          <td className="block md:table-cell p-4 md:border-e-2 border-border align-middle bg-muted/5 md:bg-transparent">
                            <div className="mb-1 md:hidden text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-end">
                              {t("serviceInvoices.fields.service")}
                            </div>
                            <p className="text-sm font-bold text-end">{item.service}</p>
                          </td>
                          <td className="block md:table-cell p-4 align-top">
                            <div className="mb-2 md:hidden text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                              {t("serviceInvoices.fields.notes")}
                            </div>
                            <p className="text-sm text-end text-muted-foreground">
                              {item.notes || "—"}
                            </p>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot className="hidden print:table-footer-group">
                    <tr>
                      <td colSpan={2} className="pt-8 print:border-none">
                        <div className="grid grid-cols-3 gap-3 break-inside-avoid">
                          {statsGrid}
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6 lg:col-span-1 print:hidden">
          <Card>
            <CardContent className="p-6">
              <h4 className="font-bold mb-4 uppercase tracking-wider text-xs text-muted-foreground">
                {t("serviceInvoices.billedTo")}
              </h4>
              <div className="space-y-4">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
                    {t("invoices.col.plate")}
                  </span>
                  <span className="text-xl font-black tabular">
                    {inv.plate_number ?? "—"}
                  </span>
                </div>
                {inv.car && (
                  <>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
                        {t("vehicles.col.type")}
                      </span>
                      <span className="font-semibold">
                        {inv.car.car_type ?? "—"}
                      </span>
                    </div>
                    {inv.car.transporter && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
                          {t("vehicles.col.transporter")}
                        </span>
                        <span className="font-semibold">{inv.car.transporter}</span>
                      </div>
                    )}
                    {inv.car.tank_capacity != null && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
                          {t("vehicles.col.tank_capacity")}
                        </span>
                        <span className="font-semibold tabular">
                          {fmtNumber(inv.car.tank_capacity, locale)}{" "}
                          {t("vehicles.unit.liters")}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-dashed border-2">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                  <Info className="h-4 w-4 text-muted-foreground" />
                </div>
                <h4 className="font-bold text-sm">{t("common.details")}</h4>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("serviceInvoices.verificationNote", {
                  date: fmtCairo(inv.fetched_at, "YYYY/MM/DD HH:mm", locale),
                })}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ----- Local StatCard. Inlined here so we don't add a shared widget for one
 * use site. If we end up needing it on multiple pages we'll promote it. ----- */

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "primary" | "success" | "warning";
}) {
  const toneClass =
    tone === "primary"
      ? "bg-primary/10 text-primary"
      : tone === "success"
        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : tone === "warning"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "bg-muted text-muted-foreground";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div
            className={cn(
              "grid h-6 w-6 place-items-center rounded-md",
              toneClass,
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {label}
          </span>
        </div>
        <p className="text-base font-semibold tabular truncate" title={value}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
