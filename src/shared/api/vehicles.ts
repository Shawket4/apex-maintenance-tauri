import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { invoke } from "./tauri";
import { env } from "@/shared/config/env";
import type { RefreshResult, VehicleRow } from "@/entities/vehicle/model";
import type { DriverRow } from "@/entities/driver/model";

export const vehiclesKeys = {
  all: ["vehicles"] as const,
  list: () => [...vehiclesKeys.all, "list"] as const,
};

export const driversKeys = {
  all: ["drivers"] as const,
  list: () => [...driversKeys.all, "list"] as const,
};

/**
 * Reads the local SQLite mirror. Cheap, runs every time the page mounts.
 * Background polling re-reads after `vehicles_refresh` invalidates this key.
 */
export function useVehiclesQuery() {
  return useQuery<VehicleRow[]>({
    queryKey: vehiclesKeys.list(),
    queryFn: () => invoke<VehicleRow[]>("vehicles_list"),
    staleTime: 0,
  });
}

export function useDriversQuery() {
  return useQuery<DriverRow[]>({
    queryKey: driversKeys.list(),
    queryFn: () => invoke<DriverRow[]>("drivers_list"),
    staleTime: 60_000,
  });
}

/**
 * Triggers a server-side refresh of `/cache/vehicles`. The mutation result
 * is the upserted row count + fetched_at; the side effect is that the
 * `vehicles.list` query and `drivers.list` query are invalidated, so any
 * mounted list page re-reads the cache automatically.
 */
export function useVehiclesRefresh() {
  const qc = useQueryClient();
  return useMutation<RefreshResult, unknown, void>({
    mutationKey: ["vehicles", "refresh"],
    mutationFn: () => invoke<RefreshResult>("vehicles_refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vehiclesKeys.all });
      qc.invalidateQueries({ queryKey: driversKeys.all });
      qc.invalidateQueries({ queryKey: ["cache_freshness"] });
    },
  });
}

/**
 * Background poll: every `VITE_VEHICLES_REFETCH_INTERVAL_MS` while the page
 * is open and online, re-fetch the cache from the server. Mounted by the
 * vehicles list page so the polling stops when the user navigates away.
 */
export function useVehiclesAutoRefresh(enabled = true) {
  const refresh = useVehiclesRefresh();

  useQuery({
    queryKey: ["vehicles", "auto-refresh"],
    queryFn: async () => {
      if (navigator.onLine && !refresh.isPending) {
        await refresh.mutateAsync().catch(() => undefined);
      }
      return Date.now();
    },
    enabled,
    refetchInterval: env.vehiclesRefetchIntervalMs,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}
