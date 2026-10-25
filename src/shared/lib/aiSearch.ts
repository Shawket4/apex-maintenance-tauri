import type { AiSearchResult, HistoryHit } from "@/shared/api/bindings";
import { fmtCairo } from "./time";
import { fmtKm } from "./numbers";

/**
 * View helpers for the AI search box (`commands.aiSearch`). Routing and the
 * advisor → /ai/query fallback live in Rust (services::history_search).
 */

/** The meta line under a hit: date · km, skipping whatever is missing. */
export function hitMeta(hit: HistoryHit, locale: string): string {
  const parts: string[] = [];
  if (hit.date) parts.push(fmtCairo(hit.date, "YYYY/MM/DD", locale));
  if (hit.meter_reading != null) parts.push(fmtKm(hit.meter_reading, locale));
  return parts.join(" · ");
}

/** Stable React key: the service line, else the invoice. */
export function hitKey(hit: HistoryHit, index: number): string {
  return hit.item_id != null ? `i${hit.item_id}` : `v${hit.invoice_id}-${index}`;
}

/** The i18n key of the notice above a fallback answer, if any. */
export function fallbackNoticeKey(r: AiSearchResult): string | null {
  if (r.source !== "ai_query") return null;
  if (r.fallback === "advisor_error") return "ai.advisorDown";
  if (r.fallback === "no_hits") return "ai.noHitsFellBack";
  return null;
}
