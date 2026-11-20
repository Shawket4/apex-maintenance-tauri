import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import i18n from "@/shared/i18n";
import { WheelDiagram } from "@/widgets/TruckDiagram/WheelDiagram";
import { WheelMap } from "@/widgets/TruckDiagram/WheelMap";
import { syntheticChassis } from "@/widgets/TruckDiagram/layout";

const rig = () => {
  const c = syntheticChassis({ drive_axles: 1, trailer_axles: 1, spares: 1, single_trailer_axles: false });
  // One fitted tire, the rest empty.
  c.positions = c.positions.map((p) =>
    p.position_code === "H2LO" ? { ...p, tire_id: "t1", assignment_id: "a1", brand: "Pirelli", size: "315/80 R22.5" } : p,
  );
  return c;
};

describe("WheelMap (the 2D wheel map)", () => {
  it("draws every wheel as a button named in words, with its state", async () => {
    await i18n.changeLanguage("ar");
    const c = rig();
    render(<WheelMap axles={c.axles} positions={c.positions} onSelect={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(c.positions.length);
    expect(screen.getByRole("button", { name: "الراس محور ٢ شمال برّه — عليه كاوتش Pirelli 315/80 R22.5" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "قدّام يمين — فاضي" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "استبن ١ — فاضي" })).toBeTruthy();
  });

  it("selecting a wheel reports that position and marks it pressed", () => {
    const c = rig();
    const onSelect = vi.fn();
    const target = c.positions.find((p) => p.position_code === "TR1RI")!;
    render(<WheelMap axles={c.axles} positions={c.positions} selectedId={target.id} onSelect={onSelect} />);
    const pressed = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    fireEvent.click(pressed[0]);
    expect(onSelect).toHaveBeenCalledWith(target);
  });

  it("is a picture only (no buttons) when used as the layout preview", () => {
    const c = rig();
    render(<WheelMap axles={c.axles} positions={c.positions} compact />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("TR1LO")).toBeTruthy();
  });
});

describe("WheelDiagram", () => {
  it("shows the 2D map by default, and falls back to it with a notice when 3D cannot run", () => {
    window.localStorage.removeItem("apex-wheel-view");
    const c = rig();
    render(<WheelDiagram axles={c.axles} positions={c.positions} selectedId={null} onSelect={() => {}} />);
    // every wheel + the two view buttons
    expect(screen.getAllByRole("button")).toHaveLength(c.positions.length + 2);
    // jsdom has no WebGL: asking for 3D must keep the map and explain.
    fireEvent.click(screen.getByRole("button", { name: i18n.t("diagram.view.3d") }));
    expect(screen.getByRole("status").textContent).toBe(i18n.t("diagram.view.unsupported"));
    expect(screen.getAllByRole("button")).toHaveLength(c.positions.length + 2);
    expect(window.localStorage.getItem("apex-wheel-view")).toBe("2d");
  });
});
