import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useChassis } from "@/shared/api/queries";
import { QueryState } from "@/shared/ui/query-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { ChassisWizard } from "@/widgets/diagram/ChassisWizard";
import { TruckWheels } from "@/widgets/diagram/TireWorkbench";
import { EmptyState } from "@/widgets/layout/PageShell";

export const Route = createFileRoute("/_app/trucks/$truckId/tires")({
  // The selected wheel lives in the URL so returning here (back from a tire
  // file, refresh) restores the same truck and the same wheel.
  validateSearch: (s: Record<string, unknown>): { pos?: string } =>
    typeof s.pos === "string" && s.pos ? { pos: s.pos } : {},
  component: TruckTires,
});

/** The truck's tire tab: the wheel layout wizard until the truck has a
 * layout, then the wheel map (see TruckWheels). */
function TruckTires() {
  const { t } = useTranslation();
  const { truckId } = Route.useParams();
  const { pos } = Route.useSearch();
  const navigate = Route.useNavigate();
  const vid = Number(truckId);
  const chassis = useChassis(vid);

  if (!Number.isInteger(vid) || vid <= 0) return <EmptyState>{t("common.notFound")}</EmptyState>;

  return (
    <QueryState query={chassis} skeleton={<Skeleton className="h-96 rounded-xl" />}>
      {(data) =>
        data ? (
          <TruckWheels
            vehicleId={vid}
            data={data}
            pos={pos}
            onSelectPos={(id) => void navigate({ search: id ? { pos: id } : {}, replace: true })}
          />
        ) : (
          <ChassisWizard vehicleId={vid} />
        )
      }
    </QueryState>
  );
}
