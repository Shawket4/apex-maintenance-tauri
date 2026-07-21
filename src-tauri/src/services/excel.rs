use rust_xlsxwriter::{
    Color, ExcelDateTime, Format, FormatAlign, FormatBorder, Formula, Workbook,
    Worksheet, DocProperties, XlsxError,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::AppResult;

// --- 1. Types & Payloads ---

#[derive(Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExcelColumn {
    pub key: String,
    pub header: String,
    pub r#type: Option<String>,
    pub width: Option<f64>,
    pub total: Option<bool>,
}

#[derive(Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExcelStat {
    pub label: String,
    pub value: Value,
    pub color: Option<String>,
    pub r#type: Option<String>,
}

#[derive(Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExcelSheetConfig {
    pub name: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub is_rtl: bool,
    pub columns: Vec<ExcelColumn>,
    pub rows: Vec<Value>,
    pub stats: Option<Vec<ExcelStat>>,
    pub totals: Option<bool>,
}

#[derive(Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExcelExportConfig {
    pub filename: String,
    pub sheets: Vec<ExcelSheetConfig>,
    pub meta: Option<String>,
    pub creator: Option<String>,
}

// --- 2. Palette & Helpers ---

struct Palette;
impl Palette {
    const BRAND: Color = Color::RGB(0x1E40AF);
    const WHITE: Color = Color::RGB(0xFFFFFF);
    const ROW_EVEN: Color = Color::RGB(0xF9FAFB);
    const BORDER: Color = Color::RGB(0xE5E7EB);
    const MUTED: Color = Color::RGB(0x6B7280);
}

fn parse_color(argb: &str) -> Color {
    let hex = if argb.len() == 8 && argb.starts_with("FF") {
        &argb[2..]
    } else {
        argb
    };
    if let Ok(rgb) = u32::from_str_radix(hex.trim_start_matches('#'), 16) {
        Color::RGB(rgb)
    } else {
        Palette::BRAND
    }
}

// Helper to map XlsxError to AppError
fn map_err(e: XlsxError) -> crate::AppError {
    crate::AppError::Internal(e.to_string())
}

// --- 3. Main Exporter ---

pub struct ExcelExporter;

impl ExcelExporter {
    pub fn generate(config: ExcelExportConfig) -> AppResult<Vec<u8>> {
        let mut workbook = Workbook::new();
        let properties = DocProperties::new()
            .set_author(&config.creator.unwrap_or_else(|| "Apex Fleet".into()))
            .clone();
        workbook.set_properties(&properties);

        for sheet in config.sheets {
            Self::build_sheet(&mut workbook, &sheet, config.meta.as_deref())?;
        }

        workbook.save_to_buffer().map_err(map_err)
    }

    fn build_sheet(
        wb: &mut Workbook,
        sheet: &ExcelSheetConfig,
        meta: Option<&str>,
    ) -> AppResult<()> {
        let mut ws = Worksheet::new();
        
        // Fix: Ensure name is never completely empty after filtering
        let mut safe_name: String = sheet.name.chars().filter(|c| !":\\/?*[]".contains(*c)).take(31).collect();
        if safe_name.is_empty() {
            safe_name = "Sheet".to_string();
        }
        
        ws.set_name(&safe_name).map_err(map_err)?;
        ws.set_right_to_left(sheet.is_rtl);
        let _ = ws.set_print_fit_to_pages(1, 0);
        let _ = ws.set_landscape();
        let _ = ws.set_freeze_panes(7, 0);

        let num_cols = sheet.columns.len() as u16;
        let table_last_col = if num_cols > 0 { num_cols - 1 } else { 0 };
        
        // Calculate the width needed for stats
        let stats_len = sheet.stats.as_ref().map(|s| s.len() as u16).unwrap_or(0);
        let effective_last_col = std::cmp::max(table_last_col, if stats_len > 0 { stats_len - 1 } else { 0 });

        for (i, col) in sheet.columns.iter().enumerate() {
            ws.set_column_width(i as u16, col.width.unwrap_or(18.0)).map_err(map_err)?;
        }

        Self::draw_banner(&mut ws, sheet, meta, effective_last_col)?;
        Self::draw_stats(&mut ws, sheet, effective_last_col)?;
        Self::draw_headers(&mut ws, &sheet.columns, effective_last_col)?;
        Self::draw_data(&mut ws, sheet, effective_last_col)?;

        if sheet.totals.unwrap_or(false) && !sheet.rows.is_empty() {
            Self::draw_totals(&mut ws, sheet, effective_last_col)?;
        }

        wb.push_worksheet(ws);
        Ok(())
    }

