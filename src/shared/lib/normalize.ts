import { toAsciiDigits } from "./numbers";

/** Comparison key for names. MUST match the Rust `norm` (services/views/
 * catalog.rs) and the server's `maint_norm`: case, spacing, punctuation,
 * Arabic letter variants and digit scripts do not make a different thing. */
export function norm(s: string | null | undefined): string {
  if (!s) return "";
  return toAsciiDigits(s)
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/[^0-9a-zء-ي]+/g, "");
}

/** Does `text` contain every word of `query`? (Search-as-you-type: order of
 * words and the things `norm` ignores do not matter.) */
export function matches(text: string, query: string): boolean {
  const hay = norm(text);
  return query
    .split(/\s+/)
    .map(norm)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
