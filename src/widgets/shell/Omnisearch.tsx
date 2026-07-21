import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Search, Truck, CircleDot, ClipboardList } from "lucide-react";

import { useSearch } from "@/shared/api/queries";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/ui/command";
import { fmtNumber } from "@/shared/lib/numbers";

/** The one search box: plates (any digit script), DOT codes, open work.
 * Opens with the sidebar button or the "/" shortcut anywhere. */
export function Omnisearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data } = useSearch(q);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (fn: () => void) => {
    setOpen(false);
    setQ("");
    fn();
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-start">{t("search.placeholder")}</span>
        <kbd className="rounded border bg-muted px-1.5 text-[10px]">/</kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
        <CommandInput
          value={q}
          onValueChange={setQ}
          placeholder={t("search.placeholder")}
        />
        <CommandList>
          <CommandEmpty>{t("search.noResults")}</CommandEmpty>
          {data && data.trucks.length > 0 && (
            <CommandGroup heading={t("search.trucks")}>
              {data.trucks.map((tr) => (
                <CommandItem
                  key={`t${tr.id}`}
                  value={`truck-${tr.id}`}
                  onSelect={() =>
                    go(() => void navigate({ to: "/trucks/$truckId", params: { truckId: String(tr.id) } }))
                  }
                >
                  <Truck className="h-4 w-4" />
                  <span className="flex-1">{tr.plate}</span>
                  {tr.open_wo_count > 0 && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600">
                      {t("wo.status.open")}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {data && data.tires.length > 0 && (
            <CommandGroup heading={t("search.tires")}>
              {data.tires.map((ti) => (
                <CommandItem
                  key={`ti${ti.id}`}
                  value={`tire-${ti.id}`}
                  onSelect={() =>
                    go(() => void navigate({ to: "/tires/$tireId", params: { tireId: ti.id } }))
                  }
                >
                  <CircleDot className="h-4 w-4" />
                  <span className="flex-1" dir="ltr">
                    {ti.dot_code ?? ti.brand}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(`tires.status.${ti.status}`)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {data && data.work_orders.length > 0 && (
            <CommandGroup heading={t("search.workOrders")}>
              {data.work_orders.map((w) => (
                <CommandItem
                  key={`w${w.id}`}
                  value={`wo-${w.id}`}
                  onSelect={() => go(() => void navigate({ to: "/wo/$woId", params: { woId: w.id } }))}
                >
                  <ClipboardList className="h-4 w-4" />
                  <span className="flex-1">{w.plate}</span>
                  <span className="text-xs text-muted-foreground tabular">
                    {fmtNumber(w.task_count)} {t("common.items")}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