    // --- Component Draw Functions ---

    fn draw_banner(ws: &mut Worksheet, sheet: &ExcelSheetConfig, meta: Option<&str>, last_col: u16) -> AppResult<()> {
        ws.set_row_height(0, 40.0).map_err(map_err)?;
        let title_fmt = Format::new().set_font_name("Calibri").set_font_size(16)
            .set_bold().set_font_color(Palette::BRAND).set_align(FormatAlign::Center).set_align(FormatAlign::VerticalCenter);
        
        if last_col > 0 {
            ws.merge_range(0, 0, 0, last_col, &sheet.title, &title_fmt).map_err(map_err)?;
        } else {
            ws.write_string_with_format(0, 0, &sheet.title, &title_fmt).map_err(map_err)?;
        }

        ws.set_row_height(1, 20.0).map_err(map_err)?;
        let mut sub_parts = vec![];
        if let Some(sub) = &sheet.subtitle { sub_parts.push(sub.as_str()); }
        if let Some(m) = meta { sub_parts.push(m); }
        let now = chrono::Local::now().format("%d/%m/%Y %H:%M").to_string();
        sub_parts.push(&now);
        let sub_text = sub_parts.join(" · ");

        let sub_fmt = Format::new().set_font_name("Calibri").set_font_size(9)
            .set_font_color(Palette::MUTED).set_align(FormatAlign::Center).set_align(FormatAlign::VerticalCenter);
        
        if last_col > 0 {
            ws.merge_range(1, 0, 1, last_col, &sub_text, &sub_fmt).map_err(map_err)?;
        } else {
            ws.write_string_with_format(1, 0, &sub_text, &sub_fmt).map_err(map_err)?;
        }

        ws.set_row_height(2, 8.0).map_err(map_err)?;
        if last_col > 0 {
            ws.merge_range(2, 0, 2, last_col, "", &Format::new()).map_err(map_err)?;
        }
        Ok(())
    }

    fn draw_stats(ws: &mut Worksheet, sheet: &ExcelSheetConfig, last_col: u16) -> AppResult<()> {
        if let Some(stats) = &sheet.stats {
            if !stats.is_empty() {
                // Fix: Calculate cells per stat without arbitrarily clamping to last_col.
                // This ensures start_col is ALWAYS <= end_col.
                let base_cols = std::cmp::max(1, last_col + 1);
                let cells_per_stat = std::cmp::max(1, base_cols / (stats.len() as u16));

                for (idx, stat) in stats.iter().enumerate() {
                    let start_col = (idx as u16) * cells_per_stat;
                    let end_col = start_col + cells_per_stat - 1; 

                    let label_fmt = Format::new().set_font_name("Calibri").set_font_size(8)
                        .set_font_color(Palette::MUTED).set_align(FormatAlign::Center).set_align(FormatAlign::VerticalCenter);
                    
                    if start_col == end_col {
                        ws.write_string_with_format(3, start_col, &stat.label, &label_fmt).map_err(map_err)?;
                    } else {
                        ws.merge_range(3, start_col, 3, end_col, &stat.label, &label_fmt).map_err(map_err)?;
                    }

                    let mut val_fmt = Format::new().set_font_name("Calibri").set_font_size(12).set_bold()
                        .set_font_color(stat.color.as_deref().map(parse_color).unwrap_or(Palette::BRAND))
                        .set_align(FormatAlign::Center).set_align(FormatAlign::VerticalCenter);
                    
                    if let Some(t) = &stat.r#type {
                        match t.as_str() {
                            "money" | "moneyRaw" => { val_fmt = val_fmt.set_num_format("#,##0.00 \"EGP\""); },
                            "number" | "integer" => { val_fmt = val_fmt.set_num_format("#,##0"); },
                            _ => {}
                        }
                    }
                    
                    match &stat.value {
                        Value::Number(n) => {
                            let val = n.as_f64().unwrap_or(0.0);
                            if start_col == end_col {
                                ws.write_number_with_format(4, start_col, val, &val_fmt).map_err(map_err)?;
                            } else {
                                ws.merge_range(4, start_col, 4, end_col, "", &val_fmt).map_err(map_err)?;
                                ws.write_number_with_format(4, start_col, val, &val_fmt).map_err(map_err)?;
                            }
                        }
                        Value::String(s) => {
                            if start_col == end_col {
                                ws.write_string_with_format(4, start_col, s, &val_fmt).map_err(map_err)?;
                            } else {
                                ws.merge_range(4, start_col, 4, end_col, s, &val_fmt).map_err(map_err)?;
                            }
                        }
                        _ => {
                            if start_col != end_col {
                                ws.merge_range(4, start_col, 4, end_col, "", &val_fmt).map_err(map_err)?;
                            }
                        }
                    };
                }
            }
        }
        
