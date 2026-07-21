import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/cn";

/** The corner panel every diagram interaction uses (inspect / mount /
 * dismount / onboard): floats over the canvas so the zoomed pair stays
 * visible, with the position code as the anchor. */
export function DiagramPanel({
  code,
  title,
  subtitle,
  accent = "primary",
  onClose,
  children,
}: {
  code: string;
  title: string;
  subtitle?: string;
  accent?: "primary" | "destructive";
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute bottom-4 end-4 flex max-h-[calc(100%-2rem)] w-[22.5rem] flex-col overflow-hidden rounded-2xl border bg-card/90 shadow-xl backdrop-blur-md">
      <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-3">
        <span
          className={cn(
            "rounded-lg px-2.5 py-1 text-sm font-bold tabular tracking-wider",
            accent === "destructive"
              ? "bg-destructive/10 text-destructive"
              : "bg-primary/10 text-primary",
          )}
          dir="ltr"
        >
          {code}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight">{title}</div>
          {subtitle && (
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{subtitle}</div>
          )}
        </div>
        <button
          aria-label={t("common.close")}
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="overflow-y-auto p-4">{children}</div>
    </div>
  );
}
