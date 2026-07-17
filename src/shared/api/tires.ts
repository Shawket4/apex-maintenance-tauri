/**
 * Tire lifecycle + chassis bindings. Mirrors src-tauri commands/domain.rs.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "./tauri";
import { syncKeys } from "./sync";

export type TireStatus = "in_stock" | "mounted" | "in_repair" | "retreading" | "scrapped";
export type MountReason =
  | "new_install"
  | "rotation"
  | "replacement"
  | "puncture"
  | "wear"
  | "damage"
  | "retread_return";

export interface TireRow {
  id: string;
  dot_code: string;
  internal_serial: string | null;
  brand: string;
  model: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
  supplier: string | null;
  is_retread: number;
  retread_count: number;
  status: TireStatus;
  stock_location: string | null;
  notes: string | null;
  updated_at: string;
}

export interface TireInput {
  dot_code: string;
  brand: string;
  model?: string | null;
  purchase_date?: string | null;
  purchase_cost?: number | null;
  supplier?: string | null;
  is_retread?: boolean | null;
  stock_location?: string | null;
  notes?: string | null;
}

export interface TireHistoryRow {
  id: string;
  tire_id: string;
  position_id: string;
  position_code: string;
  car_no_plate: string;
  vehicle_id: number;
  mounted_at: string;
  mounted_odometer: number | null;
  dismounted_at: string | null;
  dismounted_odometer: number | null;
  mount_reason: MountReason;
  dismount_reason: MountReason | null;
}

export interface ChassisAxle {
  id: string;
  layout_id: string;
  section: "tractor" | "trailer";
  section_index: number;
  axle_type: "single" | "dual";
  is_steering: number;
  is_lifted: number;
}

export interface ChassisPosition {
  id: string;
  layout_id: string;
  axle_id: string | null;
  side: "left" | "right" | null;
  depth: "single" | "inner" | "outer" | null;
  is_spare: number;
  spare_index: number | null;
  position_code: string;
  // active assignment join (null when the position is empty)
  assignment_id: string | null;
  mounted_at: string | null;
  mounted_odometer: number | null;
  tire_id: string | null;
  dot_code: string | null;
  brand: string | null;
  tire_status: TireStatus | null;
  is_retread: number | null;
}

export interface ChassisPayload {
  layout: { id: string; vehicle_id: number } | null;
  axles: ChassisAxle[];
  positions: ChassisPosition[];
}

export interface ChassisConfig {
  drive_axles: number;
  trailer_axles: number;
  spares: number;
  single_trailer_axles?: boolean;
}

export const tireKeys = {
  list: (status?: string) => ["tires", status ?? "all"] as const,
  history: (tireId: string) => ["tires", "history", tireId] as const,
  chassis: (vehicleId: number) => ["chassis", vehicleId] as const,
};

export function useTires(status?: TireStatus) {
  return useQuery({
    queryKey: tireKeys.list(status),
    queryFn: () => invoke<TireRow[]>("tires_list", { status: status ?? null }),
  });
}

export function useTireHistory(tireId: string | null) {
  return useQuery({
    queryKey: tireKeys.history(tireId ?? "none"),
    queryFn: () => invoke<TireHistoryRow[]>("tire_history", { tireId }),
    enabled: !!tireId,
  });
}

export function useChassis(vehicleId: number) {
  return useQuery({
    queryKey: tireKeys.chassis(vehicleId),
    queryFn: () => invoke<ChassisPayload | null>("chassis_get", { vehicleId }),
  });
}

function invalidateTireData(qc: ReturnType<typeof useQueryClient>, vehicleId?: number) {
  qc.invalidateQueries({ queryKey: ["tires"] });
  if (vehicleId != null) qc.invalidateQueries({ queryKey: tireKeys.chassis(vehicleId) });
  qc.invalidateQueries({ queryKey: syncKeys.status });
}

export function useTireCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TireInput) => invoke<string>("tire_create", { input }),
    onSettled: () => invalidateTireData(qc),
  });
}

export function useTireMount(vehicleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      tireId: string;
      positionId: string;
      odometer?: number | null;
      reason: MountReason;
    }) =>
      invoke<string>("tire_mount", {
        tireId: v.tireId,
        positionId: v.positionId,
        vehicleId,
        odometer: v.odometer ?? null,
        reason: v.reason,
      }),
    onSettled: () => invalidateTireData(qc, vehicleId),
  });
}

export function useTireDismount(vehicleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      assignmentId: string;
      odometer?: number | null;
      reason: MountReason;
      toStatus: Exclude<TireStatus, "mounted">;
    }) =>
      invoke<void>("tire_dismount", {
        assignmentId: v.assignmentId,
        odometer: v.odometer ?? null,
        reason: v.reason,
        toStatus: v.toStatus,
      }),
    onSettled: () => invalidateTireData(qc, vehicleId),
  });
}

export function useChassisCreate(vehicleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: ChassisConfig) =>
      invoke<string>("chassis_create", { vehicleId, config }),
    onSettled: () => invalidateTireData(qc, vehicleId),
  });
}
