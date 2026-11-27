import { createFileRoute } from "@tanstack/react-router";

import { TruckBatteriesTab } from "@/widgets/batteries/BatteryBay";

/** The truck's batteries: its numbered slots, what is fitted in each, and
 * what came off it (see BatteryBay). */
export const Route = createFileRoute("/_app/trucks/$truckId/batteries")({
  component: TruckBatteriesTab,
});
