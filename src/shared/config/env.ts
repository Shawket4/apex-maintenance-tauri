/**
 * Frontend env configuration. The only place we read `import.meta.env`.
 * Defaults match `.env.example` so a fresh clone runs without copying it.
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

const str = (raw: unknown, fallback: string) =>
  typeof raw === "string" && raw.trim().length > 0 ? raw : fallback;

const e = import.meta.env as Record<string, unknown>;

const validTheme = (raw: unknown): "light" | "dark" | "system" => {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
};

// Every field here is READ somewhere — env settings nobody consumes are the
// "dead config" antipattern this codebase's history warns about.
export const env = {
  defaultLanguage: str(e.VITE_DEFAULT_LANGUAGE, "ar"),
  fallbackLanguage: str(e.VITE_FALLBACK_LANGUAGE, "ar"),
  queryDevtools: bool(e.VITE_QUERY_DEVTOOLS, true),
  defaultTheme: validTheme(e.VITE_DEFAULT_THEME),
  searchDebounceMs: num(e.VITE_SEARCH_DEBOUNCE_MS, 400),
} as const;

export type Env = typeof env;
