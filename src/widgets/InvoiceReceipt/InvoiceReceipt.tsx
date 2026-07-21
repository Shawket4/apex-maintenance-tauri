/**
 * Receipt-style layout shared by service invoices and work orders — ported from
 * the falcon-react `ServiceInvoiceDetails` widget: a StatCard header grid, a
 * bordered receipt card with a centred title, and a two-column
 * (secondary | primary) line-items table. Arabic-first, RTL, print-friendly.
 */
import type { LucideIcon } from "lucide-react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/shared/lib/cn";

type Tone = "default" | "primary" | "success" | "warning";

const TONE: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/15 text-emerald-600",
  warning: "bg-amber-500/15 text-amber-600",
};

export interface ReceiptStat {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
}

export interface ReceiptItem {
  /** Bold main column (e.g. the service performed / the task). */
  primary: string;
  /** Muted secondary column (e.g. notes). */
  secondary?: string | null;
  /** Optional highlight (search match). */
  highlight?: boolean;
}

interface InvoiceReceiptProps {
  title: string;
  subtitle?: string;
  stats: ReceiptStat[];
  items: ReceiptItem[];
  primaryHeader: string;
  secondaryHeader: string;
  emptyText?: string;
}

export function InvoiceReceipt({
  title,
  subtitle,
  stats,
  items,
  primaryHeader,
  secondaryHeader,
  emptyText = "لا توجد بنود",
}: InvoiceReceiptProps) {
  return (
    <div className="space-y-5 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      {/* Stat grid */}
      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 print:gap-2">
          {stats.map((s, i) => (
            <StatCard key={i} {...s} />
          ))}
        </div>
      )}

      {/* Receipt card */}
      <div className="overflow-hidden rounded-2xl border-2 border-muted bg-card shadow-sm print:shadow-none">
        <div className="border-b p-6 text-center">
          <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <h2 className="text-2xl font-black tracking-tight">{title}</h2>
          {subtitle && (
            <h3 className="mt-1 text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
              {subtitle}
            </h3>
          )}
        </div>

        <div className="p-4 sm:p-6">
          <div className="overflow-hidden rounded-xl border-2 border-muted">
            <div className="grid grid-cols-[1.5fr_1fr] bg-foreground text-[10px] font-bold uppercase tracking-widest text-background">
              <div className="border-e border-background/20 p-3 text-center">{secondaryHeader}</div>
              <div className="p-3 text-center">{primaryHeader}</div>
            </div>
            <div className="divide-y-2 divide-muted">
              {items.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">{emptyText}</div>
              )}
              {items.map((item, i) => (
                <div
                  key={i}
                  className={cn(
                    "grid min-h-[56px] grid-cols-[1.5fr_1fr] transition-colors",
                    item.highlight ? "bg-primary/5" : "hover:bg-muted/30",
                  )}
                >
                  <div className="border-e-2 border-muted p-4">
                    <p
                      className={cn(
                        "text-sm text-end",
                        item.highlight ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {item.secondary || "—"}
                    </p>
                  </div>
                  <div className="flex items-center justify-end p-4">
                    <p className={cn("text-sm font-bold text-end", item.highlight && "text-primary")}>
                      {item.primary}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone = "default" }: ReceiptStat) {
  return (
    <div className="flex items-center gap-3 overflow-hidden rounded-xl border bg-card p-3 shadow-sm">
      {Icon && (
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", TONE[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold leading-tight tabular">{value}</p>
      </div>
    </div>
  );
}
