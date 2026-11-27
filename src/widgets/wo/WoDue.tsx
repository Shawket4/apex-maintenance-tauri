import { useTranslation } from "react-i18next";
import { Check, Loader2, Plus } from "lucide-react";

import { commands, unwrap, type WoDetail } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { fmtKm } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { EmptyState, Section } from "@/widgets/layout/PageShell";

import { SectionTitle } from "./parts";

const STATUS_TONE: Record<string, string> = {
  overdue: "text-status-overdue",
  due_soon: "text-status-due_soon",
  never_done: "text-status-never_done",
};
const KNOWN_STATUS = ["overdue", "due_soon", "never_done", "unknown"];

/** What this truck is due for, with one tap to put it on the work order.
 * An item already on the order is marked instead of offered again. */
export function WoDue({ d, woId, canAdd }: { d: WoDetail; woId: string; canAdd: boolean }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const add = useDomainMutation(
    (p: { category: string; label: string }) => unwrap(commands.woAddTask(woId, p.category, null, p.label)),
    { onError: notifyError },
  );

  const rows = d.due.filter((r) => r.status !== "ok");
  const onOrder = new Set(d.tasks.map((task) => task.category_id).filter(Boolean));

  return (
    <Section title={<SectionTitle>{t("wo.dueTitle")}</SectionTitle>}>
      {rows.length === 0 ? (
        <EmptyState className="p-6">{t("wo.dueEmpty")}</EmptyState>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
          {rows.map((row) => {
            const added = onOrder.has(row.category_id);
            const adding = add.isPending && add.variables?.category === row.category_id;
            const status = KNOWN_STATUS.includes(row.status) ? row.status : "unknown";
            return (
              <div
                key={`${row.vehicle_id}-${row.plan_id}`}
                className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="break-words text-sm font-semibold">
                    {isAr ? row.category_name_ar : row.category_name_en}
                  </div>
                  <div className={cn("text-xs font-medium", STATUS_TONE[status] ?? "text-muted-foreground")}>
                    {t(`wo.dueStatus.${status}`)}
                    {row.next_due_km != null && (
                      <span className="text-muted-foreground tabular">
                        {" · "}
                        {t("wo.dueAtKm", { km: fmtKm(row.next_due_km, i18n.language) })}
                      </span>
                    )}
                    {row.next_due_at != null && (
                      <span className="text-muted-foreground tabular">
                        {" · "}
                        {t("wo.dueOnDate", {
                          date: fmtCairo(row.next_due_at, "YYYY/MM/DD", i18n.language),
                        })}
                      </span>
                    )}
                  </div>
                </div>
                {added ? (
                  <span className="flex flex-none items-center gap-1 text-sm font-semibold text-status-ok">
                    <Check className="h-4 w-4" />
                    {t("wo.dueAdded")}
                  </span>
                ) : (
                  canAdd && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-none"
                      // One at a time: two quick taps must not add it twice.
                      disabled={add.isPending}
                      onClick={() =>
                        // The description is stored data on an Arabic-first
                        // record — always the Arabic name.
                        add.mutate({ category: row.category_id, label: row.category_name_ar })
                      }
                    >
                      {adding ? <Loader2 className="animate-spin" /> : <Plus />}
                      {t("wo.dueAdd")}
                    </Button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
