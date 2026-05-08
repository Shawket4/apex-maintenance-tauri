import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { invoke } from "./tauri";
import { env } from "@/shared/config/env";
import type {
  InvoiceListResult,
  InvoiceSearchResult,
} from "@/entities/invoice/model";
import type { RefreshResult } from "@/entities/vehicle/model";

export const invoicesKeys = {
  all: ["invoices"] as const,
  list: (page: number, limit: number) =>
    [...invoicesKeys.all, "list", page, limit] as const,
  search: (q: string) => [...invoicesKeys.all, "search", q] as const,
};

export function useInvoicesQuery(page: number, limit: number, enabled = true) {
  return useQuery<InvoiceListResult>({
    queryKey: invoicesKeys.list(page, limit),
    queryFn: () =>
      invoke<InvoiceListResult>("invoices_list", { args: { page, limit } }),
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

/**
 * Background poll: every `VITE_INVOICES_REFETCH_INTERVAL_MS` while the
 * invoices page is open and online, walk the cache pages from the server.
 * The first call after a fresh install can take a while (it walks every
 * page); subsequent calls are fast because the upsert is keyed by id.
 */
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
