import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import {
  BatteryFull,
  CalendarClock,
  CircleDot,
  ClipboardList,
  History,
  Loader2,
  Search,
  Sparkles,
  Truck,
} from "lucide-react";

import { useSearch } from "@/shared/api/queries";
import { env } from "@/shared/config/env";
import { errorText } from "@/shared/lib/notify";
import { fmtCairo } from "@/shared/lib/time";
import { useDebouncedValue } from "@/shared/lib/useDebouncedValue";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/ui/command";
import { askAi } from "@/widgets/AiSearch/store";

/** The work-order list (`/wo`). Typed loosely so this file does not depend on
 * when that route's generated types land. */
const WO_LIST: string = "/wo";

// ── one palette, however many buttons ────────────────────────────────────────

const usePalette = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** Open the search from anywhere (the home page's "find a truck" button). */
export function openOmnisearch() {
  usePalette.getState().setOpen(true);
}

// The shell renders the sidebar twice on a narrow window (the hidden desktop
// column and the drawer). Only the first mounted button owns the dialog and
// the keyboard shortcut, so there is never a second palette.
let owner: symbol | null = null;

// ── recently opened (kept on this device) ────────────────────────────────────

type Recent = { kind: "truck" | "tire" | "wo"; id: string; label: string; sub?: string };
const RECENT_KEY = "apex-recent-search";
const RECENT_MAX = 5;

function readRecent(): Recent[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (r): r is Recent =>
          typeof r === "object" &&
          r !== null &&
          ["truck", "tire", "wo"].includes((r as Recent).kind) &&
          typeof (r as Recent).id === "string" &&
          typeof (r as Recent).label === "string",
      )
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function pushRecent(r: Recent): Recent[] {
  const next = [r, ...readRecent().filter((x) => !(x.kind === r.kind && x.id === r.id))].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — the list just will not survive a restart
  }
  return next;
}

const KIND_ICON = { truck: Truck, tire: CircleDot, wo: ClipboardList } as const;

/** The one search box: plates (any digit script), tire numbers, work orders.
 * Opens from its button, from Ctrl/⌘+K anywhere, or from the "/" key (the
 * physical key, so it also works on an Arabic keyboard layout). Empty, it
 * offers what was opened recently and the usual places; on a phone it is a
 * full-screen sheet. */
