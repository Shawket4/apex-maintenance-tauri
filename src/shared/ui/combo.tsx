import * as React from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/cn";
import { matches, norm } from "@/shared/lib/normalize";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/shared/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

export interface ComboOption {
  /** What `onChange` receives. */
  value: string;
  label: string;
  /** Second line, smaller (size, where it is, how many in stock…). */
  description?: React.ReactNode;
  /** Extra words the search should also match. */
  keywords?: string;
}

/** A searchable dropdown that also takes what is not on the list.
 *
 * - Type to search: word order, case, spacing, Arabic spelling variants and
 *   digit script do not matter.
 * - `allowCustom`: text that matches nothing can be used as it is (the first
 *   row says so). The parent decides what a new value means — for products
 *   the server adds it to the catalog, so it is on the list next time.
 * - Text that IS on the list under another spelling selects that entry
 *   instead of creating a twin.
 *
 * The value is the option's `value`, or the typed text when it is custom. */
export function Combo({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  allowCustom = false,
  clearable = false,
  customLabel,
  disabled,
  id,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (value: string, option: ComboOption | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowCustom?: boolean;
  /** Offer "clear" at the top of the list when something is chosen
   * (`onChange("")`). */
  clearable?: boolean;
  /** Text of the "use what I typed" row; receives the typed text. */
  customLabel?: (text: string) => React.ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  React.useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const selected = options.find((o) => o.value === value) ?? null;
  const typed = search.trim();
  const filtered = React.useMemo(
    () => (typed ? options.filter((o) => matches(`${o.label} ${o.keywords ?? ""}`, typed)) : options),
    [options, typed],
  );
  // The same thing under another spelling is the same thing.
  const twin = typed ? (options.find((o) => norm(o.label) === norm(typed)) ?? null) : null;
  const shown = filtered.slice(0, 80);

  const pick = (v: string, o: ComboOption | null) => {
    onChange(v, o);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-start text-sm shadow-xs outline-none transition-[color,box-shadow] pointer-coarse:min-h-11",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
            !selected && !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate" dir="auto">
            {selected ? selected.label : value ? value : (placeholder ?? t("combo.placeholder"))}
          </span>
          <ChevronsUpDown className="h-4 w-4 flex-none opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder ?? t("combo.search")}
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              // Enter on text that is not on the list uses it.
              if (e.key === "Enter" && typed && filtered.length === 0) {
                e.preventDefault();
                if (twin) pick(twin.value, twin);
                else if (allowCustom) pick(typed, null);
              }
            }}
          />
          <CommandList className="max-h-[min(18rem,50dvh)]">
            {!(allowCustom && typed && !twin) && (
              <CommandEmpty className="px-3 py-6 text-center text-sm text-muted-foreground">
                {emptyText ?? t("combo.empty")}
              </CommandEmpty>
            )}
            <CommandGroup>
              {clearable && value && !typed && (
                <CommandItem value="__clear__" onSelect={() => pick("", null)} className="min-h-11 text-muted-foreground">
                  <X className="h-4 w-4 flex-none" />
                  <span>{t("combo.clear")}</span>
                </CommandItem>
              )}
              {allowCustom && typed && !twin && (
                <CommandItem
                  value={`__custom__${typed}`}
                  onSelect={() => pick(typed, null)}
                  className="min-h-11 font-medium text-primary"
                >
                  <Plus className="h-4 w-4 flex-none" />
                  <span dir="auto" className="min-w-0 break-words">
                    {customLabel ? customLabel(typed) : t("combo.use", { text: typed })}
                  </span>
                </CommandItem>
              )}
              {shown.map((o) => (
                <CommandItem key={o.value} value={o.value} onSelect={() => pick(o.value, o)} className="min-h-11">
                  <Check className={cn("h-4 w-4 flex-none", o.value === value ? "opacity-100" : "opacity-0")} />
                  <div className="flex min-w-0 flex-col">
                    <span dir="auto" className="break-words">
                      {o.label}
                    </span>
                    {o.description && <span className="text-xs text-muted-foreground">{o.description}</span>}
                  </div>
                </CommandItem>
              ))}
              {filtered.length > shown.length && (
                <div className="px-3 py-2 text-xs text-muted-foreground">{t("combo.more")}</div>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
