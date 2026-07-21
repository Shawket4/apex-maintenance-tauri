import { describe, expect, it } from "vitest";
import ar from "./ar.json";
import en from "./en.json";

/** Flattens {a:{b:"x"}} into ["a.b"]. */
function keysOf(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return typeof v === "object" && v !== null
      ? keysOf(v as Record<string, unknown>, path)
      : [path];
  });
}

// ar/en must stay symmetric — a key added to one file only is a bug, not a
// translation backlog item.
describe("i18n catalogs", () => {
  it("ar and en have identical key sets", () => {
    const arKeys = new Set(keysOf(ar));
    const enKeys = new Set(keysOf(en));
    const onlyAr = [...arKeys].filter((k) => !enKeys.has(k));
    const onlyEn = [...enKeys].filter((k) => !arKeys.has(k));
    expect(onlyAr, "keys missing from en.json").toEqual([]);
    expect(onlyEn, "keys missing from ar.json").toEqual([]);
  });

  it("no empty values in either catalog", () => {
    const empty = (o: Record<string, unknown>, name: string) =>
      keysOf(o).filter((k) => {
        const v = k.split(".").reduce<unknown>((acc, part) => {
          return acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : acc;
        }, o);
        return v === "";
      }).map((k) => `${name}:${k}`);
    expect([...empty(ar, "ar"), ...empty(en, "en")]).toEqual([]);
  });
});
