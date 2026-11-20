import { describe, expect, it } from "vitest";

import {
  commonSize,
  kmOnTruck,
  matchesSearch,
  normalizeSize,
  sameSize,
  sortStockLines,
  sortUsedTires,
} from "@/widgets/diagram/pick";

const tire = (id: string, brand: string, size: string | null, total_km: number, dot_code: string | null = null) => ({
  id,
  brand,
  model: null,
  size,
  dot_code,
  total_km,
});

describe("sizes", () => {
  it("ignores case, spaces and dashes", () => {
    expect(normalizeSize(" 315/80 R22.5 ")).toBe("315/80r22.5");
    expect(sameSize("315/80 R22.5", "315/80r22.5")).toBe(true);
    expect(sameSize("315/80 R22.5", "385/65 R22.5")).toBe(false);
  });

  it("never matches two missing sizes", () => {
    expect(sameSize(null, null)).toBe(false);
    expect(sameSize("", "")).toBe(false);
    expect(sameSize("315/80R22.5", null)).toBe(false);
  });

  it("commonSize picks the size most tires share, as first written", () => {
    expect(commonSize(["315/80 R22.5", null, "385/65 R22.5", "315/80r22.5", ""])).toBe("315/80 R22.5");
    expect(commonSize([null, undefined, ""])).toBeNull();
    expect(commonSize([])).toBeNull();
  });
});

describe("matchesSearch", () => {
  const t = { brand: "Pirelli", model: "FH01", size: "315/80 R22.5", dot_code: "DOT 4B9X 2319" };
  it("matches brand, model, size and DOT, in any case", () => {
    expect(matchesSearch(t, "pirelli")).toBe(true);
    expect(matchesSearch(t, "fh01")).toBe(true);
    expect(matchesSearch(t, "315/80r22.5")).toBe(true);
    expect(matchesSearch(t, "2319")).toBe(true);
  });
  it("needs every typed word", () => {
    expect(matchesSearch(t, "pirelli 2319")).toBe(true);
    expect(matchesSearch(t, "pirelli michelin")).toBe(false);
  });
  it("an empty search matches everything, including tires with no DOT", () => {
    expect(matchesSearch({ brand: "X", model: null, size: null, dot_code: null }, "  ")).toBe(true);
  });
});

describe("sortUsedTires", () => {
  const pool = [
    tire("a", "Michelin", "385/65 R22.5", 90_000),
    tire("b", "Pirelli", "315/80 R22.5", 60_000),
    tire("c", "Bridgestone", "315/80r22.5", 20_000),
    tire("d", "Michelin", null, 10_000),
    tire("e", "Pirelli", "315/80 R22.5", 5_000),
  ];

  it("puts the wanted size first, then brand, then least-worn", () => {
    expect(sortUsedTires(pool, { preferredSize: "315/80 R22.5" }).map((t) => t.id)).toEqual(["c", "e", "b", "d", "a"]);
  });

  it("puts tires just taken off this truck above everything", () => {
    expect(sortUsedTires(pool, { preferredSize: "315/80 R22.5", recentIds: ["a"] }).map((t) => t.id)[0]).toBe("a");
  });

  it("without a wanted size it is brand, then least-worn", () => {
    expect(sortUsedTires(pool).map((t) => t.id)).toEqual(["c", "d", "a", "e", "b"]);
  });

  it("does not change the list it was given", () => {
    const before = pool.map((t) => t.id);
    sortUsedTires(pool, { preferredSize: "315/80 R22.5" });
    expect(pool.map((t) => t.id)).toEqual(before);
  });
});

describe("sortStockLines", () => {
  const line = (brand: string, size: string | null, projected_qty: number) => ({ brand, model: null, size, projected_qty });
  it("wanted size first, and within a group the lines that still have tires", () => {
    const lines = [line("A", "385/65 R22.5", 4), line("B", "315/80 R22.5", 0), line("C", "315/80 R22.5", 3), line("D", null, -1)];
    expect(sortStockLines(lines, "315/80R22.5").map((l) => l.brand)).toEqual(["C", "B", "A", "D"]);
  });
});

describe("kmOnTruck", () => {
  it("is the distance since the tire was fitted", () => {
    expect(kmOnTruck({ is_spare: false, mounted_odometer: 100_000 }, 112_500)).toBe(12_500);
    expect(kmOnTruck({ is_spare: false, mounted_odometer: 100_000 }, 100_000)).toBe(0);
  });
  it("is unknown — not zero — when readings are missing or contradict", () => {
    expect(kmOnTruck({ is_spare: false, mounted_odometer: null }, 112_500)).toBeNull();
    expect(kmOnTruck({ is_spare: false, mounted_odometer: 100_000 }, null)).toBeNull();
    expect(kmOnTruck({ is_spare: false, mounted_odometer: 100_000 }, 90_000)).toBeNull();
  });
  it("a spare does not run", () => {
    expect(kmOnTruck({ is_spare: true, mounted_odometer: 100_000 }, 112_500)).toBeNull();
  });
});
