import { describe, expect, it } from "vitest";

import { fmtCairo, todayCairoYmd, nowUtcIso } from "./time";

describe("fmtCairo", () => {
  it("renders UTC winter timestamps at Cairo +02:00", () => {
    expect(fmtCairo("2026-01-15T10:00:00Z", "YYYY/MM/DD HH:mm", "en")).toBe("2026/01/15 12:00");
  });

  it("renders UTC summer timestamps at Cairo +03:00 (Egypt DST)", () => {
    expect(fmtCairo("2026-07-15T10:00:00Z", "YYYY/MM/DD HH:mm", "en")).toBe("2026/07/15 13:00");
  });

  it("crosses the date line correctly near midnight", () => {
    // 23:30 UTC in winter = 01:30 next day in Cairo.
    expect(fmtCairo("2026-01-15T23:30:00Z", "YYYY/MM/DD HH:mm", "en")).toBe("2026/01/16 01:30");
  });

  it("renders the placeholder for empty input", () => {
    expect(fmtCairo(null)).toBe("—");
    expect(fmtCairo(undefined)).toBe("—");
  });
});

describe("clock helpers", () => {
  it("todayCairoYmd yields an ISO date", () => {
    expect(todayCairoYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("nowUtcIso is millisecond UTC with Z suffix", () => {
    expect(nowUtcIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
