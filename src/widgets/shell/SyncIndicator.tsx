import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CloudOff, CloudUpload, AlertTriangle, Check } from "lucide-react";

import { useSyncStatus } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { fmtNumber } from "@/shared/lib/numbers";

/** Honest sync state: dead letters are never hidden inside the pending count.
 * Clicking lands on the diagnostics section in Settings. */
export function SyncIndicator() {
  const { t } = useTranslation();
  const { data } = useSyncStatus();
  if (!data) return null;

  const dead = data.dead > 0;
  const pending = data.pending + data.inflight;
  const offline = !data.online;

  let icon = <Check className="h-3.5 w-3.5" />;
  let label = t("sync.synced");
  let tone = "text-muted-foreground";
  if (dead) {
    icon = <AlertTriangle className="h-3.5 w-3.5" />;
    label = t("sync.dead", { count: data.dead });
    tone = "text-destructive";
  } else if (offline) {
    icon = <CloudOff className="h-3.5 w-3.5" />;
    label = t("sync.offline");
    tone = "text-status-due_soon";
  } else if (pending > 0) {
    icon = <CloudUpload className="h-3.5 w-3.5" />;
    label = t("sync.pending", { n: fmtNumber(pending) });
    tone = "text-info";
  }

  return (
    <Link
      to="/settings"
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition hover:bg-accent",
        tone,
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}
