import { describe, expect, it } from "vitest";

import { dayjs } from "@/shared/lib/time";
import {
  describeMovement,
  movementItemLabel,
  movementTotals,
  rangeToDays,
  rangeToFrom,
} from "@/shared/lib/movements";

const row = (kind: string, over: { qty?: number | null; liters?: number | null; oil_type?: string | null } = {}) => ({
  kind,
  qty: over.qty ?? null,
  liters: over.liters ?? null,
  oil_type: over.oil_type ?? null,
});

describe("rangeToFrom", () => {
  // Noon UTC on 10 Aug = 15:00 in Cairo (summer time, UTC+3).
  const now = dayjs("2026-08-10T12:00:00Z");

  it("is the start of that Cairo day, written as a UTC instant", () => {
    // 3 Aug 00:00 Cairo = 2 Aug 21:00 UTC.
    expect(rangeToFrom("7", now)).toBe("2026-08-02T21:00:00");
    expect(rangeToFrom("30", now)).toBe("2026-07-10T21:00:00");
    expect(rangeToFrom("90", now)).toBe("2026-05-11T21:00:00");
  });

  it("follows the Cairo calendar day, not the UTC one", () => {
    // 23:30 UTC on 15 Jan is already 01:30 on 16 Jan in Cairo (winter, UTC+2):
    // 7 days back is 9 Jan in Cairo, which starts at 22:00 UTC on 8 Jan.
    expect(rangeToFrom("7", dayjs("2026-01-15T23:30:00Z"))).toBe("2026-01-08T22:00:00");
  });

  it("compares as text against the stored UTC timestamps, inclusively", () => {
    const from = rangeToFrom("7", now)!;
    // The mirror keeps the server's string; SQLite compares it as text.
    expect("2026-08-02T21:00:00.000000Z" >= from).toBe(true); // 00:00 Cairo, in
    expect("2026-08-02T22:30:00.000000Z" >= from).toBe(true); // 01:30 Cairo, in
    expect("2026-08-02T20:59:59.999999Z" >= from).toBe(false); // 23:59 the day before
    expect("2026-08-02T21:00:00+00:00" >= from).toBe(true);
  });

  it("returns undefined for 'all' (no lower bound)", () => {
    expect(rangeToFrom("all", now)).toBeUndefined();
  });

  it("defends against junk from the URL — non-numeric or non-positive → no bound", () => {
    expect(rangeToFrom("", now)).toBeUndefined();
    expect(rangeToFrom("abc", now)).toBeUndefined();
    expect(rangeToFrom("0", now)).toBeUndefined();
    expect(rangeToFrom("-5", now)).toBeUndefined();
  });
});

describe("rangeToDays", () => {
  it("maps the chips to the days asked from the server", () => {
    expect(rangeToDays("7")).toBe(7);
    expect(rangeToDays("30")).toBe(30);
    expect(rangeToDays("90")).toBe(90);
    expect(rangeToDays("all")).toBe(3650);
  });

  it("falls back to a month on junk", () => {
    expect(rangeToDays("abc")).toBe(30);
    expect(rangeToDays("-1")).toBe(30);
  });
});

describe("describeMovement", () => {
  it("credits are stock IN, debits are stock OUT", () => {
    expect(describeMovement(row("tire_credit", { qty: 4 })).direction).toBe("in");
    expect(describeMovement(row("oil_credit", { liters: 200 })).direction).toBe("in");
    expect(describeMovement(row("tire_debit", { qty: 1 })).direction).toBe("out");
    expect(describeMovement(row("oil_debit", { liters: 36 })).direction).toBe("out");
  });

  it("battery_* is batteries, counted in pieces — not tires", () => {
    expect(describeMovement(row("battery_credit", { qty: 6 }))).toEqual({
      item: "battery",
      direction: "in",
      adjustment: false,
      amount: 6,
    });
    expect(describeMovement(row("battery_debit", { qty: 1 }))).toEqual({
      item: "battery",
      direction: "out",
      adjustment: false,
      amount: 1,
    });
  });

  it("oil_* is oil, tire_* is tires, with the right amount", () => {
    expect(describeMovement(row("oil_debit", { liters: 35.5 }))).toEqual({
      item: "oil",
      direction: "out",
      adjustment: false,
      amount: 35.5,
    });
    expect(describeMovement(row("tire_credit", { qty: 12 }))).toEqual({
      item: "tire",
      direction: "in",
      adjustment: false,
      amount: 12,
    });
  });

  it("an adjustment is not a tire stock-out: it follows its own item and sign", () => {
    expect(describeMovement(row("adjustment", { qty: 3 }))).toEqual({
      item: "tire",
      direction: "in",
      adjustment: true,
      amount: 3,
    });
    expect(describeMovement(row("adjustment", { qty: -2 }))).toEqual({
      item: "tire",
      direction: "out",
      adjustment: true,
      amount: 2,
    });
    expect(describeMovement(row("adjustment", { liters: -10, oil_type: "15W40" }))).toEqual({
      item: "oil",
      direction: "out",
      adjustment: true,
      amount: 10,
    });
    expect(describeMovement(row("adjustment", { oil_type: "15W40" })).item).toBe("oil");
  });
});

