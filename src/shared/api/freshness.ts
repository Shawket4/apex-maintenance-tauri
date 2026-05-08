import { useQuery } from "@tanstack/react-query";

import { invoke } from "./tauri";
import type { CacheFreshnessRow } from "@/entities/cache_freshness/model";

export function useCacheFreshness() {
  return useQuery<CacheFreshnessRow[]>({
    queryKey: ["cache_freshness"],
    queryFn: () => invoke<CacheFreshnessRow[]>("cache_freshness_get"),
    staleTime: 5_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function freshnessFor(
  rows: CacheFreshnessRow[] | undefined,
  cache: string,
): CacheFreshnessRow | undefined {
  return rows?.find((r) => r.cache_name === cache);
}
