import { describe, expect, it } from "vitest";
import type { AiSearchResult, HistoryHit } from "@/shared/api/bindings";
import { fallbackNoticeKey, hitKey, hitMeta } from "./aiSearch";

const hit: HistoryHit = {
  invoice_id: 1201,
  item_id: 77,
  car_id: 42,
  plate_number: "ط ر ب 8351",
  date: "2026-05-01T22:30:00Z",
  meter_reading: 412300,
  service: "تغيير تيل فرامل أمامي",
  notes: null,
  score: 0.03,
  matched: [],
};

describe("hitMeta", () => {
  it("shows the Cairo date and the km", () => {
    // 22:30Z is already the next day in Cairo.
    expect(hitMeta(hit, "en")).toBe("2026/05/02 · 412,300 km");
  });
  it("skips missing parts", () => {
    expect(hitMeta({ ...hit, meter_reading: null }, "en")).toBe("2026/05/02");
    expect(hitMeta({ ...hit, date: null }, "en")).toBe("412,300 km");
    expect(hitMeta({ ...hit, date: null, meter_reading: null }, "en")).toBe("");
  });
  it("uses Arabic numerals in Arabic", () => {
    expect(hitMeta({ ...hit, date: null }, "ar")).toBe("٤١٢٬٣٠٠ كم");
  });
});

describe("hitKey", () => {
  it("prefers the service line id", () => {
    expect(hitKey(hit, 0)).toBe("i77");
    expect(hitKey({ ...hit, item_id: null }, 3)).toBe("v1201-3");
  });
});

describe("fallbackNoticeKey", () => {
  const ai = (fallback: "advisor_error" | "no_hits" | null): AiSearchResult => ({
    source: "ai_query",
    answer: "",
    rows: [],
    fallback,
  });
  it("explains a fallback, and nothing else", () => {
    expect(fallbackNoticeKey(ai("advisor_error"))).toBe("ai.advisorDown");
    expect(fallbackNoticeKey(ai("no_hits"))).toBe("ai.noHitsFellBack");
    expect(fallbackNoticeKey(ai(null))).toBeNull();
    expect(
      fallbackNoticeKey({ source: "advisor", variants: [], plate_number: null, hits: [] }),
    ).toBeNull();
  });
});
