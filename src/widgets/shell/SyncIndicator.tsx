import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CloudOff, CloudUpload, AlertTriangle, Check, KeyRound } from "lucide-react";

import { useSyncStatus } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { fmtNumber } from "@/shared/lib/numbers";

/** Honest sync state, compact for the topbar: dead letters are never hidden
 * inside the pending count. Clicking lands on diagnostics in Settings. */
export function SyncIndicator() {
  const { t, i18n } = useTranslation();
  const { data } = useSyncStatus();
  if (!data) return null;

  const dead = data.dead > 0;
  const pending = data.pending + data.inflight;
  const offline = !data.online;

  let icon = <Check className="h-3.5 w-3.5" />;
  let label = t("sync.synced");
  let tone = "text-status-ok";
  let to = "/settings";
  if (data.auth_paused) {
    // The parked queue was invisible: writes piled up while the indicator
    // said "synced" and nothing prompted a re-login.
    icon = <KeyRound className="h-3.5 w-3.5" />;
    label = t("sync.authExpired");
    tone = "text-status-overdue";
    to = "/login";
  } else if (dead) {
    icon = <AlertTriangle className="h-3.5 w-3.5" />;
    label = t("sync.dead", { count: data.dead });
    tone = "text-status-overdue";
  } else if (offline) {
    icon = <CloudOff className="h-3.5 w-3.5" />;
    label = t("sync.offline");
    tone = "text-status-due_soon";
  } else if (pending > 0) {
    icon = <CloudUpload className="h-3.5 w-3.5" />;
    label = t("sync.pending", { n: fmtNumber(pending, i18n.language) });
    tone = "text-info";
  }

  return (
    <Link
      to={to}
      className={cn(
        "flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-[11.5px] font-semibold transition hover:bg-foreground/5",
        tone,
      )}
    >
      {icon}
      <span className="max-w-44 truncate">{label}</span>
    </Link>
  );
}
