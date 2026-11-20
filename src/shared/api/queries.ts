// Typed TanStack Query hooks over the specta bindings. Reads come from local
// SQLite (fast, offline-safe) so staleTime is 0 and refetch is cheap; writes
// invalidate the domain keys they touch (the Rust side already kicked the
// sync engine).
import React from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";

import { commands, unwrap } from "./client";

export const keys = {
  home: ["home"] as const,
  trucks: (q?: string) => ["trucks", q ?? ""] as const,
  truck: (id: number) => ["truck", id] as const,
  due: (vehicleId?: number) => ["due", vehicleId ?? "all"] as const,
  wos: (status?: string, vehicleId?: number) =>
    ["wos", status ?? "all", vehicleId ?? "all"] as const,
  wo: (id: string) => ["wo", id] as const,
  tires: (status?: string, q?: string) => ["tires", status ?? "all", q ?? ""] as const,
  tire: (id: string) => ["tire", id] as const,
  stock: ["stock"] as const,
  chassis: (vehicleId: number) => ["chassis", vehicleId] as const,
  categories: ["categories"] as const,
  classes: ["classes"] as const,
  plans: ["plans"] as const,
  search: (q: string) => ["search", q] as const,
  syncStatus: ["sync-status"] as const,
  outbox: ["outbox"] as const,
  invoices: (vehicleId: number) => ["invoices", vehicleId] as const,
  invoice: (id: number) => ["invoice", id] as const,
};

// ── reads ────────────────────────────────────────────────────────────────────

export const useHome = () =>
  useQuery({ queryKey: keys.home, queryFn: () => unwrap(commands.homeSummary()) });

export const useTrucks = (q?: string) =>
  useQuery({ queryKey: keys.trucks(q), queryFn: () => unwrap(commands.truckList(q ?? null)) });

export const useTruck = (id: number) =>
  useQuery({
    queryKey: keys.truck(id),
    queryFn: () => unwrap(commands.truckFile(id)),
    // Callers pass 0 while a parent query (e.g. the WO) is still loading.
    enabled: id > 0,
  });

export const useDue = (vehicleId?: number) =>
  useQuery({
    queryKey: keys.due(vehicleId),
    queryFn: () => unwrap(commands.dueBoard(vehicleId ?? null)),
  });

export const useWos = (status?: string, vehicleId?: number) =>
  useQuery({
    queryKey: keys.wos(status, vehicleId),
    queryFn: () => unwrap(commands.woList(status ?? null, vehicleId ?? null)),
  });

export const useWo = (id: string) =>
  useQuery({ queryKey: keys.wo(id), queryFn: () => unwrap(commands.woDetail(id)) });

export const useTires = (status?: string, q?: string) =>
  useQuery({
    queryKey: keys.tires(status, q),
    queryFn: () => unwrap(commands.tiresList(status ?? null, q ?? null)),
  });

export const useTire = (id: string) =>
  useQuery({ queryKey: keys.tire(id), queryFn: () => unwrap(commands.tireFile(id)) });

export const useStock = () =>
  useQuery({ queryKey: keys.stock, queryFn: () => unwrap(commands.stockView()) });

// The stock in/out ledger is an ONLINE read (movements live server-side, not
// in the offline mirror) — no retry so an offline load fails fast to the
// "connection needed" state. Paginated: each page is MOVEMENTS_PAGE rows;
// `from` (YYYY-MM-DD) is the time-range lower bound.
export const MOVEMENTS_PAGE = 50;
// LOCAL read over the mirror — works offline. `stock_movements_refresh`
// updates the mirror when online.
export const useStockMovements = (kind?: "tire" | "oil", from?: string) =>
  useInfiniteQuery({
    queryKey: ["stock-movements", kind ?? "all", from ?? "all"],
    queryFn: ({ pageParam }) =>
      unwrap(commands.stockMovements(kind ?? null, from ?? null, MOVEMENTS_PAGE, pageParam)),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === MOVEMENTS_PAGE ? allPages.length * MOVEMENTS_PAGE : undefined,
  });

/** Pull the latest movements window into the local mirror. Best-effort —
 * fails silently offline; the view keeps showing the last-synced data. */
