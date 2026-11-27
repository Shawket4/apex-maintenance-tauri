import { createFileRoute } from "@tanstack/react-router";

import { BATTERY_STATUSES } from "@/widgets/batteries/lib";
import { BatteriesPage } from "@/widgets/batteries/BatteriesPage";

export const Route = createFileRoute("/_app/batteries/")({
  // Filter + search live in the URL so back-navigation restores the list.
  validateSearch: (s: Record<string, unknown>): { status?: string; q?: string } => ({
    ...(typeof s.status === "string" && (BATTERY_STATUSES as readonly string[]).includes(s.status)
      ? { status: s.status }
      : {}),
    ...(typeof s.q === "string" && s.q ? { q: s.q } : {}),
  }),
  component: BatteriesPage,
});
