import { invoke } from "@/shared/api/tauri";
import { toast } from "@/shared/lib/toast-store";

export interface ExcelColumn {
  key: string;
  header: string;
  type?: 'text' | 'number' | 'integer' | 'money' | 'moneyRaw' | 'date' | 'dateTime' | 'percent' | 'bool';
  width?: number;
  total?: boolean;
}

export interface ExcelStat {
  label: string;
  value: any;
  color?: string;
  type?: 'text' | 'number' | 'integer' | 'money' | 'moneyRaw';
}

export interface ExcelSheetConfig {
  name: string;
  title: string;
  subtitle?: string;
  isRtl: boolean;
  columns: ExcelColumn[];
  rows: any[];
  stats?: ExcelStat[];
  totals?: boolean;
}

export interface ExcelExportConfig {
  filename: string;
  sheets: ExcelSheetConfig[];
  meta?: string;
  creator?: string;
}

export async function exportToExcel(config: ExcelExportConfig) {
  try {
    await invoke("export_to_excel", { config });
  } catch (err: any) {
    console.error("[ExcelExport] Failed:", err);
    toast.error(`Export failed: ${err.message || String(err)}`);
  }
}
