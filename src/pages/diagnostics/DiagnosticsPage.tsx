/**
 * Diagnostics — the honest window into the sync engine. Every queued or dead
 * write is visible here with WHY it's stuck, and dead letters are actionable
 * (retry / discard). "The user can see why something is stuck without a
 * debugger" is a design requirement, not a nicety.
 */

import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, CloudOff, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  useOutboxDiscard,
  useOutboxList,
  useOutboxRetry,
  useSyncNow,
  useSyncStatus,
} from "@/shared/api/sync";
import { appErrorMessage } from "@/shared/api/tauri";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { cn } from "@/shared/lib/cn";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";

export function DiagnosticsPage() {
  const { t } = useTranslation();
  const { data: status } = useSyncStatus();
  const { data: outbox } = useOutboxList();
  const syncNow = useSyncNow();
  const retry = useOutboxRetry();
  const discard = useOutboxDiscard();

  const dead = (outbox ?? []).filter((x) => x.status === "dead");
  const active = (outbox ?? []).filter((x) => x.status !== "dead");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("diag.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("diag.subtitle")}</p>
        </div>
        <Button size="sm" onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
          {t("sync.syncNow")}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: t("diag.connection"),
            value: status?.online ? t("status.online") : t("status.offline"),
            icon: status?.online ? CheckCircle2 : CloudOff,
            tone: status?.online ? "text-emerald-600" : "text-amber-600",
          },
          {
            label: t("diag.pending"),
            value: fmtNumber((status?.pending ?? 0) + (status?.inflight ?? 0)),
            icon: CheckCircle2,
            tone: "text-foreground",
          },
          {
            label: t("diag.dead"),
            value: fmtNumber(status?.dead ?? 0),
            icon: AlertCircle,
            tone: (status?.dead ?? 0) > 0 ? "text-red-600" : "text-muted-foreground",
          },
          {
            label: t("diag.lastPull"),
            value: status?.last_pull_at ? fmtCairo(status.last_pull_at, "HH:mm") : "—",
            icon: CheckCircle2,
            tone: "text-muted-foreground",
          },
        ].map((cardDef) => (
          <Card key={cardDef.label}>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{cardDef.label}</p>
              <p className={cn("text-xl font-bold tabular-nums", cardDef.tone)}>{String(cardDef.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {status?.auth_paused && (
        <Card className="border-amber-500/40">
          <CardContent className="py-3 text-sm text-amber-700">{t("diag.authPaused")}</CardContent>
        </Card>
      )}
      {status?.last_error && (
        <Card className="border-border">
          <CardContent className="py-3 text-xs text-muted-foreground font-mono">{status.last_error}</CardContent>
        </Card>
      )}

      {dead.length > 0 && (
        <Card className="border-red-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-red-600">{t("diag.deadTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border">
            {dead.map((item) => (
              <div key={item.seq} className="px-4 py-3 space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-xs font-semibold rounded bg-muted px-1.5 py-0.5">{item.op}</span>
                  <span className="text-sm font-medium">{t(`diag.entities.${item.entity_type}`)}</span>
                  <span className="text-xs text-muted-foreground font-mono">{item.entity_id.slice(0, 8)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{fmtCairo(item.enqueued_at)}</span>
                  <span className="ms-auto flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={async () => {
                        try {
                          await retry.mutateAsync(item.seq);
                          toast.success(t("diag.requeued"));
                        } catch (e) {
                          toast.error(appErrorMessage(e));
                        }
                      }}
                    >
                      <RotateCcw className="h-3 w-3" />
                      {t("diag.retry")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs text-muted-foreground hover:text-red-600"
                      onClick={async () => {
                        try {
                          await discard.mutateAsync(item.seq);
                          toast.success(t("diag.discarded"));
                        } catch (e) {
                          toast.error(appErrorMessage(e));
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                      {t("diag.discard")}
                    </Button>
                  </span>
                </div>
                {item.last_error && (
                  <p className="text-xs text-red-600/90 font-mono break-all">{item.last_error}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("diag.queueTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0 divide-y divide-border">
          {active.map((item) => (
            <div key={item.seq} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="text-xs font-semibold rounded bg-muted px-1.5 py-0.5">{item.op}</span>
              <span className="text-sm">{t(`diag.entities.${item.entity_type}`)}</span>
              <span className="text-xs text-muted-foreground font-mono">{item.entity_id.slice(0, 8)}</span>
              <span className="text-xs text-muted-foreground">{item.status}</span>
              {item.attempts > 0 && (
                <span className="text-xs text-amber-600 tabular-nums">
                  {t("diag.attempts", { n: item.attempts })}
                </span>
              )}
              <span className="ms-auto text-xs text-muted-foreground tabular-nums">
                {fmtCairo(item.enqueued_at)}
              </span>
            </div>
          ))}
          {active.length === 0 && (
            <p className="px-4 py-8 text-sm text-muted-foreground text-center">{t("diag.queueEmpty")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
