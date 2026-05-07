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
