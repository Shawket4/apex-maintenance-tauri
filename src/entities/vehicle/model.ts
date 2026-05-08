/**
 * Vehicle types crossing the Tauri boundary.
 *
 * Mirrors `src-tauri/src/models/vehicle.rs::VehicleRow` exactly. If you
 * change one, change the other. (Phase 6 will swap this for codegen.)
 */

export interface VehicleRow {
  id: number;
  car_no_plate: string;
  car_type: string | null;
  transporter: string | null;
  tank_capacity: number | null;
  last_fuel_odometer: number | null;
  driver_id: number | null;
  driver_name: string | null;
  license_expiration_date: string | null;
  calibration_expiration_date: string | null;
  tank_license_expiration_date: string | null;
  is_in_trip: boolean;
  is_approved: boolean;
  source_deleted_at: string | null;
  fetched_at: string;
}

export interface RefreshResult {
  upserted: number;
  fetched_at: string;
}

/* ------------------------------------------------------------------------- *
 * Helpers used by the UI to colour expiration cells.                        *
 * Architecture §8.2 / §13 — visual urgency conveys: ok / due_soon / overdue.
 * ------------------------------------------------------------------------- */

export type ExpirationStatus = "ok" | "due_soon" | "overdue" | "missing";

export function expirationStatus(
  isoDate: string | null,
  warnDays = 30,
): ExpirationStatus {
  if (!isoDate) return "missing";
  const target = new Date(isoDate).getTime();
  const now = Date.now();
  const dayMs = 86_400_000;
  if (target < now) return "overdue";
  if (target - now < warnDays * dayMs) return "due_soon";
  return "ok";
}
