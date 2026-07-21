/**
 * Online-first data layer for the new domain (work orders, tires, due, stock).
 * Every call is an invoke() into the Rust passthrough commands (commands/maint.rs),
 * which reach maint-rust with the session JWT. No HTTP in React.
 */
import { invoke } from "./tauri";

export interface Vehicle {
  id: number;
  car_no_plate: string;
  car_type: string | null;
  transporter: string | null;
  last_fuel_odometer: number | null;
  class_id: string | null;
}

export interface Category {
  id: string;
  name_ar: string;
  name_en: string;
  color: string | null;
}

export interface DueRow {
  vehicle_id: number;
  category_id: string;
  category_name_ar: string;
  category_name_en: string;
  status: "overdue" | "due_soon" | "never_done" | "ok";
  current_odometer: number | null;
  next_due_km: number | null;
  next_due_at: string | null;
}

export interface WorkOrderListItem {
  work_order: {
    id: string;
    vehicle_id: number;
    status: "open" | "closed";
    title: string | null;
    odometer_at_open: number | null;
    opened_at: string;
    sync_version: number;
  };
  vehicle_plate: string | null;
  task_count: number;
}

export interface WorkOrderDetail {
  work_order: WorkOrderListItem["work_order"] & { notes_ar?: string | null };
  tasks: Array<{
    id: string;
    kind: string;
    category_id: string | null;
    description_ar: string | null;
    description_en: string | null;
  }>;
  oil_changes: Array<{ id: string; oil_type: string; liters: number; flagged: boolean; odometer: number | null }>;
  tire_assignments: Array<{ id: string; tire_id: string; position_id: string; mount_reason: string }>;
}

export interface TireRow {
  id: string;
  dot_code: string | null;
  brand: string;
  model: string | null;
  size: string | null;
  status: string;
  total_km: number;
  origin: string;
  mounted_vehicle_id: number | null;
  mounted_position_code: string | null;
}

export interface TireStock {
  brand: string;
  model: string;
  size: string;
  on_hand_qty: number;
}
export interface OilStock {
  oil_type: string;
  liters_on_hand: number;
}

export const maintApi = {
  vehicles: () => invoke<Vehicle[]>("maint_vehicles"),
  categories: () => invoke<Category[]>("maint_categories"),
  due: (vehicle_id?: number) => invoke<DueRow[]>("maint_due", { vehicleId: vehicle_id ?? null }),
  workOrders: (status?: string, vehicle_id?: number) =>
    invoke<WorkOrderListItem[]>("maint_work_orders", { status: status ?? null, vehicleId: vehicle_id ?? null }),
  workOrder: (id: string) => invoke<WorkOrderDetail>("maint_work_order_get", { id }),
  tires: (status?: string) => invoke<TireRow[]>("maint_tires", { status: status ?? null }),
  stockTires: () => invoke<TireStock[]>("maint_stock_tires"),
  stockOil: () => invoke<OilStock[]>("maint_stock_oil"),

  openWorkOrder: (vehicle_id: number, title?: string, odometer_at_open?: number) =>
    invoke<string>("maint_open_work_order", {
      vehicleId: vehicle_id,
      title: title ?? null,
      odometerAtOpen: odometer_at_open ?? null,
    }),
  closeWorkOrder: (id: string, sync_version: number) =>
    invoke("maint_close_work_order", { id, syncVersion: sync_version }),
  addTask: (work_order_id: string, category_id: string | null, description_ar: string) =>
    invoke<string>("maint_add_task", {
      workOrderId: work_order_id,
      categoryId: category_id,
      descriptionAr: description_ar,
      descriptionEn: null,
    }),
  addOilChange: (work_order_id: string, vehicle_id: number, oil_type: string, liters: number, odometer?: number) =>
    invoke<string>("maint_add_oil_change", {
      workOrderId: work_order_id,
      vehicleId: vehicle_id,
      oilType: oil_type,
      liters,
      odometer: odometer ?? null,
    }),
  devSeed: () => invoke("maint_dev_seed"),

  servicePlans: () => invoke<ServicePlan[]>("maint_service_plans"),
  vehicleClasses: () => invoke<VehicleClass[]>("maint_vehicle_classes"),
  upsertPlan: (p: {
    class_id: string;
    category_id: string;
    trigger_type: "mileage" | "time";
    interval_km?: number;
    interval_days?: number;
  }) =>
    invoke("maint_upsert_plan", {
      classId: p.class_id,
      categoryId: p.category_id,
      triggerType: p.trigger_type,
      intervalKm: p.interval_km ?? null,
      intervalDays: p.interval_days ?? null,
    }),
  assignClass: (vehicle_id: number, class_id: string) =>
    invoke("maint_assign_class", { vehicleId: vehicle_id, classId: class_id }),
  serviceEvents: (vehicle_id: number) =>
    invoke<ServiceEvent[]>("maint_service_events", { vehicleId: vehicle_id }),
  aiQuery: (query: string) => invoke<AiResult>("maint_ai_query", { query }),
};

export interface ServiceEvent {
  id: number;
  date: string | null;
  meter_reading: number | null;
  driver_name: string | null;
  supervisor: string | null;
  operating_region: string | null;
  items: Array<{ service: string; notes: string | null }>;
}

export interface AiResult {
  answer: string;
  rows: Array<Record<string, unknown>>;
}

export interface VehicleClass {
  id: string;
  name_ar: string;
  name_en: string;
}
export interface ServicePlan {
  id: string;
  class_id: string;
  category_id: string;
  trigger_type: "mileage" | "time";
  interval_km: number | null;
  interval_days: number | null;
}

export const STATUS_COLORS: Record<string, string> = {
  overdue: "bg-red-500",
  due_soon: "bg-amber-500",
  never_done: "bg-slate-400",
  ok: "bg-emerald-500",
};
