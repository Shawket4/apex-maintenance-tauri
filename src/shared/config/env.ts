/**
 * Frontend env configuration.
 *
 * Vite reads `.env` (and `.env.local`) at build time and exposes any var
 * prefixed with `VITE_` on `import.meta.env`. This module is the *only* place
 * we touch `import.meta.env` directly — every other module asks for the typed
 * `env` object so missing/misnamed vars surface as TypeScript errors instead
 * of `undefined`s scattered through the UI.
 *
 * Defaults match `.env.example`. They exist so a fresh clone runs even if
 * nobody has copied `.env.example` → `.env` yet.
 */

const num = (raw: unknown, fallback: number) => {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

const bool = (raw: unknown, fallback: boolean) => {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return fallback;
};

const str = (raw: unknown, fallback: string) => {
  return typeof raw === "string" && raw.trim().length > 0 ? raw : fallback;
};

const e = import.meta.env as Record<string, unknown>;

export const env = {
  appName: str(e.VITE_APP_NAME, "Apex Maintenance"),
  defaultLanguage: str(e.VITE_DEFAULT_LANGUAGE, "ar"),
  fallbackLanguage: str(e.VITE_FALLBACK_LANGUAGE, "ar"),
  queryDevtools: bool(e.VITE_QUERY_DEVTOOLS, true),

  /** Vehicle cache refresh interval, milliseconds. */
  vehiclesRefetchIntervalMs: num(e.VITE_VEHICLES_REFETCH_INTERVAL_MS, 60_000),
  /** Invoice cache refresh interval, milliseconds. */
  invoicesRefetchIntervalMs: num(e.VITE_INVOICES_REFETCH_INTERVAL_MS, 300_000),
  /** Search debounce, milliseconds. */
  searchDebounceMs: num(e.VITE_SEARCH_DEBOUNCE_MS, 400),
} as const;

export type Env = typeof env;