describe("movementTotals", () => {
  it("adds received and used, and keeps stock counts apart", () => {
    expect(
      movementTotals([
        row("tire_credit", { qty: 20 }),
        row("tire_debit", { qty: 1 }),
        row("tire_debit", { qty: 1 }),
        row("adjustment", { qty: -3 }),
        row("oil_credit", { liters: 200 }),
        row("oil_debit", { liters: 35.1 }),
        row("oil_debit", { liters: 35.2 }),
        row("adjustment", { liters: 5, oil_type: "15W40" }),
        { ...row("tire_debit", { qty: 2 }), is_count: true },
        { ...row("oil_credit", { liters: 1.5 }), is_count: true },
      ]),
    ).toEqual({
      tiresIn: 20,
      tiresOut: 2,
      oilIn: 200,
      oilOut: 70.3,
      batteriesIn: 0,
      batteriesOut: 0,
      tiresCounted: -5,
      oilCounted: 6.5,
      batteriesCounted: 0,
    });
  });

  it("keeps batteries apart from tires, counts included", () => {
    expect(
      movementTotals([
        row("battery_credit", { qty: 10 }),
        row("battery_debit", { qty: 1 }),
        row("battery_debit", { qty: 1 }),
        { ...row("battery_debit", { qty: 2 }), is_count: true },
        row("tire_credit", { qty: 4 }),
      ]),
    ).toMatchObject({ tiresIn: 4, tiresOut: 0, tiresCounted: 0, batteriesIn: 10, batteriesOut: 2, batteriesCounted: -2 });
  });

  it("is all zeros for no rows", () => {
    expect(movementTotals([])).toEqual({
      tiresIn: 0,
      tiresOut: 0,
      oilIn: 0,
      oilOut: 0,
      batteriesIn: 0,
      batteriesOut: 0,
      tiresCounted: 0,
      oilCounted: 0,
      batteriesCounted: 0,
    });
  });
});

describe("movementItemLabel", () => {
  const base = { qty: null, liters: null };

  it("uses oil_type for oil movements", () => {
    expect(
      movementItemLabel({ ...base, kind: "oil_debit", oil_type: "15W40", brand: null, model: null, size: null }),
    ).toBe("15W40");
    expect(
      movementItemLabel({ ...base, kind: "adjustment", liters: 5, oil_type: "15W40", brand: null, model: null, size: null }),
    ).toBe("15W40");
  });

  it("joins brand/model/size for tire movements, dropping blanks", () => {
    expect(
      movementItemLabel({ ...base, kind: "tire_credit", oil_type: null, brand: "Michelin", model: "X", size: "315/80" }),
    ).toBe("Michelin X 315/80");
    expect(
      movementItemLabel({ ...base, kind: "tire_debit", oil_type: null, brand: "Michelin", model: null, size: "" }),
    ).toBe("Michelin");
  });

  it("names a battery by brand, model and rating", () => {
    expect(
      movementItemLabel({ ...base, kind: "battery_debit", oil_type: null, brand: "Varta", model: "Promotive", size: "100Ah 12V" }),
    ).toBe("Varta Promotive 100Ah 12V");
  });

  it("falls back to the em-dash empty-cell convention", () => {
    expect(
      movementItemLabel({ ...base, kind: "tire_debit", oil_type: null, brand: null, model: null, size: null }),
    ).toBe("—");
    expect(
      movementItemLabel({ ...base, kind: "oil_debit", oil_type: null, brand: null, model: null, size: null }),
    ).toBe("—");
  });
});
