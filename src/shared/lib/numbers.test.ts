import { describe, expect, it } from "vitest";

import { fmtKm, fmtMoneyEgp, fmtNumber } from "./numbers";

describe("fmtNumber", () => {
  it("renders Arabic-Indic digits with grouping for ar", () => {
    expect(fmtNumber(1234567, "ar")).toBe("١٬٢٣٤٬٥٦٧");
  });

  it("renders Latin digits with grouping for en", () => {
    expect(fmtNumber(1234567, "en")).toBe("1,234,567");
  });

  it("treats regional variants by prefix", () => {
    expect(fmtNumber(42, "ar-EG")).toBe("٤٢");
    expect(fmtNumber(42, "en-US")).toBe("42");
  });

  it("renders the em-dash placeholder for null/undefined/NaN", () => {
    expect(fmtNumber(null)).toBe("—");
    expect(fmtNumber(undefined)).toBe("—");
    expect(fmtNumber(Number.NaN)).toBe("—");
  });

  it("does not drop zero", () => {
    expect(fmtNumber(0, "en")).toBe("0");
    expect(fmtNumber(0, "ar")).toBe("٠");
  });
});

describe("fmtKm / fmtMoneyEgp", () => {
  it("suffixes the localized unit", () => {
    expect(fmtKm(1500, "ar")).toBe("١٬٥٠٠ كم");
    expect(fmtKm(1500, "en")).toBe("1,500 km");
    expect(fmtMoneyEgp(250, "ar")).toBe("٢٥٠ ج.م");
    expect(fmtMoneyEgp(250, "en")).toBe("EGP 250");
  });

  it("keeps the placeholder unadorned", () => {
    expect(fmtKm(null, "ar")).toBe("—");
    expect(fmtMoneyEgp(null, "en")).toBe("—");
  });
});
