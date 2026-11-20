import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useWo } from "@/shared/api/queries";
import { QueryState } from "@/shared/ui/query-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { WoWheels } from "@/widgets/diagram/TireWorkbench";
import { EmptyState, PageShell } from "@/widgets/layout/PageShell";

export const Route = createFileRoute("/_app/wo/$woId/tires")({
  // The selected wheel lives in the URL (see the truck tires route).
  validateSearch: (s: Record<string, unknown>): { pos?: string } =>
    typeof s.pos === "string" && s.pos ? { pos: s.pos } : {},
  component: WoTires,
});

/** Tire work inside one work order (see WoWheels). A failed read shows an
 * error with Retry; a missing work order says so. */
function WoTires() {
  const { t } = useTranslation();
  const { woId } = Route.useParams();
  const { pos } = Route.useSearch();
  const navigate = Route.useNavigate();
  const wo = useWo(woId);

  return (
    <PageShell width="wide">
      <QueryState query={wo} skeleton={<Skeleton className="h-96 rounded-xl" />}>
        {(detail) =>
          detail ? (
            <WoWheels
              detail={detail}
              pos={pos}
              onSelectPos={(id) => void navigate({ search: id ? { pos: id } : {}, replace: true })}
            />
          ) : (
            <EmptyState>{t("wo.notFound")}</EmptyState>
          )
        }
      </QueryState>
    </PageShell>
  );
}
