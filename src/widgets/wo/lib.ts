import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import { useCategories } from "@/shared/api/queries";
import { parseDecimalInput, parseIntInput, toAsciiDigits } from "@/shared/lib/numbers";

/** The usual sump fill. Outside it the Rust side flags the record
 * (`OIL_FLAG_MIN` / `OIL_FLAG_MAX` in services/domain.rs). */
export const OIL_BAND_MIN = 34;
export const OIL_BAND_MAX = 36;

/** An odometer this far above the truck's last reading is probably a typo. */
export const ODO_JUMP_WARN_KM = 50_000;

/** Why a typed odometer looks wrong next to the truck's last known reading. */
export function odometerDoubt(
  typed: number | null,
  current: number | null | undefined,
): "lower" | "jump" | null {
  if (typed == null || current == null) return null;
  if (typed < current) return "lower";
  if (typed > current + ODO_JUMP_WARN_KM) return "jump";
  return null;
}

/** Is there a way to print here at all? */
export function canPrint(): boolean {
  return typeof window !== "undefined";
}

/** Print the page. A desktop window prints by itself; the Android app has no
 * `window.print`, so the app's own print plugin opens the system print screen
 * (a printer, or "save as PDF"). */
export async function printPage(title: string): Promise<void> {
  const opened = await invoke<boolean>("plugin:print-sheet|print", { title }).catch(() => false);
  if (!opened && typeof window.print === "function") window.print();
}

/** Category name in the UI language (the task row only carries the Arabic one). */
export function useCategoryName() {
  const { i18n } = useTranslation();
  const categories = useCategories();
  return (id: string | null | undefined, nameAr?: string | null): string | null => {
    if (!id) return nameAr ?? null;
    const c = categories.data?.find((x) => x.id === id);
    if (!c) return nameAr ?? null;
    return i18n.language.startsWith("ar") ? c.name_ar : c.name_en;
  };
}

/** Plates are matched ignoring spaces and digit script ("١٢٣ أ ب" ~ "123أب"). */
export function plateKey(s: string): string {
  return toAsciiDigits(s).replace(/\s+/g, "").toLowerCase();
}

export type OilDraft = { oilType: string; liters: string; odometer: string };

/** The draft as the command wants it, or null while it cannot be saved. */
export function parseOilDraft(
  d: OilDraft,
): { oilType: string; liters: number; odometer: number | null } | null {
  const oilType = d.oilType.trim();
  const liters = parseDecimalInput(d.liters);
  if (!oilType || liters == null || liters <= 0) return null;
  const odoText = d.odometer.trim();
  const odometer = odoText ? parseIntInput(odoText) : null;
  if (odoText && odometer == null) return null;
  return { oilType, liters, odometer };
}
