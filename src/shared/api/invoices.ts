import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { invoke } from "./tauri";
import { env } from "@/shared/config/env";
import type {
  InvoiceDetail,
  InvoiceListResult,
  InvoiceSearchResult,
} from "@/entities/invoice/model";
import type { RefreshResult } from "@/entities/vehicle/model";

export const invoicesKeys = {
  all: ["invoices"] as const,
  list: (page: number, limit: number, carId: number | null) =>
    [...invoicesKeys.all, "list", { page, limit, carId }] as const,
  search: (q: string) => [...invoicesKeys.all, "search", q] as const,
  detail: (id: number) => [...invoicesKeys.all, "detail", id] as const,
};

export function useInvoicesQuery(
  page: number,
  limit: number,
  carId: number | null,
  enabled = true,
) {
  return useQuery<InvoiceListResult>({
    queryKey: invoicesKeys.list(page, limit, carId),
    queryFn: () =>
      invoke<InvoiceListResult>("invoices_list", {
        args: { page, limit, car_id: carId ?? undefined },
      }),
    enabled,
    placeholderData: (prev) => prev,
    staleTime: 0,
  });
}

export function useInvoicesSearchQuery(query: string, enabled: boolean) {
  return useQuery<InvoiceSearchResult>({
    queryKey: invoicesKeys.search(query),
    queryFn: () =>
      invoke<InvoiceSearchResult>("invoices_search", {
        args: { query, limit: 100 },
      }),
    enabled,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function useInvoiceDetailQuery(id: number) {
  return useQuery<InvoiceDetail | null>({
    queryKey: invoicesKeys.detail(id),
    queryFn: () => invoke<InvoiceDetail | null>("invoice_get", { args: { id } }),
    enabled: Number.isFinite(id) && id > 0,
    staleTime: 30_000,
  });
}

export function useInvoicesRefresh() {
  const qc = useQueryClient();
  return useMutation<RefreshResult, unknown, void>({
    mutationKey: ["invoices", "refresh"],
    mutationFn: () => invoke<RefreshResult>("invoices_refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invoicesKeys.all });
      qc.invalidateQueries({ queryKey: ["cache_freshness"] });
    },
  });
}

export function useInvoicesAutoRefresh(enabled = true) {
  const refresh = useInvoicesRefresh();
  useQuery({
    queryKey: ["invoices", "auto-refresh"],
    queryFn: async () => {
      if (navigator.onLine && !refresh.isPending) {
        await refresh.mutateAsync().catch(() => undefined);
      }
      return Date.now();
    },
    enabled,
    refetchInterval: env.invoicesRefetchIntervalMs,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}
