import { useTranslation } from "react-i18next";

import { useAuth } from "@/shared/api/auth";
import { commands } from "@/shared/api/client";
import { useDomainMutation, useSyncStatus } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";

/** Correcting or joining types, and editing or removing a standard job,
 * is a supervisor's job; anyone signed in may add a job. All of it happens
 * on the server, so none of it works without a connection. */
const MANAGE_PERMISSION = 3;
const ADD_JOB_PERMISSION = 1;

export function useCatalogGate() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const sync = useSyncStatus();
  const permission = user?.permission ?? 0;
  const mayManage = permission >= MANAGE_PERMISSION;
  const mayAddJob = permission >= ADD_JOB_PERMISSION;
  // Only a known "offline" locks the buttons; while the status is still
  // loading the server is the one that answers.
  const online = sync.data?.online !== false;
  const reason = !online
    ? t("settings.catalog.gate.offline")
    : !mayManage
      ? t("settings.catalog.gate.noPermission")
      : null;
  return { mayManage, mayAddJob, online, canManage: mayManage && online, canAddJob: mayAddJob && online, reason };
}

/** A change to the lists: done on the server, then everything this device
 * holds is brought up to date (a corrected name changes the tires, stock
 * lines and oil changes that carry it) before the screens are re-read. */
export function useCatalogMutation<TArgs = void>(
  fn: (args: TArgs) => Promise<unknown>,
  onDone: (args: TArgs) => void,
) {
  return useDomainMutation(
    async (args: TArgs) => {
      await fn(args);
      // The change is already saved; a failed refresh only means the new
      // names arrive with the next automatic one.
      await commands.syncNow().catch(() => null);
    },
    { onSuccess: (_d, args) => onDone(args), onError: notifyError },
  );
}
