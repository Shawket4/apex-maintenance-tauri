/**
 * Single chokepoint for `invoke` calls into the Rust core.
 *
 * Every Tauri command returns `Result<T, AppError>` on the Rust side, which
 * translates to a JS Promise that either resolves with the success payload
 * or rejects with an `{ kind, message }` object. Callers always use this
 * wrapper instead of `@tauri-apps/api/core` directly so error shapes are
 * consistent across the UI.
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export type AppErrorKind =
  | "db"
  | "pool"
  | "http"
  | "offline"
  | "auth_failed"
  | "unauthorized"
  | "keyring"
  | "io"
  | "serde"
  | "internal";

export interface AppError {
  kind: AppErrorKind;
  message: string;
}

export function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
  );
}

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

/** Converts any thrown value into a user-facing string. */
export function appErrorMessage(e: unknown): string {
  if (isAppError(e)) return e.message;
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
