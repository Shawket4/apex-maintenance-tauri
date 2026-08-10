import { describe, expect, it } from "vitest";

import { dayjs } from "@/shared/lib/time";
import { classifyMovement, movementItemLabel, rangeToFrom } from "@/shared/lib/movements";

describe("rangeToFrom", () => {
  const now = dayjs("2026-08-10T12:00:00Z");

  it("maps a day count to an inclusive YYYY-MM-DD lower bound", () => {
    expect(rangeToFrom("7", now)).toBe("2026-08-03");
    expect(rangeToFrom("30", now)).toBe("2026-07-11");
    expect(rangeToFrom("90", now)).toBe("2026-05-12");
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

describe("classifyMovement", () => {
  it("credits are stock IN, debits are stock OUT", () => {
    expect(classifyMovement("tire_credit").isIn).toBe(true);
    expect(classifyMovement("oil_credit").isIn).toBe(true);
    expect(classifyMovement("tire_debit").isIn).toBe(false);
    expect(classifyMovement("oil_debit").isIn).toBe(false);
  });

  it("oil_* is oil, tire_* is not", () => {
    expect(classifyMovement("oil_debit").isOil).toBe(true);
    expect(classifyMovement("oil_credit").isOil).toBe(true);
    expect(classifyMovement("tire_debit").isOil).toBe(false);
    expect(classifyMovement("tire_credit").isOil).toBe(false);
  });
});

describe("movementItemLabel", () => {
  it("uses oil_type for oil movements", () => {
    expect(
      movementItemLabel({ kind: "oil_debit", oil_type: "15W40", brand: null, model: null, size: null }),
    ).toBe("15W40");
  });

  it("joins brand/model/size for tire movements, dropping blanks", () => {
    expect(
      movementItemLabel({ kind: "tire_credit", oil_type: null, brand: "Michelin", model: "X", size: "315/80" }),
    ).toBe("Michelin X 315/80");
    expect(
      movementItemLabel({ kind: "tire_debit", oil_type: null, brand: "Michelin", model: null, size: "" }),
    ).toBe("Michelin");
  });

  it("falls back to the em-dash empty-cell convention", () => {
    expect(
      movementItemLabel({ kind: "tire_debit", oil_type: null, brand: null, model: null, size: null }),
    ).toBe("—");
    expect(
      movementItemLabel({ kind: "oil_debit", oil_type: null, brand: null, model: null, size: null }),
    ).toBe("—");
  });
});