export function Omnisearch() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const open = usePalette((s) => s.open);
  const setOpen = usePalette((s) => s.setOpen);
  const [me] = useState(() => Symbol("omnisearch"));
  const [isOwner, setIsOwner] = useState(false);
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<Recent[]>([]);
  // One round-trip per pause, not per keystroke.
  const dq = useDebouncedValue(q, env.searchDebounceMs);
  const search = useSearch(isOwner && open ? dq : "");

  useEffect(() => {
    if (owner === null) owner = me;
    setIsOwner(owner === me);
    return () => {
      if (owner === me) owner = null;
    };
  }, [me]);

  useEffect(() => {
    if (!isOwner) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyK") {
        e.preventDefault();
        setOpen(!usePalette.getState().open);
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (e.code === "Slash" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOwner, setOpen]);

  // Each opening starts clean, with the latest "recent" list.
  useEffect(() => {
    if (open && isOwner) {
      setQ("");
      setRecent(readRecent());
    }
  }, [open, isOwner]);

  const close = () => setOpen(false);
  const openRecord = (r: Recent) => {
    setRecent(pushRecent(r));
    close();
    if (r.kind === "truck") void navigate({ to: "/trucks/$truckId", params: { truckId: r.id } });
    else if (r.kind === "tire") void navigate({ to: "/tires/$tireId", params: { tireId: r.id } });
    else void navigate({ to: "/wo/$woId", params: { woId: r.id } });
  };
  const goTo = (to: string) => {
    close();
    void navigate({ to });
  };

  const typed = q.trim();
  const settled = typed.length > 0 && dq.trim() === typed && !search.isPlaceholderData;
  const data = typed.length > 0 && search.data && dq.trim().length > 0 ? search.data : null;
  const waiting = typed.length > 0 && !settled && !search.isError;
  const total = data ? data.trucks.length + data.tires.length + data.work_orders.length : 0;
  const date = (iso: string) => fmtCairo(iso, "YYYY/MM/DD", i18n.language);

  const quickLinks = [
    { to: "/trucks", label: t("search.linkTrucks"), icon: Truck },
    { to: WO_LIST, label: t("search.linkWorkOrders"), icon: ClipboardList },
    { to: "/due", label: t("search.linkDue"), icon: CalendarClock },
    { to: "/tires", label: t("search.linkTires"), icon: CircleDot },
    { to: "/batteries", label: t("search.linkBatteries"), icon: BatteryFull },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent"
      >
        <Search className="h-4 w-4 flex-none" />
        <span className="min-w-0 flex-1 truncate text-start">{t("search.button")}</span>
      </button>

      {isOwner && (
        <CommandDialog
          open={open}
          onOpenChange={setOpen}
          shouldFilter={false}
          title={t("search.title")}
          description={t("search.hint")}
          className="max-sm:top-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 sm:max-w-xl"
        >
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder={t("search.placeholder")}
            className="pe-8 text-base"
            dir="auto"
          />
          <CommandList className="max-h-[min(60dvh,460px)] max-sm:max-h-none max-sm:flex-1">
            {typed.length === 0 && (
              <>
                <p className="px-4 pt-3 text-sm text-muted-foreground">{t("search.hint")}</p>
                {recent.length > 0 && (
                  <CommandGroup heading={t("search.recent")}>
                    {recent.map((r) => {
                      const Icon = KIND_ICON[r.kind];
                      return (
                        <CommandItem
                          key={`r-${r.kind}-${r.id}`}
                          value={`recent-${r.kind}-${r.id}`}
                          onSelect={() => openRecord(r)}
                          className="min-h-11"
                        >
                          <History />
                          <Icon />
                          <bdi className="font-semibold">{r.label}</bdi>
                          {r.sub && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{r.sub}</span>}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
                <CommandGroup heading={t("search.quickLinks")}>
                  {quickLinks.map(({ to, label, icon: Icon }) => (
                    <CommandItem key={to} value={`link-${to}`} onSelect={() => goTo(to)} className="min-h-11">
                      <Icon />
                      <span>{label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {waiting && (
              <div role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("search.searching")}
              </div>
            )}

            {typed.length > 0 && search.isError && (
              <div role="alert" className="px-4 py-6 text-center text-sm text-status-overdue">
                {errorText(search.error)}
              </div>
            )}

            {settled && !search.isError && total === 0 && (
              <div className="px-4 py-6 text-center text-sm">
                <div className="font-semibold">
                  {t("search.noResultsFor")} <bdi>«{typed}»</bdi>
                </div>
                <div className="mt-1 text-muted-foreground">{t("search.noResultsHint")}</div>
              </div>
            )}

            {data && data.trucks.length > 0 && (
              <CommandGroup heading={t("search.trucks")}>
                {data.trucks.map((tr) => (
                  <CommandItem
                    key={`t${tr.id}`}
                    value={`truck-${tr.id}`}
                    className="min-h-11"
                    onSelect={() =>
                      openRecord({ kind: "truck", id: String(tr.id), label: tr.plate, sub: tr.driver_name ?? undefined })
                    }
                  >
                    <Truck />
                    <bdi className="font-semibold">{tr.plate}</bdi>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{tr.driver_name ?? ""}</span>
                    {tr.open_wo_count > 0 && (
                      <span className="flex-none rounded-full bg-status-ok-soft px-2 py-0.5 text-xs text-status-ok">
                        {t("search.hasOpenWo")}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {data && data.tires.length > 0 && (
              <CommandGroup heading={t("search.tires")}>
                {data.tires.map((ti) => {
                  const spec = [ti.brand, ti.model, ti.size].filter(Boolean).join(" ");
                  return (
                    <CommandItem
                      key={`ti${ti.id}`}
                      value={`tire-${ti.id}`}
                      className="min-h-11"
                      onSelect={() =>
                        openRecord({ kind: "tire", id: ti.id, label: ti.dot_code ?? spec, sub: ti.dot_code ? spec : undefined })
                      }
                    >
                      <CircleDot />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {ti.dot_code ? <bdi dir="ltr">{ti.dot_code}</bdi> : t("search.tireNoNumber")}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          <bdi>{spec}</bdi>
                          {ti.mounted_plate && (
                            <>
                              {" · "}
                              {t("search.tireOn")} <bdi>{ti.mounted_plate}</bdi>
                            </>
                          )}
                        </span>
                      </span>
                      <span className="flex-none text-xs text-muted-foreground">{t(`tires.status.${ti.status}`)}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {data && data.work_orders.length > 0 && (
              <CommandGroup heading={t("search.workOrders")}>
                {data.work_orders.map((w) => (
                  <CommandItem
                    key={`w${w.id}`}
                    value={`wo-${w.id}`}
                    className="min-h-11"
                    onSelect={() => openRecord({ kind: "wo", id: w.id, label: w.plate, sub: date(w.opened_at) })}
                  >
                    <ClipboardList />
                    <span className="min-w-0 flex-1">
                      <bdi className="block truncate font-semibold">{w.plate}</bdi>
                      <span className="block truncate text-xs text-muted-foreground tabular">
                        {t("search.woOpenedOn", { date: date(w.opened_at) })}
                        {w.title ? ` · ${w.title}` : ""}
                      </span>
                    </span>
                    <span
                      className={
                        w.status === "open"
                          ? "flex-none rounded-full bg-status-ok-soft px-2 py-0.5 text-xs text-status-ok"
                          : "flex-none text-xs text-muted-foreground"
                      }
                    >
                      {t(`wo.status.${w.status}`, { defaultValue: w.status })}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {typed.length > 0 && (
              <CommandGroup heading={t("search.other")}>
                <CommandItem
                  value="ask-ai"
                  className="min-h-11"
                  onSelect={() => {
                    askAi(typed);
                    goTo("/ai");
                  }}
                >
                  <Sparkles />
                  <span className="min-w-0 flex-1 truncate">
                    {t("search.askAi")} <bdi>«{typed}»</bdi>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </CommandDialog>
      )}
    </>
  );
}
