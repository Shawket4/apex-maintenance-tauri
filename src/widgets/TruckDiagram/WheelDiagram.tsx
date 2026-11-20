import { Component, Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Info, LayoutGrid } from "lucide-react";

import type { AxleRow, PositionRow } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { Skeleton } from "@/shared/ui/skeleton";

import { WheelLegend, WheelMap } from "./WheelMap";

// three.js is only downloaded/parsed when someone asks for the 3D view.
const TruckDiagram3D = lazy(() => import("./TruckDiagram").then((m) => ({ default: m.TruckDiagram })));

const VIEW_KEY = "apex-wheel-view";
type View = "2d" | "3d";

function storedView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "3d" ? "3d" : "2d";
  } catch {
    return "2d";
  }
}

function storeView(v: View) {
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    // storage unavailable — the choice just won't be remembered
  }
}

/** Can this machine draw 3D at all? (Old drivers, remote desktop and some
 * virtual machines cannot.) */
function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Anything the 3D view throws (no graphics context, a failed chunk load)
 * lands here instead of taking the page down. */
class Scene3DBoundary extends Component<{ onError: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[apex] 3D wheel view failed", error);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export interface WheelDiagramProps {
  axles: AxleRow[];
  positions: PositionRow[];
  selectedId: string | null;
  onSelect: (p: PositionRow) => void;
}

/**
 * The wheel picker both tire screens use. The plain 2D map is the default
 * and does everything; the 3D scene is an optional view behind a toggle
 * (remembered on this device) and falls back to the map, with a short
 * notice, when it cannot run.
 */
export function WheelDiagram({ axles, positions, selectedId, onSelect }: WheelDiagramProps) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<"unsupported" | "failed" | null>(null);
  const [view, setView] = useState<View>(() => (storedView() === "3d" && webglAvailable() ? "3d" : "2d"));

  const choose = (v: View) => {
    if (v === "3d" && !webglAvailable()) {
      setNotice("unsupported");
      setView("2d");
      storeView("2d");
      return;
    }
    setNotice(null);
    setView(v);
    storeView(v);
  };

  const fallBack = () => {
    setNotice("failed");
    setView("2d");
    storeView("2d");
  };

  const viewButton = (v: View, Icon: typeof Box) => (
    <button
      type="button"
      aria-pressed={view === v}
      onClick={() => choose(v)}
      className={cn(
        "flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition pointer-coarse:min-h-11",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon aria-hidden className="h-4 w-4" />
      {t(`diagram.view.${v}`)}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <WheelLegend />
        <div role="group" aria-label={t("diagram.view.label")} className="flex flex-none gap-1 rounded-lg bg-muted p-1">
          {viewButton("2d", LayoutGrid)}
          {viewButton("3d", Box)}
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-status-due_soon/40 bg-status-due_soon-soft px-3 py-2 text-sm"
        >
          <Info aria-hidden className="mt-0.5 h-4 w-4 flex-none text-status-due_soon" />
          {t(`diagram.view.${notice}`)}
        </p>
      )}

      {view === "3d" ? (
        <Scene3DBoundary onError={fallBack}>
          {/* The scene is lit for a light stage, so the stage stays light in
              dark mode too (a dark truck on a dark card was unreadable). */}
          <div className="h-[min(56vh,520px)] min-h-72 overflow-hidden rounded-xl border bg-[#eef1f5]">
            <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
              <TruckDiagram3D
                axles={axles}
                positions={positions}
                selectedId={selectedId}
                onSelect={onSelect}
                onContextLost={fallBack}
              />
            </Suspense>
          </div>
          <p className="text-xs text-muted-foreground">{t("diagram.view.hint3d")}</p>
        </Scene3DBoundary>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-muted/30 p-1.5 sm:p-4">
          <WheelMap axles={axles} positions={positions} selectedId={selectedId} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}
