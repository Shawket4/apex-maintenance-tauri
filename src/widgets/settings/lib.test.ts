import { describe, expect, it } from "vitest";
import {
  changeKey,
  defaultWarnDays,
  defaultWarnKm,
  nameKey,
  parsePayload,
  payloadVehicleId,
  plateKey,
  shownFields,
  slugForClass,
  validatePlan,
} from "./lib";

describe("slugForClass", () => {
  it("spells an Arabic name in Latin letters the server accepts", () => {
    const id = slugForClass("تريلا مرسيدس", []);
    expect(id).toMatch(/^[a-z0-9_]+$/);
    expect(id).toBe("tryla_mrsyds");
  });
  it("keeps an English name and Arabic digits", () => {
    expect(slugForClass("Volvo FH ١٦", [])).toBe("volvo_fh_16");
  });
  it("never returns an id that is taken, or an empty one", () => {
    expect(slugForClass("Volvo", ["volvo", "volvo_2"])).toBe("volvo_3");
    expect(slugForClass("!!!", [])).toBe("class");
    expect(slugForClass("ءءء", ["class"])).toBe("class_2");
  });
});

describe("nameKey / plateKey", () => {
  it("treats spelling variants of one name as the same name", () => {
    expect(nameKey("  تريلّا   مرسيدس ")).toBe(nameKey("تريلا مرسيدس"));
    expect(nameKey("أتوبيس")).toBe(nameKey("اتوبيس"));
    expect(nameKey("Volvo")).toBe(nameKey("volvo"));
    expect(nameKey("قلاب")).not.toBe(nameKey("تريلا"));
  });
  it("matches plates across spaces and digit scripts", () => {
    expect(plateKey("ط ر ب ٨٣٥١")).toBe(plateKey("طرب8351"));
  });
});

describe("validatePlan", () => {
  const f = (km: string, days: string, warnKm = "", warnDays = "") => ({ km, days, warnKm, warnDays });
  it("needs at least one interval", () => {
    expect(validatePlan(f("", ""))).toEqual({ ok: false, error: "needInterval" });
  });
  it("accepts km, days, or both — in any digit script", () => {
    expect(validatePlan(f("١٠٠٠٠", ""))).toEqual({
      ok: true,
      values: { intervalKm: 10000, intervalDays: null, leadWarnKm: 1000, leadWarnDays: null },
    });
    expect(validatePlan(f("10000", "180", "500", "7"))).toEqual({
      ok: true,
      values: { intervalKm: 10000, intervalDays: 180, leadWarnKm: 500, leadWarnDays: 7 },
    });
  });
  it("refuses zero, and a warning that swallows the interval", () => {
    expect(validatePlan(f("0", ""))).toEqual({ ok: false, error: "badKm" });
    expect(validatePlan(f("", "0"))).toEqual({ ok: false, error: "badDays" });
    expect(validatePlan(f("1000", "", "1000"))).toEqual({ ok: false, error: "warnTooBigKm" });
    expect(validatePlan(f("", "30", "", "30"))).toEqual({ ok: false, error: "warnTooBigDays" });
  });
  it("drops a warning that has no interval of its own", () => {
    expect(validatePlan(f("5000", "", "0", "7"))).toEqual({
      ok: true,
      values: { intervalKm: 5000, intervalDays: null, leadWarnKm: 0, leadWarnDays: null },
    });
  });
  it("fills an empty warning with the usual one, always shorter than the interval", () => {
    expect(defaultWarnKm(10000)).toBe(1000);
    expect(defaultWarnKm(500)).toBe(100);
    expect(defaultWarnKm(60000)).toBe(2000);
    expect(defaultWarnKm(50)).toBe(49);
    expect(defaultWarnDays(180)).toBe(14);
    expect(defaultWarnDays(30)).toBe(3);
    expect(defaultWarnDays(1)).toBe(0);
    expect(validatePlan(f("", "90"))).toEqual({
      ok: true,
      values: { intervalKm: null, intervalDays: 90, leadWarnKm: null, leadWarnDays: 9 },
    });
  });
});

describe("changes in words", () => {
  it("names the common changes", () => {
    expect(changeKey("tire_assignments", "insert", {})).toBe("mount");
    expect(changeKey("tire_assignments", "update", { dismounted_at: "2026-01-01T00:00:00Z" })).toBe("dismount");
    expect(changeKey("tire_assignments", "delete", {})).toBe("mountUndo");
    expect(changeKey("work_order_tasks", "insert", {})).toBe("taskAdd");
    expect(changeKey("work_order_tasks", "update", { is_done: 1 })).toBe("taskDone");
    expect(changeKey("work_orders", "update", { title: "x" })).toBe("woEdit");
    expect(changeKey("work_orders", "update", { status: "closed" })).toBe("woClose");
    expect(changeKey("oil_changes", "insert", {})).toBe("oilAdd");
    expect(changeKey("oil_changes", "delete", null)).toBe("oilDelete");
    expect(changeKey("chassis_axles", "insert", null)).toBe("chassisAdd");
    expect(changeKey("something_new", "update", null)).toBe("otherEdit");
  });
  it("reads a payload, and survives a broken one", () => {
    expect(parsePayload('{"liters":35}')).toEqual({ liters: 35 });
    expect(parsePayload("not json")).toBeNull();
    expect(parsePayload("[1]")).toBeNull();
    expect(parsePayload(null)).toBeNull();
  });
  it("shows the entered fields and hides ids and bookkeeping", () => {
    const fields = shownFields({
      id: "0b6f0c0e-0000-4000-8000-000000000000",
      work_order_id: "9d1a2b3c-0000-4000-8000-000000000000",
      vehicle_id: 42,
      oil_type: "15W40",
      liters: 35.5,
      odometer: 412300,
      flagged: 0,
      sync_version: 3,
      created_by_user_id: 7,
      updated_at: "2026-01-01T00:00:00Z",
      notes: "",
    });
    expect(fields.map((x) => x.field)).toEqual(["vehicle_id", "oil_type", "liters", "odometer"]);
  });
  it("finds the truck a change was about", () => {
    expect(payloadVehicleId("oil_changes", "x", { vehicle_id: 42 })).toBe(42);
    expect(payloadVehicleId("vehicle_class_assignments", "17", {})).toBe(17);
    expect(payloadVehicleId("tires", "abc", {})).toBeNull();
  });
});
