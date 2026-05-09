export interface InvoiceRow {
  id: number;
  car_id: number | null;
  date: string | null;
  plate_number: string | null;
  driver_name: string | null;
  supervisor: string | null;
  operating_region: string | null;
  meter_reading: number | null;
  item_count: number;
  services_preview: string | null;
  fetched_at: string;
}

export interface InvoiceListResult {
  rows: InvoiceRow[];
  total: number;
  page: number;
  limit: number;
}

export type SearchSource = "online" | "offline";

export interface InvoiceSearchResult {
  rows: InvoiceRow[];
  source: SearchSource;
  total: number;
  query: string;
}

/* ----------- detail view ----------- */

export interface InvoiceItemRow {
  id: number;
  service: string;
  notes: string | null;
  item_order: number | null;
}

export interface InvoiceCarInfo {
  id: number;
  car_no_plate: string;
  car_type: string | null;
  transporter: string | null;
  tank_capacity: number | null;
}

export interface InvoiceDetail {
  id: number;
  car_id: number | null;
  date: string | null;
  plate_number: string | null;
  driver_name: string | null;
  supervisor: string | null;
  operating_region: string | null;
  meter_reading: number | null;
  items: InvoiceItemRow[];
  car: InvoiceCarInfo | null;
  fetched_at: string;
}
