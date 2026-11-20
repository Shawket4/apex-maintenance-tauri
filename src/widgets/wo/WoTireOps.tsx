import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight, CircleDot } from "lucide-react";

import type { WoDetail } from "@/shared/api/client";
import { Button } from "@/shared/ui/button";
import { ListCard, Section } from "@/widgets/layout/PageShell";

import { ClosedNote, PendingBadge, SectionTitle } from "./parts";

/** Tire work done under this order. The work itself happens on the tire
 * diagram; this is the summary and the way in. */
export function WoTireOps({ d, woId, canEdit }: { d: WoDetail; woId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  return (
    <Section
      title={
        <SectionTitle icon={<CircleDot className="h-4 w-4 text-primary" />}>
          {t("wo.tireTitle")}
        </SectionTitle>
      }
    >
      <ListCard>
        {d.tire_ops.length === 0 && (
          <div className="px-4 py-4 text-sm text-muted-foreground">{t("wo.tireEmpty")}</div>
        )}
        {d.tire_ops.map((op) => (
          <Link
            key={op.assignment_id}
            to="/tires/$tireId"
            params={{ tireId: op.tire_id }}
            className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm transition hover:bg-primary/[0.03]"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <bdi className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary tabular">
                {op.position_code ?? "—"}
              </bdi>
              <bdi className="font-semibold">{op.dot_code ?? op.brand ?? t("wo.tireUnnamed")}</bdi>
              {op.pending && <PendingBadge />}
            </span>
            <span className="flex flex-none items-center gap-1 text-muted-foreground">
              {op.dismounted_at ? t("wo.tireDismounted") : t("wo.tireMounted")}
              <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
            </span>
          </Link>
        ))}
        {canEdit ? (
          <div className="bg-background/70 px-4 py-3">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/wo/$woId/tires" params={{ woId }}>
                <CircleDot />
                {t("wo.tireOpen")}
              </Link>
            </Button>
          </div>
        ) : (
          <ClosedNote />
        )}
      </ListCard>
    </Section>
  );
}
