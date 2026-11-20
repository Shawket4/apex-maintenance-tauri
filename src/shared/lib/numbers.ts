/**
 * Number formatting utilities. Per architecture §12.3:
 * - When locale is `ar`, render numbers in Arabic-Indic numerals.
 * - Always group by thousands.
 */

const arFmt = new Intl.NumberFormat("ar-EG", { numberingSystem: "arab" });
const enFmt = new Intl.NumberFormat("en-US");

export function fmtNumber(n: number | null | undefined, locale = "ar") {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return locale.startsWith("ar") ? arFmt.format(n) : enFmt.format(n);
}

export function fmtKm(n: number | null | undefined, locale = "ar") {
  if (n === null || n === undefined) return "—";
  const num = fmtNumber(n, locale);
  return locale.startsWith("ar") ? `${num} كم` : `${num} km`;
}

export function fmtMoneyEgp(n: number | null | undefined, locale = "ar") {
  if (n === null || n === undefined) return "—";
  const num = fmtNumber(n, locale);
  return locale.startsWith("ar") ? `${num} ج.م` : `EGP ${num}`;
}

/** Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits → ASCII, and the
 * Arabic decimal/thousands marks → their ASCII meaning. The app SHOWS numbers
 * in Arabic digits, so it has to accept them too. */
export function toAsciiDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/٬/g, "");
}

/** Text a person typed → a whole number, or null when empty/not a number.
 * Spaces and thousands separators are ignored ("١٢٣٬٤٥٦", "123,456", "123 456"). */
export function parseIntInput(s: string | null | undefined): number | null {
  if (s == null) return null;
  const clean = toAsciiDigits(s).replace(/[\s,]/g, "");
  if (!/^\d+$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isSafeInteger(n) ? n : null;
}

/** Text a person typed → a decimal number, or null. Accepts "35.5", "35,5",
 * "٣٥٫٥". A single comma is read as the decimal mark (how litres are typed
 * on an Arabic or European keyboard). */
export function parseDecimalInput(s: string | null | undefined): number | null {
  if (s == null) return null;
  let clean = toAsciiDigits(s).replace(/\s/g, "");
  if (clean.includes(",") && !clean.includes(".") && clean.split(",").length === 2) {
    clean = clean.replace(",", ".");
  } else {
    clean = clean.replace(/,/g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

/** Keep only what a number field may hold while typing (digits in any script,
 * and one decimal mark when `decimal`). Arabic digits are kept as typed. */
export function sanitizeNumberTyping(s: string, decimal = false): string {
  const allowed = decimal ? /[^0-9٠-٩۰-۹.,٫]/g : /[^0-9٠-٩۰-۹]/g;
  return s.replace(allowed, "");
}

export function fmtLiters(n: number | null | undefined, locale = "ar") {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const f = new Intl.NumberFormat(locale.startsWith("ar") ? "ar-EG" : "en-US", {
    numberingSystem: locale.startsWith("ar") ? "arab" : "latn",
    maximumFractionDigits: 2,
  });
  return locale.startsWith("ar") ? `${f.format(n)} لتر` : `${f.format(n)} L`;
}
