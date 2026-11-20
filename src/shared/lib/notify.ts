import { toast } from "sonner";
import i18n from "@/shared/i18n";
import { isApiError, isOffline, isUnauthorized } from "@/shared/api/client";

/** One place errors become text a user can read, in their language.
 *
 * The Rust side sends a stable `code` for every rule it enforces and for
 * every refusal the server explains (`errors.codes.*`). Anything without a
 * code is reported generically — raw English/SQL/HTTP text never reaches the
 * screen; it goes to the console for whoever is debugging. */
export function errorText(e: unknown): string {
  if (isOffline(e)) return i18n.t("errors.offline");
  if (isUnauthorized(e)) {
    return isApiError(e) && e.kind === "auth_failed" ? i18n.t("login.wrongCredentials") : i18n.t("errors.unauthorized");
  }
  if (isApiError(e)) {
    if (e.code && i18n.exists(`errors.codes.${e.code}`)) return i18n.t(`errors.codes.${e.code}`);
    if (e.kind === "status") return i18n.t("errors.server");
  }
  return i18n.t("errors.generic");
}

/** The text for a refusal code stored in a sync issue. */
export function codeText(code: string | null | undefined): string {
  if (code && i18n.exists(`errors.codes.${code}`)) return i18n.t(`errors.codes.${code}`);
  return i18n.t("errors.generic");
}

export function notifyError(e: unknown) {
  console.error("[apex]", e);
  if (isOffline(e)) {
    toast.warning(errorText(e));
    return;
  }
  toast.error(errorText(e));
}

export function notifySuccess(message: string) {
  toast.success(message);
}
