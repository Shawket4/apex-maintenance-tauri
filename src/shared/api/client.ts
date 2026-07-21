// The ONLY seam between React and Rust. Every call goes through the generated
// specta bindings (src/shared/api/bindings.ts) — no hand-written mirrors, no
// untyped invoke, no HTTP from the webview.
import type { CmdError, Result } from "./bindings";

export class ApiError extends Error {
  readonly kind: string;
  constructor(e: CmdError) {
    super(e.message);
    this.name = "ApiError";
    this.kind = e.kind;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** True when the failure means "no network", not "you did something wrong". */
export function isOffline(e: unknown): boolean {
  return isApiError(e) && e.kind === "offline";
}

export function isUnauthorized(e: unknown): boolean {
  return isApiError(e) && (e.kind === "unauthorized" || e.kind === "auth_failed");
}

/** Unwrap a specta Result into data-or-throw, so TanStack Query sees errors. */
export async function unwrap<T>(p: Promise<Result<T, CmdError>>): Promise<T> {
  const r = await p;
  if (r.status === "error") throw new ApiError(r.error);
  return r.data;
}

export { commands } from "./bindings";
export type * from "./bindings";
