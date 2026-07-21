import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useDue } from "@/shared/api/queries";
import { DueList } from "@/widgets/due/DueList";

export const Route = createFileRoute("/_app/trucks/$truckId/due")({
  component: TruckDue,
});

function TruckDue() {
  const { t } = useTranslation();
  const { truckId } = Route.useParams();
  const due = useDue(Number(truckId));
  return <DueList rows={due.data ?? []} emptyText={t("due.empty")} />;
}
