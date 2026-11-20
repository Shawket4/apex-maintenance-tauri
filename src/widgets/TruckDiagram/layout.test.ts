import { describe, expect, it } from "vitest";

import i18n from "@/shared/i18n";
import { fmtNumber } from "@/shared/lib/numbers";
import {
  buildMapLayout,
  positionLabel,
  positionParts,
  syntheticChassis,
  wheelCount,
  wheelShortLabel,
  wheelState,
} from "@/widgets/TruckDiagram/layout";

const cfg = (drive: number, trailer: number, spares: number, single = false) => ({
  drive_axles: drive,
  trailer_axles: trailer,
  spares,
  single_trailer_axles: single,
});

const label = (code: string, chassis: ReturnType<typeof syntheticChassis>, lang: "ar" | "en") => {
  const p = chassis.positions.find((x) => x.position_code === code)!;
  return positionLabel(p, chassis.axles, i18n.getFixedT(lang), (n) => fmtNumber(n, lang));
};

describe("syntheticChassis mirrors the Rust planner", () => {
  it("makes the planner's codes, in the planner's order", () => {
    const c = syntheticChassis(cfg(1, 2, 1));
    expect(c.positions.map((p) => p.position_code)).toEqual([
      "H1L", "H1R", "H2LO", "H2LI", "H2RI", "H2RO",
      "TR1LO", "TR1LI", "TR1RI", "TR1RO", "TR2LO", "TR2LI", "TR2RI", "TR2RO", "SP1",
    ]);
  });

  it("uses L/R codes for single-wheel trailer axles", () => {
    const c = syntheticChassis(cfg(1, 2, 0, true));
    expect(c.positions.filter((p) => p.position_code.startsWith("TR")).map((p) => p.position_code)).toEqual([
      "TR1L", "TR1R", "TR2L", "TR2R",
    ]);
  });

  it("never repeats a code or an id, and every wheel starts empty", () => {
    for (const single of [false, true]) {
      const c = syntheticChassis(cfg(4, 8, 6, single));
      expect(new Set(c.positions.map((p) => p.position_code)).size).toBe(c.positions.length);
      expect(new Set(c.positions.map((p) => p.id)).size).toBe(c.positions.length);
      expect(c.positions.every((p) => p.tire_id === null)).toBe(true);
    }
  });
});

describe("wheelCount", () => {
  it("agrees with the layout it describes", () => {
    for (const c of [cfg(1, 0, 0), cfg(2, 4, 2), cfg(2, 3, 1, true), cfg(4, 8, 6)]) {
      const made = syntheticChassis(c);
      const n = wheelCount(c);
      expect(n.road).toBe(made.positions.filter((p) => !p.is_spare).length);
      expect(n.spares).toBe(made.positions.filter((p) => p.is_spare).length);
    }
  });

  it("counts a 6x4 tractor with a four-axle dual trailer as 26", () => {
    expect(wheelCount(cfg(2, 4, 2))).toEqual({ road: 26, spares: 2 });
  });
});

describe("positionParts", () => {
  const c = syntheticChassis(cfg(2, 2, 1));
  const parts = (code: string) => positionParts(c.positions.find((p) => p.position_code === code)!, c.axles);

  it("reads the steering axle, drive axles, trailer axles and spares", () => {
    expect(parts("H1R")).toEqual({ kind: "steer", side: "right" });
    expect(parts("H3LI")).toEqual({
      kind: "axle", section: "tractor", axle: 3, side: "left", depth: "inner", hasTrailer: true,
    });
    expect(parts("TR2RO")).toEqual({
      kind: "axle", section: "trailer", axle: 2, side: "right", depth: "outer", hasTrailer: true,
    });
    expect(parts("SP1")).toEqual({ kind: "spare", index: 1 });
  });

  it("is 'unknown' when the wheel's axle row is missing", () => {
    expect(positionParts(c.positions.find((p) => p.position_code === "H2LO")!, [])).toEqual({ kind: "unknown" });
  });
});