        ws.set_row_height(5, 8.0).map_err(map_err)?;
        if last_col > 0 {
            ws.merge_range(5, 0, 5, last_col, "", &Format::new()).map_err(map_err)?;
        }
        Ok(())
    }

    fn draw_headers(ws: &mut Worksheet, columns: &[ExcelColumn], last_col: u16) -> AppResult<()> {
        let header_fmt = Format::new().set_font_name("Calibri").set_font_size(10)
            .set_bold().set_font_color(Palette::WHITE).set_background_color(Palette::BRAND)
            .set_border(FormatBorder::Thin).set_border_color(Palette::BORDER)
            .set_align(FormatAlign::Center).set_align(FormatAlign::VerticalCenter);

        ws.set_row_height(6, 25.0).map_err(map_err)?;

        for (i, col) in columns.iter().enumerate() {
            let col_idx = i as u16;
            let end_col = if i == columns.len() - 1 { last_col } else { col_idx };
            
            if col_idx == end_col {
                ws.write_string_with_format(6, col_idx, &col.header, &header_fmt).map_err(map_err)?;
            } else {
                ws.merge_range(6, col_idx, 6, end_col, &col.header, &header_fmt).map_err(map_err)?;
            }
        }
        Ok(())
    }

    fn draw_data(ws: &mut Worksheet, sheet: &ExcelSheetConfig, last_col: u16) -> AppResult<()> {
        let base_fmt = Format::new().set_font_name("Calibri").set_font_size(10)
            .set_border(FormatBorder::Thin).set_border_color(Palette::BORDER)
            .set_align(FormatAlign::Center).set_align(FormatAlign::VerticalCenter);

        for (row_idx, row_data) in sheet.rows.iter().enumerate() {
            let actual_row = 7 + row_idx as u32;
            let bg_color = if row_idx % 2 == 1 { Palette::ROW_EVEN } else { Palette::WHITE };

            for (col_idx, col_def) in sheet.columns.iter().enumerate() {
                let col_num = col_idx as u16;
                let end_col = if col_idx == sheet.columns.len() - 1 { last_col } else { col_num };

                let mut cell_fmt = base_fmt.clone().set_background_color(bg_color);
                let raw_val = row_data.get(&col_def.key).unwrap_or(&Value::Null);

                // Helper to write merged or single cell
                let write_cell = |ws: &mut Worksheet, val: &Value, fmt: &Format| -> AppResult<()> {
                    if col_num == end_col {
                        match val {
                            Value::Number(n) => { ws.write_number_with_format(actual_row, col_num, n.as_f64().unwrap_or(0.0), fmt).map_err(map_err)?; },
                            Value::String(s) => { ws.write_string_with_format(actual_row, col_num, s, fmt).map_err(map_err)?; },
                            Value::Bool(b) => { ws.write_string_with_format(actual_row, col_num, if *b { "TRUE" } else { "FALSE" }, fmt).map_err(map_err)?; },
                            _ => { ws.write_string_with_format(actual_row, col_num, "", fmt).map_err(map_err)?; }
                        }
                    } else {
                        match val {
                            Value::Number(n) => {
                                ws.merge_range(actual_row, col_num, actual_row, end_col, "", fmt).map_err(map_err)?;
                                ws.write_number_with_format(actual_row, col_num, n.as_f64().unwrap_or(0.0), fmt).map_err(map_err)?;
                            },
                            Value::String(s) => { ws.merge_range(actual_row, col_num, actual_row, end_col, s, fmt).map_err(map_err)?; },
                            Value::Bool(b) => { ws.merge_range(actual_row, col_num, actual_row, end_col, if *b { "TRUE" } else { "FALSE" }, fmt).map_err(map_err)?; },
                            _ => { ws.merge_range(actual_row, col_num, actual_row, end_col, "", fmt).map_err(map_err)?; }
                        }
                    }
                    Ok(())
                };

                match col_def.r#type.as_deref() {
                    Some("money") | Some("moneyRaw") => {
                        cell_fmt = cell_fmt.set_num_format("#,##0.00 \"EGP\"");
                        write_cell(ws, raw_val, &cell_fmt)?;
                    },
                    Some("number") | Some("integer") => {
                        cell_fmt = cell_fmt.set_num_format("#,##0");
                        write_cell(ws, raw_val, &cell_fmt)?;
                    },
                    Some("date") | Some("dateTime") => {
                        if let Some(s) = raw_val.as_str() {
                            if let Ok(dt) = ExcelDateTime::parse_from_str(s) {
                                if col_num == end_col {
                                    ws.write_datetime_with_format(actual_row, col_num, &dt, &cell_fmt).map_err(map_err)?;
                                } else {
                                    ws.merge_range(actual_row, col_num, actual_row, end_col, "", &cell_fmt).map_err(map_err)?;
                                    ws.write_datetime_with_format(actual_row, col_num, &dt, &cell_fmt).map_err(map_err)?;
                                }
                                continue;
                            }
                        }
                        write_cell(ws, raw_val, &cell_fmt)?;
                    },
                    _ => {
                        write_cell(ws, raw_val, &cell_fmt)?;
                    }
                }
            }
        }
        Ok(())
    }

    fn draw_totals(ws: &mut Worksheet, sheet: &ExcelSheetConfig, last_col: u16) -> AppResult<()> {
        let total_row = 7 + sheet.rows.len() as u32;
        let cell_fmt = Format::new().set_font_name("Calibri").set_font_size(10)
            .set_bold().set_background_color(Palette::BRAND).set_font_color(Palette::WHITE)
            .set_border(FormatBorder::Thin).set_border_color(Palette::BORDER)
            .set_align(FormatAlign::Center).set_align(FormatAlign::VerticalCenter);

        for (col_idx, col_def) in sheet.columns.iter().enumerate() {
            let col_num = col_idx as u16;
            let end_col = if col_idx == sheet.columns.len() - 1 { last_col } else { col_num };

            if col_idx == 0 {
                if col_num == end_col {
                    ws.write_string_with_format(total_row, col_num, "TOTALS", &cell_fmt).map_err(map_err)?;
                } else {
                    ws.merge_range(total_row, col_num, total_row, end_col, "TOTALS", &cell_fmt).map_err(map_err)?;
                }
            } else if col_def.total.unwrap_or(false) {
                // Generate Excel SUM formula dynamically: =SUM(B8:B105)
                let top_cell = rust_xlsxwriter::utility::row_col_to_cell(7, col_num);
                let bottom_cell = rust_xlsxwriter::utility::row_col_to_cell(total_row - 1, col_num);
                let formula = Formula::new(format!("=SUM({}:{})", top_cell, bottom_cell));
                
                if col_num == end_col {
                    ws.write_formula_with_format(total_row, col_num, formula, &cell_fmt).map_err(map_err)?;
                } else {
                    ws.merge_range(total_row, col_num, total_row, end_col, "", &cell_fmt).map_err(map_err)?;
                    ws.write_formula_with_format(total_row, col_num, formula, &cell_fmt).map_err(map_err)?;
                }
            } else {
                if col_num == end_col {
                    ws.write_string_with_format(total_row, col_num, "", &cell_fmt).map_err(map_err)?;
                } else {
                    ws.merge_range(total_row, col_num, total_row, end_col, "", &cell_fmt).map_err(map_err)?;
                }
            }
        }
        Ok(())
    }
}