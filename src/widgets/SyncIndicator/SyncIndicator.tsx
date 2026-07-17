/**
 * Header sync badge. Honest by contract:
 *   green   — queue empty, engine reachable
 *   amber   — writes queued locally (offline or backlog), nothing lost
 *   red     — dead letters need attention → links to Diagnostics
 * A red count NEVER hides inside the pending number — hiding failures behind
 * a green check is exactly the lie the previous client told.
 */

import { Link } from "@tanstack/react-router";
import { AlertCircle, Cloud, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSyncNow, useSyncStatus } from "@/shared/api/sync";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { fmtNumber } from "@/shared/lib/numbers";

export function SyncIndicator() {
  const { t } = useTranslation();
  const { data: status } = useSyncStatus();
  const syncNow = useSyncNow();

  const pending = (status?.pending ?? 0) + (status?.inflight ?? 0);
  const dead = status?.dead ?? 0;
  const offline = status ? !status.online : false;

  return (
    <div className="flex items-center gap-3 bg-muted/30 px-3 py-1 rounded-full border border-border/50">
      {dead > 0 && (
        <Link to="/diagnostics">
          <Button
            variant="destructive"
            size="sm"
            className="h-6 px-2 gap-1.5 rounded-full text-[10px] font-bold"
          >
            <AlertCircle className="h-3 w-3" />
            <span>
              {fmtNumber(dead)} {t("sync.failed")}
            </span>
          </Button>
        </Link>
      )}

      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        {offline ? (
          <CloudOff className="h-4 w-4 text-amber-500" />
        ) : (
          <Cloud className={cn("h-4 w-4", pending > 0 ? "text-amber-500" : "text-emerald-500")} />
        )}
        {pending > 0 ? (
          <span>
            {fmtNumber(pending)} {t("sync.queued")}
          </span>
        ) : (
          <span>{t("sync.upToDate")}</span>
        )}
      </span>

      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 rounded-full"
        aria-label={t("sync.syncNow")}
        disabled={syncNow.isPending}
        onClick={() => syncNow.mutate()}
      >
        {syncNow.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}
