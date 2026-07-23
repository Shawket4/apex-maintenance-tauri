import { cn } from "@/shared/lib/cn";

/** The one page frame, derived from the Garage screen: centered column,
 * consistent title/subtitle block, actions aligned to the end. Every page
 * renders inside this — headings and rhythm are not per-page decisions. */
export function PageShell({
  title,
  subtitle,
  actions,
  width = "default",
  className,
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  width?: "default" | "wide";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto space-y-7 p-7",
        width === "wide" ? "max-w-[1400px]" : "max-w-6xl",
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            {title && <h1 className="text-[23px] font-bold leading-relaxed">{title}</h1>}
            {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
          </div>
          {actions && <div className="flex flex-none items-center gap-2.5">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/** Section heading + optional end-aligned action, Garage-style. */
export function Section({
  title,
  action,
  className,
  children,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A surface card whose children are divided rows (the list idiom every
 * screen uses: due rows, tasks, queue entries, history…). */
export function ListCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("divide-y overflow-hidden rounded-xl border bg-card shadow-sm", className)}>
      {children}
    </div>
  );
}

/** One row inside a ListCard. Interactive rows get the primary-tinted hover. */
export function ListRow({
  interactive = false,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3.5 px-[18px] py-3",
        interactive && "cursor-pointer transition hover:bg-primary/[0.03]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** KPI tile (Garage strip). */
export function StatCard({
  value,
  label,
  tone,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-5 py-4 shadow-sm">
      <div className={cn("text-[27px] font-bold leading-snug tabular", tone)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/** Dashed empty placeholder. */
export function EmptyState({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
