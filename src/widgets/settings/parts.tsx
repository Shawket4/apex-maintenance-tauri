import { Info } from "lucide-react";

import { cn } from "@/shared/lib/cn";

/** One titled block of the settings page. `id` is the anchor other screens
 * link to (`/settings#sync`, `#truck-classes`, …). */
export function SettingsCard({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-base font-bold">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** A plain-words note inside a card (why something is read-only, …). */
export function Note({ tone = "info", children }: { tone?: "info" | "warn"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm leading-6",
        tone === "warn" ? "bg-status-due_soon-soft text-status-due_soon" : "bg-muted/60 text-foreground",
      )}
    >
      <Info className="mt-0.5 h-4 w-4 flex-none" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
