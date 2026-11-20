import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, CloudOff, CloudUpload, KeyRound, ShieldOff } from "lucide-react";

import { performLogout } from "@/shared/api/auth";
import { useSyncStatus } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { fmtNumber } from "@/shared/lib/numbers";

/** What is happening to the user's work, in one line:
 *  - the session stopped working (sign in again — a button that really does it);
 *  - changes the server refused (opens the list);
 *  - no connection (work is kept on this device);
 *  - changes still on their way;
 *  - everything sent. */
export function SyncIndicator() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data } = useSyncStatus();
  if (!data) return null;
  const n = (v: number) => fmtNumber(v, i18n.language);
  const base =
    "flex min-h-9 w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-start text-xs font-semibold transition hover:bg-foreground/5";

  if (data.auth_paused) {
    const forbidden = data.last_error === "forbidden";
    // The old link went to /login, which bounced straight back because a
    // user was still stored. Signing out first is what makes signing in work.
    // Queued work stays on this device and goes out after the next sign-in.
    return (
      <button
        type="button"
        className={cn(base, "text-status-overdue")}
        onClick={() => void performLogout().then(() => navigate({ to: "/login" }))}
      >
        {forbidden ? <ShieldOff className="h-4 w-4 flex-none" /> : <KeyRound className="h-4 w-4 flex-none" />}
        <span className="min-w-0 flex-1">{t(forbidden ? "sync.noAccess" : "sync.authExpired")}</span>
      </button>
    );
  }

  const waiting = data.pending - data.other_user_pending;
  let icon = <Check className="h-4 w-4 flex-none" />;
  let label = t("sync.synced");
  let tone = "text-status-ok";
  if (data.issues > 0) {
    icon = <AlertTriangle className="h-4 w-4 flex-none" />;
    label = t("sync.issues", { n: n(data.issues) });
    tone = "text-status-overdue";
  } else if (!data.online) {
    icon = <CloudOff className="h-4 w-4 flex-none" />;
    label = waiting > 0 ? t("sync.offlinePending", { n: n(waiting) }) : t("sync.offline");
    tone = "text-status-due_soon";
  } else if (waiting > 0) {
    icon = <CloudUpload className="h-4 w-4 flex-none" />;
    label = t("sync.pending", { n: n(waiting) });
    tone = "text-info";
  } else if (data.other_user_pending > 0) {
    icon = <CloudUpload className="h-4 w-4 flex-none" />;
    label = t("sync.otherUser", { n: n(data.other_user_pending) });
    tone = "text-status-due_soon";
  }

  return (
    <Link to="/settings" hash="sync" className={cn(base, tone)}>
      {icon}
      <span className="min-w-0 flex-1">{label}</span>
    </Link>
  );
}
