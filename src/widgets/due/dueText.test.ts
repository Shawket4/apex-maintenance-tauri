import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";

import type { DueRow } from "@/shared/api/client";
import { daysText, foldPlate, intervalText, nextDueText, remainingParts } from "./dueText";

// A stand-in translator: the key plus its values, so the test reads the
// decision (which key, which number) and not the wording.
const t = ((key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}(${Object.values(vars).join(",")})` : key) as unknown as TFunction;

const row = (over: Partial<DueRow>): DueRow => ({
  vehicle_id: 1,
  plate: "أ ب ج 1234",
  plan_id: "p",
  category_id: "c",
  category_name_ar: "زيت",
  category_name_en: "Oil",
  trigger_type: "mileage",
  interval_km: null,
  interval_days: null,
  last_at: null,
  last_km: null,
  next_due_km: null,
  next_due_at: null,
  current_odometer: null,
  odometer_source: null,
  odometer_observed_at: null,
  km_remaining: null,
  days_remaining: null,
  status: "ok",
  ...over,
});

describe("daysText", () => {
  it("picks the noun form by count", () => {
    expect(daysText(1, t, "en")).toBe("due.days.one(1)");
    expect(daysText(-2, t, "en")).toBe("due.days.two(2)");
    expect(daysText(5, t, "en")).toBe("due.days.few(5)");
    expect(daysText(12, t, "en")).toBe("due.days.many(12)");
  });
});

describe("remainingParts", () => {
  it("says late for negative and left for positive, per clock", () => {
    const parts = remainingParts(row({ km_remaining: -300, days_remaining: 12 }), t, "en");
    expect(parts.map((p) => p.tone)).toEqual(["late", "left"]);
    expect(parts[0].text).toBe("due.late(300 km)");
    expect(parts[1].text).toBe("due.left(due.days.many(12))");
  });
  it("is empty when neither clock can be read", () => {
    expect(remainingParts(row({}), t, "en")).toEqual([]);
  });
  it("treats zero as due now", () => {
    expect(remainingParts(row({ km_remaining: 0, days_remaining: 0 }), t, "en").map((p) => p.tone)).toEqual([
      "now",
      "now",
    ]);
  });
});

describe("intervalText / nextDueText", () => {
  it("joins km and days with 'or'", () => {
    expect(intervalText(row({ interval_km: 10000, interval_days: 180 }), t, "en")).toBe(
      "due.every(10,000 kmdue.ordue.days.many(180))",
    );
    expect(intervalText(row({}), t, "en")).toBeNull();
  });
  it("separates the km point from the date", () => {
    const s = nextDueText(row({ next_due_km: 120000, next_due_at: "2026-12-01T10:00:00Z" }), t, "en");
    expect(s).toBe("due.nextDue(due.nextAtKm(120,000 km) · due.nextOnDate(2026/12/01))");
  });
});

describe("foldPlate", () => {
  it("matches a plate typed with or without spaces and in either digit script", () => {
    const plate = foldPlate("أ ب ج 1234");
    expect(plate.includes(foldPlate("ابج١٢٣٤"))).toBe(true);
    expect(plate.includes(foldPlate("ج 12"))).toBe(true);
    expect(plate.includes(foldPlate("999"))).toBe(false);
  });
});
