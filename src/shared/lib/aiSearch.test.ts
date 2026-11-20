import { describe, expect, it } from "vitest";
import type { AiSearchResult, HistoryHit } from "@/shared/api/bindings";
import aiAr from "@/shared/i18n/locales/ai.ar.json";
import aiEn from "@/shared/i18n/locales/ai.en.json";
import {
  columnLabelKey,
  fallbackNoticeKey,
  fmtId,
  formatCell,
  hitKey,
  hitMeta,
  isAggregateQuestion,
  plainColumnName,
  visibleColumns,
} from "./aiSearch";

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

describe("isAggregateQuestion (mirrors the Rust router)", () => {
  it("spots counting, totals and rankings", () => {
    for (const q of [
      "أنهي عربية غيّرت كاوتش أكتر حاجة السنة دي؟",
      "كام مرة غيرنا زيت للعربية 5139",
      "اجمالي تكلفة الصيانة الشهر ده",
      "How many oil changes last month?",
      "Which truck spent the most on tires",
      "بكام تغيير الزيت؟",
      "مين الأكتر في تغيير الكاوتش",
    ]) {
      expect(isAggregateQuestion(q), q).toBe(true);
    }
  });
  it("leaves lookups alone", () => {
    for (const q of [
      "امتى آخر تغيير زيت للعربية 5139؟",
      "كل شغل الفرامل الشهرين اللي فاتوا",
      "تيل فرامل 8351",
      "When was the last oil change for truck 5139?",
      "صيانة كاملة",
      "stop light",
    ]) {
      expect(isAggregateQuestion(q), q).toBe(false);
    }
  });
  it("the example questions go where the screen says they go", () => {
    for (const ex of [aiAr.examples, aiEn.examples]) {
      expect(isAggregateQuestion(ex.lastOil.replace("{{plate}}", "ط ر ب 8351"))).toBe(false);
      expect(isAggregateQuestion(ex.lastOilNoPlate)).toBe(false);
      expect(isAggregateQuestion(ex.brakes)).toBe(false);
      expect(isAggregateQuestion(ex.battery)).toBe(false);
      expect(isAggregateQuestion(ex.mostTires)).toBe(true);
    }
  });
});

describe("answer table", () => {
  const words = { yes: "yes", no: "no" };
  it("hides ids and keeps first-seen order", () => {
    expect(
      visibleColumns([
        { id: 1, car_id: 4, plate_number: "أ ب 1", count: 3 },
        { id: 2, invoice_id: 9, date: "2026-01-01" },
      ]),
    ).toEqual(["plate_number", "count", "date"]);
  });
  it("labels known columns and guesses common aliases", () => {
    expect(columnLabelKey("plate_number")).toBe("ai.col.plate");
    expect(columnLabelKey("METER_READING")).toBe("ai.col.odometer");
    expect(columnLabelKey("oil_count")).toBe("ai.col.count");
    expect(columnLabelKey("last_service_at")).toBe("ai.col.date");
    expect(columnLabelKey("whatever")).toBeNull();
    expect(plainColumnName("tire_changes")).toBe("tire changes");
  });
  it("formats cells for reading, never as JSON", () => {
    expect(formatCell("date", "2026-05-01T22:30:00Z", "en", words)).toBe("2026/05/02");
    expect(formatCell("date", "2026-05-01", "en", words)).toBe("2026/05/01");
    expect(formatCell("meter_reading", 412300, "en", words)).toBe("412,300 km");
    expect(formatCell("count", "12", "ar", words)).toBe("١٢");
    expect(formatCell("year", 2026, "en", words)).toBe("2026");
    expect(formatCell("plate_number", "8351", "ar", words)).toBe("8351");
    expect(formatCell("whatever", true, "en", words)).toBe("yes");
    expect(formatCell("notes", null, "en", words)).toBe("—");
    expect(formatCell("x", { a: 1 }, "en", words)).toBe("—");
    expect(formatCell("x", ["a", "b"], "en", words)).toBe("a, b");
  });
  it("prints record numbers ungrouped", () => {
    expect(fmtId(1201, "ar")).toBe("١٢٠١");
    expect(fmtId(1201, "en")).toBe("1201");
  });
});
