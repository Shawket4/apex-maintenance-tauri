import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";

import { useCategories } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { norm } from "@/shared/lib/normalize";
import { Combo, type ComboOption } from "@/shared/ui/combo";

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

/** A task's maintenance type, picked FIRST: one on the list, or a name typed
 * in. A typed name another type already has (in either language, any
 * spelling) is that type; a new one is created for everyone when the task
 * reaches the server. `onChange` gets the type's id, or "" and the typed name. */
export function TaskTypePicker({
  id,
  categoryId,
  typed,
  onChange,
  disabled,
}: {
  id: string;
  categoryId: string;
  typed: string;
  onChange: (categoryId: string, typed: string) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const categories = useCategories();
  const ar = i18n.language.startsWith("ar");
  const list = categories.data ?? [];
  const options: ComboOption[] = list.map((c) => ({
    value: c.id,
    label: (ar ? c.name_ar : c.name_en) || c.name_ar,
    keywords: `${c.name_ar} ${c.name_en}`,
  }));
  return (
    <Combo
      id={id}
      disabled={disabled}
      options={options}
      value={categoryId || typed || null}
      valueLabel={categoryId ? undefined : typed}
      onChange={(v, o) => {
        if (o) return onChange(o.value, "");
        const name = v.trim();
        const same = name ? list.find((c) => norm(c.name_ar) === norm(name) || norm(c.name_en) === norm(name)) : undefined;
        if (same) onChange(same.id, "");
        else onChange("", name);
      }}
      placeholder={t("wo.typePlaceholder")}
      searchPlaceholder={t("wo.typeSearch")}
      allowCustom
      clearable
      customLabel={(text) => t("wo.typeUseNew", { text })}
    />
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
