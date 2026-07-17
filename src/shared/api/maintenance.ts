/**
 * Owned-domain bindings: due list, templates, records, odometer overrides,
 * categories. Mirrors src-tauri/src/services/domain.rs (hand-kept until
 * specta). All writes land locally first and sync in the background — the UI
 * treats a resolved mutation as "saved", and the sync badge carries the
 * queued/failed truth.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "./tauri";
import { syncKeys } from "./sync";

export type DueStatus = "overdue" | "due_soon" | "ok" | "never_done";
export type OdometerSource = "falcon_mileage" | "falcon_fuel" | "manual" | "service" | "none";

export interface DueItem {
  template_id: string;
  vehicle_id: number;
  plate_number: string;
  category_id: string;
  category_icon: string | null;
  name_ar: string;
  name_en: string;
  trigger_type: "mileage" | "time";
  interval_km: number | null;
  interval_days: number | null;
  last_done_at: string | null;
  last_done_km: number | null;
  next_due_at: string | null;
  next_due_km: number | null;
  current_odometer: number;
  odometer_source: OdometerSource;
  odometer_observed_at: string | null;
  status: DueStatus;
}

export interface TemplateRow {
  id: string;
  vehicle_id: number;
  category_id: string;
  category_icon: string | null;
  name_ar: string;
  name_en: string;
  notes_ar: string | null;
  notes_en: string | null;
  trigger_type: "mileage" | "time";
  interval_km: number | null;
  interval_days: number | null;
  lead_warn_km: number;
  lead_warn_days: number;
  is_active: number;
}

export interface TemplateInput {
  vehicle_id: number;
  category_id: string;
  name_ar: string;
  name_en: string;
  notes_ar?: string | null;
  notes_en?: string | null;
  trigger_type: "mileage" | "time";
  interval_km?: number | null;
  interval_days?: number | null;
  lead_warn_km?: number | null;
  lead_warn_days?: number | null;
}

export interface RecordRow {
  id: string;
  template_id: string | null;
  vehicle_id: number;
  category_id: string;
  category_icon: string | null;
  category_name_ar: string;
  category_name_en: string;
  performed_at: string;
  odometer_at_service: number | null;
  next_due_at: string | null;
  next_due_km: number | null;
  cost: number | null;
  vendor: string | null;
  performed_by: string | null;
  notes: string | null;
}

export interface RecordInput {
  template_id?: string | null;
  vehicle_id: number;
  category_id: string;
  performed_at: string;
  odometer_at_service?: number | null;
  cost?: number | null;
  vendor?: string | null;
  performed_by?: string | null;
  notes?: string | null;
}

export interface CategoryRow {
  id: string;
  name_ar: string;
  name_en: string;
  icon: string | null;
}

export const maintKeys = {
  due: (vehicleId?: number) => ["due", vehicleId ?? "fleet"] as const,
  templates: (vehicleId: number) => ["templates", vehicleId] as const,
  records: (vehicleId: number) => ["records", vehicleId] as const,
  categories: ["categories"] as const,
};

export function useDueList(vehicleId?: number) {
  return useQuery({
    queryKey: maintKeys.due(vehicleId),
    queryFn: () => invoke<DueItem[]>("due_list", { vehicleId: vehicleId ?? null }),
  });
}

export function useTemplates(vehicleId: number) {
  return useQuery({
    queryKey: maintKeys.templates(vehicleId),
    queryFn: () => invoke<TemplateRow[]>("templates_list", { vehicleId }),
  });
}

export function useRecords(vehicleId: number) {
  return useQuery({
    queryKey: maintKeys.records(vehicleId),
    queryFn: () => invoke<RecordRow[]>("records_list", { vehicleId, limit: 200 }),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: maintKeys.categories,
    queryFn: () => invoke<CategoryRow[]>("categories_list"),
    staleTime: Infinity,
  });
}

function invalidateVehicleData(qc: ReturnType<typeof useQueryClient>, vehicleId: number) {
  qc.invalidateQueries({ queryKey: ["due"] });
  qc.invalidateQueries({ queryKey: maintKeys.templates(vehicleId) });
  qc.invalidateQueries({ queryKey: maintKeys.records(vehicleId) });
  qc.invalidateQueries({ queryKey: syncKeys.status });
}

export function useTemplateCreate(vehicleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TemplateInput) => invoke<string>("template_create", { input }),
    onSettled: () => invalidateVehicleData(qc, vehicleId),
  });
}

export function useTemplateUpdate(vehicleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: TemplateInput }) =>
      invoke<void>("template_update", { id: v.id, input: v.input }),
    onSettled: () => invalidateVehicleData(qc, vehicleId),
  });
}

export function useTemplateDelete(vehicleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoke<void>("template_delete", { id }),
    onSettled: () => invalidateVehicleData(qc, vehicleId),
  });
}

export function useRecordCreate(vehicleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordInput) => invoke<string>("record_create", { input }),
    onSettled: () => invalidateVehicleData(qc, vehicleId),
  });
}

export function useRecordDelete(vehicleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoke<void>("record_delete", { id }),
    onSettled: () => invalidateVehicleData(qc, vehicleId),
  });
}

export function useOverrideSet(vehicleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { odometer: number; notes?: string | null }) =>
      invoke<void>("override_set", { vehicleId, odometer: v.odometer, notes: v.notes ?? null }),
    onSettled: () => invalidateVehicleData(qc, vehicleId),
  });
}
