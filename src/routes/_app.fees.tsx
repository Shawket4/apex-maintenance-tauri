import { createFileRoute } from "@tanstack/react-router";

import { FeesPage } from "@/widgets/fees/FeesPage";

export const Route = createFileRoute("/_app/fees")({
  component: FeesPage,
});
