/**
 * Sync engine bindings. Mirrors src-tauri/src/services/engine.rs +
 * commands/sync.rs — keep the two in lockstep by hand until specta lands.
 *
 * The status contract is honest by construction: `dead` counts rows the
 * server rejected (visible + actionable in Diagnostics), never hidden from
 * the pending count the way the old client did.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "./tauri";

export interface SyncStatus {
  online: boolean;
  auth_paused: boolean;
  pending: number;
  inflight: number;
  dead: number;
  last_push_at: string | null;
  last_pull_at: string | null;
  last_error: string | null;
}

export interface OutboxItem {
  seq: number;
  id: string;
  entity_type: string;
  entity_id: string;
  op: "insert" | "update" | "delete";
  payload: string;
  base_sync_version: number;
  status: "pending" | "inflight" | "acked" | "dead";
  attempts: number;
  last_error: string | null;
  server_row: string | null;
  enqueued_at: string;
}

export const syncKeys = {
  status: ["sync", "status"] as const,
  outbox: ["sync", "outbox"] as const,
};

export function useSyncStatus() {
  return useQuery({
    queryKey: syncKeys.status,
    queryFn: () => invoke<SyncStatus>("sync_status"),
    refetchInterval: 10_000,
  });
}

export function useOutboxList() {
  return useQuery({
    queryKey: syncKeys.outbox,
    queryFn: () => invoke<OutboxItem[]>("outbox_list"),
    refetchInterval: 10_000,
  });
}

/** Push + pull, then refresh everything the sync could have changed. */
export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<SyncStatus>("sync_now"),
    onSettled: () => qc.invalidateQueries(),
  });
}

export function useOutboxRetry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seq: number) => invoke<void>("outbox_retry", { seq }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: syncKeys.outbox });
      qc.invalidateQueries({ queryKey: syncKeys.status });
    },
  });
}

export function useOutboxDiscard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seq: number) => invoke<void>("outbox_discard", { seq }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: syncKeys.outbox });
      qc.invalidateQueries({ queryKey: syncKeys.status });
    },
  });
}
