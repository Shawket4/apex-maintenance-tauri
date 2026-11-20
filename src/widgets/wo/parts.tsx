import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";

import { useCategories } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

import { NO_CATEGORY } from "./lib";

/** Section heading a person can actually read (the shared one is a small
 * grey label). */
export function SectionTitle({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-bold text-foreground">
      {icon}
      {children}
    </span>
  );
}

/** "Not sent yet" marker — the record is saved on this device only. */
export function PendingBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className={cn("shrink-0", className)}>
      {t("wo.waiting")}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const isOpen = status === "open";
  return (
    <Badge
      className={cn(
        "shrink-0",
        isOpen
          ? "bg-status-ok-soft text-status-ok hover:bg-status-ok-soft"
          : "bg-muted text-muted-foreground hover:bg-muted",
      )}
    >
      {isOpen ? t("wo.statusOpen") : t("wo.statusClosed")}
    </Badge>
  );
}

/** Shown in place of every "add" control on a closed work order. */
export function ClosedNote({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex items-start gap-2 bg-muted/50 px-4 py-3 text-sm text-muted-foreground",
        className,
      )}
    >
      <Lock className="mt-0.5 h-4 w-4 flex-none" />
      <span>{t("wo.closedNote")}</span>
    </div>
  );
}

/** Category picker with an explicit "no category" choice, so a category can
 * always be taken off again. `value` is the category id or "" for none. */
export function CategorySelect({
  id,
  value,
  onChange,
  className,
}: {
  id: string;
  value: string;
  onChange: (categoryId: string) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const categories = useCategories();
  return (
    <Select
      value={value || NO_CATEGORY}
      onValueChange={(v) => onChange(v === NO_CATEGORY ? "" : v)}
    >
      <SelectTrigger
        id={id}
        className={cn("w-full bg-card data-[size=default]:h-10 pointer-coarse:min-h-11", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CATEGORY}>{t("wo.noCategory")}</SelectItem>
        {(categories.data ?? []).map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {i18n.language.startsWith("ar") ? c.name_ar : c.name_en}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Multi-line text styled like the shared Input. */
export function TextArea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}