export const useStockMovementsRefresh = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days?: number) => unwrap(commands.stockMovementsRefresh(days ?? null)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["stock-movements"] }),
  });
};

export const useChassis = (vehicleId: number) =>
  useQuery({
    queryKey: keys.chassis(vehicleId),
    queryFn: () => unwrap(commands.chassisGet(vehicleId)),
    enabled: vehicleId > 0,
  });

export const useCategories = () =>
  useQuery({
    queryKey: keys.categories,
    queryFn: () => unwrap(commands.categoriesList()),
    staleTime: 5 * 60_000,
  });

export const useClasses = () =>
  useQuery({
    queryKey: keys.classes,
    queryFn: () => unwrap(commands.classesList()),
    staleTime: 5 * 60_000,
  });

/** Options for the tire / oil / job pickers (catalog + what this device has used). */
export const useCatalog = () =>
  useQuery({ queryKey: ["catalog"], queryFn: () => unwrap(commands.catalogGet()) });

export const usePlans = () =>
  useQuery({ queryKey: keys.plans, queryFn: () => unwrap(commands.plansList()) });

export const useSearch = (q: string) =>
  useQuery({
    queryKey: keys.search(q),
    queryFn: () => unwrap(commands.searchAll(q)),
    enabled: q.trim().length > 0,
    placeholderData: (prev) => prev,
  });

export const useSyncStatus = () => {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: keys.syncStatus,
    queryFn: () => unwrap(commands.syncStatus()),
    refetchInterval: 10_000,
  });
  // The engine changes local tables with no React-side event: a pull brings
  // server rows, a push adopts versions, a refused change is undone. When any
  // of those moves, the screens may be showing stale rows.
  const stamp = q.data ? `${q.data.last_pull_at}|${q.data.last_push_at}|${q.data.issues}|${q.data.pending}` : null;
  const prev = React.useRef(stamp);
  React.useEffect(() => {
    if (prev.current !== null && stamp !== null && prev.current !== stamp) {
      invalidateDomain(qc, false);
    }
    prev.current = stamp;
  }, [stamp, qc]);
  return q;
};

export const useOutbox = () =>
  useQuery({
    queryKey: keys.outbox,
    queryFn: () => unwrap(commands.outboxList()),
    refetchInterval: 10_000,
  });

/** Changes the server refused (already undone on this device). */
export const useSyncIssues = () =>
  useQuery({
    queryKey: ["sync-issues"],
    queryFn: () => unwrap(commands.syncIssues()),
    refetchInterval: 30_000,
  });

export const useInvoices = (vehicleId: number) =>
  useQuery({
    queryKey: keys.invoices(vehicleId),
    queryFn: () =>
      unwrap(commands.invoicesList({ page: 1, limit: 100, car_id: vehicleId })),
  });

export const useInvoice = (id: number | null) =>
  useQuery({
    queryKey: keys.invoice(id ?? -1),
    queryFn: () => unwrap(commands.invoiceGet({ id: id! })),
    enabled: id != null,
  });

// ── mutations ────────────────────────────────────────────────────────────────

/** Invalidate everything the owned domain can touch — local reads are cheap.
 * plans/categories/classes are included: planUpsert and the reference refresh
 * rewrite exactly those mirrors, and their editors render from these keys. */
function invalidateDomain(qc: ReturnType<typeof useQueryClient>, withSync = true) {
  for (const k of [
    "home", "trucks", "truck", "due", "wos", "wo", "tires", "tire", "stock",
    "chassis", "plans", "categories", "classes", "outbox", "sync-issues", "search", "catalog",
  ]) {
    void qc.invalidateQueries({ queryKey: [k] });
  }
  if (withSync) void qc.invalidateQueries({ queryKey: ["sync-status"] });
}

export function useDomainMutation<TOut, TArgs = void>(
  fn: (args: TArgs) => Promise<TOut>,
  options?: Omit<UseMutationOptions<TOut, Error, TArgs>, "mutationFn">,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    ...options,
    onSuccess: (data, vars, ctx, mutation) => {
      invalidateDomain(qc);
      options?.onSuccess?.(data, vars, ctx, mutation);
    },
  });
}
