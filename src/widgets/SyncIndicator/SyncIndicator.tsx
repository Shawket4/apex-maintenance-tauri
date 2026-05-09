import { useSyncStore } from "@/shared/api/sync";
import { Button } from "@/shared/ui/button";
import { RefreshCw, AlertCircle, Loader2, Cloud } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { ConflictDialog } from "./ConflictDialog";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

export function SyncIndicator() {
  const { t } = useTranslation();
  const { status, isSyncing, syncNow, fetchStatus } = useSyncStore();
  const [showConflicts, setShowConflicts] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const hasConflicts = (status?.conflict_count ?? 0) > 0;
  const isPending = (status?.outbox_count ?? 0) > 0;

  return (
    <div className="flex items-center gap-3 bg-muted/30 px-3 py-1 rounded-full border border-border/50">
      {hasConflicts && (
        <Button
          variant="destructive"
          size="sm"
          className="h-6 px-2 gap-1.5 animate-pulse rounded-full text-[10px] font-bold"
          onClick={() => setShowConflicts(true)}
        >
          <AlertCircle className="h-3 w-3" />
          <span>{status?.conflict_count} {t("sync.conflicts_label") || "Conflicts"}</span>
        </Button>
      )}

      <div className="flex items-center gap-2">
        <div className="relative">
          <Cloud className={cn(
            "h-4 w-4 transition-colors",
            isSyncing ? "text-primary" : isPending ? "text-amber-500" : "text-emerald-500"
          )} />
          {isSyncing && (
            <Loader2 className="h-4 w-4 animate-spin absolute inset-0 text-primary" />
          )}
        </div>

        <div className="flex flex-col -space-y-0.5 min-w-[70px]">
          <span className={cn(
            "text-[10px] font-bold uppercase tracking-tight leading-none transition-colors",
            isPending && !isSyncing ? "text-amber-600 animate-pulse" : ""
          )}>
            {isSyncing ? t("status.syncing") : isPending ? t("sync.pending") || "Pending" : t("sync.synced") || "Synced"}
          </span>
          <button 
            onClick={() => syncNow()}
            disabled={isSyncing || !status}
            className="text-[9px] text-muted-foreground hover:text-primary transition-colors text-left flex items-center gap-1 group disabled:opacity-50"
          >
            {isPending ? (
              <span className="font-mono tabular-nums text-amber-500/80 font-medium">
                {status?.outbox_count} {t("sync.changes") || "changes"}
              </span>
            ) : (
              <span className="opacity-70">{t("sync.up_to_date") || "Up to date"}</span>
            )}
            {!isSyncing && status && (
              <RefreshCw className={cn(
                "h-2 w-2 group-hover:rotate-180 transition-transform duration-500",
                isPending ? "text-amber-500" : "text-emerald-500"
              )} />
            )}
          </button>
        </div>
      </div>

      <ConflictDialog open={showConflicts} onOpenChange={setShowConflicts} />
    </div>
  );
}
