import { toast } from "sonner";
import i18n from "@/shared/i18n";
import { isApiError, isOffline, isUnauthorized } from "@/shared/api/client";

/** One place errors become user-visible text. Kinds map to i18n; anything
 * else surfaces its message so failures are never silent. */
export function notifyError(e: unknown) {
  if (isOffline(e)) {
    toast.warning(i18n.t("errors.offline"));
    return;
  }
  if (isUnauthorized(e)) {
    toast.error(i18n.t("errors.unauthorized"));
    return;
  }
  const message = isApiError(e) ? e.message : e instanceof Error ? e.message : String(e);
  toast.error(i18n.t("errors.generic", { message }));
}

export function notifySuccess(message: string) {
  toast.success(message);
}
