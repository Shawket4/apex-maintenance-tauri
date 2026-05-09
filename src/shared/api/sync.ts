import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export interface SyncStatus {
  outbox_count: number;
  conflict_count: number;
  last_sync_at: string | null;
}

export interface ConflictRecord {
  id: number;
  outbox_id: number;
  entity_type: string;
  entity_id: string;
  local_row: any;
  server_row: any;
  created_at: string;
}

interface SyncState {
  status: SyncStatus | null;
  isSyncing: boolean;
  lastError: string | null;
  
  fetchStatus: () => Promise<void>;
  syncNow: () => Promise<void>;
  resolveConflict: (conflictId: number, action: "accept_server" | "keep_mine") => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  status: null,
  isSyncing: false,
  lastError: null,

  fetchStatus: async () => {
    try {
      const status = await invoke<SyncStatus>("sync_get_status");
      set({ status, lastError: null });
    } catch (e) {
      console.error("Failed to fetch sync status", e);
      set({ lastError: String(e) });
    }
  },

  syncNow: async () => {
    if (get().isSyncing) return;
    set({ isSyncing: true, lastError: null });
    try {
      await invoke("sync_now");
      const status = await invoke<SyncStatus>("sync_get_status");
      set({ status, isSyncing: false });
    } catch (e) {
      console.error("Sync failed", e);
      set({ isSyncing: false, lastError: String(e) });
    }
  },

  resolveConflict: async (conflictId, action) => {
    try {
      await invoke("sync_resolve_conflict", { conflictId, action });
      await get().fetchStatus();
    } catch (e) {
      throw e;
    }
  },
}));

// Background auto-refresh status
setInterval(() => {
  useSyncStore.getState().fetchStatus();
}, 10000); // 10s
