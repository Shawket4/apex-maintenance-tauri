// Typed TanStack Query hooks over the specta bindings. Reads come from local
// SQLite (fast, offline-safe) so staleTime is 0 and refetch is cheap; writes
// invalidate the domain keys they touch (the Rust side already kicked the
// sync engine).
import React from "react";
import {
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
  // A background pull applies server rows without any React-side event —
  // when last_pull_at advances, the local view-models may have new data.
  const lastPull = q.data?.last_pull_at ?? null;
  const prev = React.useRef(lastPull);
  React.useEffect(() => {
    if (prev.current !== null && lastPull !== null && prev.current !== lastPull) {
      invalidateDomain(qc);
    }
    prev.current = lastPull;
  }, [lastPull, qc]);
  return q;
};

export const useOutbox = () =>
  useQuery({
    queryKey: keys.outbox,
    queryFn: () => unwrap(commands.outboxList()),
    refetchInterval: 10_000,
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
function invalidateDomain(qc: ReturnType<typeof useQueryClient>) {
  for (const k of [
    "home", "trucks", "truck", "due", "wos", "wo", "tires", "tire", "stock",
    "chassis", "plans", "categories", "classes", "sync-status", "outbox",
  ]) {
    void qc.invalidateQueries({ queryKey: [k] });
  }
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