describe("positionLabel says the wheel in words, in both languages", () => {
  const rig = syntheticChassis(cfg(2, 2, 2));
  const solo = syntheticChassis(cfg(1, 0, 0));
  const singles = syntheticChassis(cfg(1, 2, 0, true));

  it("Arabic", () => {
    expect(label("H1L", rig, "ar")).toBe("قدّام شمال");
    expect(label("H2LO", rig, "ar")).toBe("الراس محور ٢ شمال برّه");
    expect(label("TR1RI", rig, "ar")).toBe("المقطورة محور ١ يمين جوّه");
    expect(label("SP2", rig, "ar")).toBe("استبن ٢");
    expect(label("TR2L", singles, "ar")).toBe("المقطورة محور ٢ شمال");
  });

  it("English", () => {
    expect(label("H1R", rig, "en")).toBe("Front right");
    expect(label("H3RO", rig, "en")).toBe("Tractor axle 3, right outer");
    expect(label("TR2LI", rig, "en")).toBe("Trailer axle 2, left inner");
    expect(label("SP1", rig, "en")).toBe("Spare 1");
    expect(label("TR1R", singles, "en")).toBe("Trailer axle 1, right");
  });

  it("drops the word 'tractor' when the truck has no trailer", () => {
    expect(label("H2LO", solo, "ar")).toBe("محور ٢ شمال برّه");
    expect(label("H2RI", solo, "en")).toBe("Axle 2, right inner");
  });

  it("never shows a bare code or an untranslated key for a known wheel", () => {
    for (const lang of ["ar", "en"] as const) {
      for (const c of [rig, solo, singles]) {
        for (const p of c.positions) {
          const text = label(p.position_code, c, lang);
          expect(text).not.toContain("diagram.");
          expect(text).not.toContain("{{");
          expect(text).not.toBe(p.position_code);
        }
      }
    }
  });

  it("falls back to the code when the axle is unknown", () => {
    const p = rig.positions.find((x) => x.position_code === "H2LO")!;
    expect(positionLabel(p, [], i18n.getFixedT("ar"), String)).toBe("H2LO");
  });

  it("the words printed on a wheel are the side (single) or the depth (dual)", () => {
    const short = (code: string) =>
      wheelShortLabel(rig.positions.find((x) => x.position_code === code)!, rig.axles, i18n.getFixedT("ar"), (n) =>
        fmtNumber(n, "ar"),
      );
    expect(short("H1L")).toBe("شمال");
    expect(short("H2LO")).toBe("برّه");
    expect(short("TR1RI")).toBe("جوّه");
    expect(short("SP1")).toBe("استبن ١");
  });
});

describe("buildMapLayout", () => {
  it("orders axles front to back and wheels as they sit across the truck", () => {
    const c = syntheticChassis(cfg(2, 2, 2));
    // Feed it shuffled rows: the layout must not depend on input order.
    const m = buildMapLayout([...c.axles].reverse(), [...c.positions].reverse());
    expect(m.tractor.map((r) => r.axle.section_index)).toEqual([1, 2, 3]);
    expect(m.trailer.map((r) => r.axle.section_index)).toEqual([1, 2]);
    expect(m.tractor[0].left.map((p) => p.position_code)).toEqual(["H1L"]);
    expect(m.tractor[0].right.map((p) => p.position_code)).toEqual(["H1R"]);
    expect(m.tractor[1].left.map((p) => p.position_code)).toEqual(["H2LO", "H2LI"]);
    expect(m.tractor[1].right.map((p) => p.position_code)).toEqual(["H2RI", "H2RO"]);
    expect(m.trailer[1].left.map((p) => p.position_code)).toEqual(["TR2LO", "TR2LI"]);
    expect(m.spares.map((p) => p.position_code)).toEqual(["SP1", "SP2"]);
    expect(m.maxPerSide).toBe(2);
  });

  it("puts every position on the map exactly once", () => {
    for (const c of [syntheticChassis(cfg(1, 0, 0)), syntheticChassis(cfg(4, 8, 6)), syntheticChassis(cfg(2, 3, 1, true))]) {
      const m = buildMapLayout(c.axles, c.positions);
      const seen = [...m.tractor, ...m.trailer].flatMap((r) => [...r.left, ...r.right]).concat(m.spares);
      expect(seen.map((p) => p.id).sort()).toEqual(c.positions.map((p) => p.id).sort());
    }
  });

  it("keeps a wheel whose axle row is missing reachable (with the spares)", () => {
    const c = syntheticChassis(cfg(1, 1, 1));
    const m = buildMapLayout(c.axles.filter((a) => a.section !== "trailer"), c.positions);
    expect(m.trailer).toEqual([]);
    expect(m.spares.map((p) => p.position_code)).toEqual(["SP1", "TR1LO", "TR1LI", "TR1RI", "TR1RO"]);
  });

  it("reports one wheel per side when no axle is dual", () => {
    const steerOnly = syntheticChassis(cfg(1, 0, 0));
    const m = buildMapLayout(
      steerOnly.axles.filter((a) => a.is_steering),
      steerOnly.positions.filter((p) => p.position_code.startsWith("H1")),
    );
    expect(m.maxPerSide).toBe(1);
  });
});

describe("wheelState", () => {
  it("separates empty, fitted, spare and not-yet-sent", () => {
    expect(wheelState({ tire_id: null, pending: false, is_spare: false })).toBe("empty");
    expect(wheelState({ tire_id: null, pending: true, is_spare: false })).toBe("empty");
    expect(wheelState({ tire_id: "t", pending: false, is_spare: false })).toBe("mounted");
    expect(wheelState({ tire_id: "t", pending: false, is_spare: true })).toBe("spare");
    expect(wheelState({ tire_id: "t", pending: true, is_spare: true })).toBe("pending");
  });
});
