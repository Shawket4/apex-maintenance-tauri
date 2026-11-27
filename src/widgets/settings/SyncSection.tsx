import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { Check, CheckCheck, Download, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";

import { useAuth } from "@/shared/api/auth";
import { commands, unwrap, type PullSummary, type SyncIssue } from "@/shared/api/client";
import {
  useCategories,
  useClasses,
  useDomainMutation,
  useOutbox,
  useSyncIssues,
  useSyncStatus,
  useTrucks,
} from "@/shared/api/queries";
import i18n from "@/shared/i18n";
import { cn } from "@/shared/lib/cn";
import { codeText, notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtKm, fmtLiters, fmtNumber } from "@/shared/lib/numbers";
import { fmtAgo, fmtCairo } from "@/shared/lib/time";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { QueryState } from "@/shared/ui/query-state";

import { changeKey, parsePayload, payloadVehicleId, shownFields, type Payload, type ShownField } from "./lib";
import { Note, SettingsCard } from "./parts";

const WHEN = "YYYY/MM/DD h:mm A";

/** Names for the ids a change carries (truck, class, maintenance type). */
function useNames() {
  const { i18n: i } = useTranslation();
  const ar = i.language.startsWith("ar");
  const trucks = useTrucks();
  const classes = useClasses();
  const categories = useCategories();
  return {
    plate: (id: number | null) => (id == null ? null : (trucks.data?.find((tr) => tr.id === id)?.plate ?? null)),
    className: (id: string) => {
      const c = classes.data?.find((x) => x.id === id);
      return c ? (ar ? c.name_ar : c.name_en || c.name_ar) : null;
    },
    categoryName: (id: string) => {
      const c = categories.data?.find((x) => x.id === id);
      return c ? (ar ? c.name_ar : c.name_en || c.name_ar) : null;
    },
  };
}
type Names = ReturnType<typeof useNames>;

/** One entered value as text, or null when it cannot be said in words (an id
 * with no name, a code with no translation) — such a field is left out. */
function fieldText(f: ShownField, entityType: string, names: Names, t: TFunction, locale: string): string | null {
  const v = f.value;
  const known = (key: string) => (i18n.exists(key) ? t(key) : null);
  switch (f.kind) {
    case "km":
      return typeof v === "number" ? fmtKm(v, locale) : null;
    case "liters":
      return typeof v === "number" ? fmtLiters(v, locale) : null;
    case "date":
      return typeof v === "string" ? fmtCairo(v, WHEN, locale) : null;
    case "bool":
      return v === true ? t("settings.value.yes") : t("settings.value.no");
    case "truck":
      return typeof v === "number" ? names.plate(v) : null;
    case "class":
      return typeof v === "string" ? names.className(v) : null;
    case "category":
      return typeof v === "string" ? names.categoryName(v) : null;
    case "reason":
      return known(`settings.reason.${String(v)}`);
    case "status":
      return entityType === "work_orders"
        ? known(`wo.status.${String(v)}`)
        : entityType === "batteries"
          ? known(`batteries.status.${String(v)}`)
          : known(`tires.status.${String(v)}`);
    default:
      return String(v);
  }
}

/** "تركيب كاوتش — ط ر ب 8351": what the change was and, if known, on which truck. */
function ChangeTitle({
  entityType,
  entityId,
  op,
  payload,
  names,
}: {
  entityType: string;
  entityId: string;
  op: string;
  payload: Payload | null;
  names: Names;
}) {
  const { t } = useTranslation();
  const plate = names.plate(payloadVehicleId(entityType, entityId, payload));
  return (
    <span className="font-semibold">
      {t(`settings.what.${changeKey(entityType, op, payload)}`)}
      {plate && (
        <>
          {" — "}
          <bdi>{plate}</bdi>
        </>
      )}
    </span>
  );
}

function IssueCard({
  issue,
  names,
  onSeen,
  marking,
  disabled,
}: {
  issue: SyncIssue;
  names: Names;
  onSeen?: () => void;
  marking: boolean;
  disabled: boolean;
}) {
  const { t, i18n: i } = useTranslation();
  const locale = i.language;
  const payload = parsePayload(issue.detail);
  const fields = shownFields(payload)
    .map((f) => ({ f, text: fieldText(f, issue.entity_type, names, t, locale) }))
    .filter((x): x is { f: ShownField; text: string } => x.text != null && x.text !== "");

  return (
    <li className={cn("rounded-lg border p-3 text-sm", issue.seen ? "bg-muted/30" : "border-status-overdue/30 bg-status-overdue-soft")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1 leading-6">
          <div>
            <ChangeTitle entityType={issue.entity_type} entityId={issue.entity_id} op={issue.op} payload={payload} names={names} />
          </div>
          <div>
            <span className="text-muted-foreground">{t("settings.sync.why")} </span>
            {issue.entity_type === "attendance_days" && issue.code === "duplicate"
              ? t("attendance.issueAlreadyMarked")
              : codeText(issue.code)}
          </div>
          <div className="text-xs text-muted-foreground tabular">
            {fmtCairo(issue.created_at, WHEN, locale)} ({fmtAgo(issue.created_at, locale)})
          </div>
        </div>
        {onSeen && (
          <Button variant="outline" className="flex-none bg-background" disabled={disabled} onClick={onSeen}>
            {marking ? <Loader2 className="animate-spin" /> : <Check />}
            {t("settings.sync.seen")}
          </Button>
        )}
      </div>
      {fields.length > 0 && (
        <details className="mt-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary">
            {t("settings.sync.whatIEntered")}
          </summary>
          <dl className="mt-1 divide-y rounded-md border bg-background">
            {fields.map(({ f, text }) => (
              <div key={f.field} className="flex items-baseline justify-between gap-4 px-3 py-2">
                <dt className="flex-none text-muted-foreground">{t(`settings.field.${f.field}`)}</dt>
                <dd className="min-w-0 break-words text-end font-medium tabular">
                  <bdi dir={f.kind === "code" ? "ltr" : undefined}>{text}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </li>
  );
}

/** What is happening to the user's work, in plain words: is there a
 * connection, when did work last go out and come in, what is still waiting,
 * and which changes were not accepted (each already undone on this device). */
export function SyncSection() {
  const { t, i18n: i } = useTranslation();
  const locale = i.language;
  const n = (v: number) => fmtNumber(v, locale);
  const { user, logout } = useAuth();
  const status = useSyncStatus();
  const issues = useSyncIssues();
  const outbox = useOutbox();
  const names = useNames();
  const [confirmResync, setConfirmResync] = useState(false);
  const [resyncResult, setResyncResult] = useState<PullSummary | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const syncNow = useDomainMutation(() => unwrap(commands.syncNow()), {
    onSuccess: (s) => {
      if (!s.online) toast.warning(t("settings.sync.nowOffline"));
      else if (s.auth_paused) return;
      else notifySuccess(s.pending - s.other_user_pending > 0 ? t("settings.sync.nowPartly") : t("settings.sync.nowDone"));
    },
    onError: notifyError,
  });
  const markSeen = useDomainMutation((id: number | null) => unwrap(commands.syncIssuesSeen(id)), {
    onError: notifyError,
  });
  const resync = useDomainMutation(() => unwrap(commands.syncResync()), {
    onSuccess: (summary) => {
      setConfirmResync(false);
      setResyncResult(summary);
    },
    onError: (e) => {
      setConfirmResync(false);
      notifyError(e);
    },
  });

  const s = status.data;
  const waiting = s ? Math.max(s.pending - s.other_user_pending, 0) : 0;
  const time = (iso: string | null) =>
    iso ? `${fmtCairo(iso, WHEN, locale)} (${fmtAgo(iso, locale)})` : t("settings.sync.never");

  return (
    <SettingsCard
      id="sync"
      title={t("settings.sync.title")}
      description={t("settings.sync.intro")}
      action={
        s && (
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold",
              s.online ? "bg-status-ok-soft text-status-ok" : "bg-status-due_soon-soft text-status-due_soon",
            )}
          >
            {s.online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            {s.online ? t("settings.sync.online") : t("settings.sync.offline")}
          </span>
        )
      }
    >
      {/* 1 — the status, in a few plain lines. */}
      <QueryState query={status}>
        {(st) => (
          <>
            {st.auth_paused && (
              <div className="flex flex-col gap-3 rounded-lg bg-status-overdue-soft px-3 py-3 text-sm text-status-overdue sm:flex-row sm:items-center sm:justify-between">
                <span className="leading-6">
                  {st.last_error === "forbidden" ? t("settings.sync.noAccess") : t("settings.sync.sessionEnded")}
                </span>
                <Button
                  variant="outline"
                  className="flex-none bg-background text-foreground"
                  disabled={signingOut}
                  onClick={() => {
                    // Signing out first is what makes signing in again work;
                    // waiting changes stay on this device and go out after.
                    setSigningOut(true);
                    void logout().finally(() => setSigningOut(false));
                  }}
                >
                  {signingOut && <Loader2 className="animate-spin" />}
                  {t("settings.sync.signInAgain")}
                </Button>
              </div>
            )}
            <dl className="divide-y rounded-lg border text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                <dt className="text-muted-foreground">{t("settings.sync.waiting")}</dt>
                <dd className={cn("font-semibold tabular", waiting > 0 && "text-info")}>
                  {waiting > 0 ? t("settings.sync.waitingCount", { n: n(waiting) }) : t("settings.sync.waitingNone")}
                </dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                <dt className="text-muted-foreground">{t("settings.sync.lastSent")}</dt>
                <dd className="font-semibold tabular">{time(st.last_push_at)}</dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                <dt className="text-muted-foreground">{t("settings.sync.lastReceived")}</dt>
                <dd className="font-semibold tabular">{time(st.last_pull_at)}</dd>
              </div>
            </dl>
            {st.other_user_pending > 0 && (
              <Note tone="warn">{t("settings.sync.otherUser", { n: n(st.other_user_pending) })}</Note>
            )}
            {!st.online && <Note>{t("settings.sync.offlineHint")}</Note>}
          </>
        )}
      </QueryState>

      {/* 3 — send and receive now. */}
      <div>
        <Button disabled={syncNow.isPending || s?.auth_paused === true} onClick={() => syncNow.mutate()}>
          {syncNow.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {t("settings.sync.now")}
        </Button>
      </div>

      {/* 2 — changes that were not accepted. */}
      <div className="space-y-3 border-t pt-4">
        <QueryState query={issues}>
          {(rows) => {
            const unseen = rows.filter((r) => !r.seen);
            const seen = rows.filter((r) => r.seen);
            const markingAll = markSeen.isPending && markSeen.variables === null;
            return (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold">
                    {t("settings.sync.issuesTitle")}
                    {unseen.length > 0 && <span className="ms-2 text-status-overdue tabular">({n(unseen.length)})</span>}
                  </h3>
                  {unseen.length > 1 && (
                    <Button variant="outline" size="sm" disabled={markSeen.isPending} onClick={() => markSeen.mutate(null)}>
                      {markingAll ? <Loader2 className="animate-spin" /> : <CheckCheck />}
                      {t("settings.sync.seenAll")}
                    </Button>
                  )}
                </div>
                {unseen.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("settings.sync.issuesNone")}</p>
                ) : (
                  <>
                    <p className="text-sm leading-6 text-muted-foreground">{t("settings.sync.issuesIntro")}</p>
                    <ul className="space-y-2">
                      {unseen.map((issue) => (
                        <IssueCard
                          key={issue.id}
                          issue={issue}
                          names={names}
                          disabled={markSeen.isPending}
                          marking={markSeen.isPending && markSeen.variables === issue.id}
                          onSeen={() => markSeen.mutate(issue.id)}
                        />
                      ))}
                    </ul>
                  </>
                )}
                {seen.length > 0 && (
                  <details>
                    <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary">
                      {t("settings.sync.seenBefore", { n: n(seen.length) })}
                    </summary>
                    <ul className="mt-1 space-y-2">
                      {seen.map((issue) => (
                        <IssueCard key={issue.id} issue={issue} names={names} disabled marking={false} />
                      ))}
                    </ul>
                  </details>
                )}
              </>
            );
          }}
        </QueryState>
      </div>

      {/* 4 — for when something looks wrong. */}
      <details className="border-t pt-2">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold">{t("settings.sync.advanced")}</summary>
        <div className="space-y-5 pt-2">
          <p className="text-sm leading-6 text-muted-foreground">{t("settings.sync.advancedIntro")}</p>

          <div className="space-y-2">
            <h3 className="text-sm font-bold">{t("settings.sync.queueTitle")}</h3>
            <QueryState query={outbox}>
              {(rows) =>
                rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("settings.sync.queueEmpty")}</p>
                ) : (
                  <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border text-sm">
                    {rows.map((r) => {
                      const payload = parsePayload(r.payload);
                      const others = r.user_id != null && user != null && r.user_id !== user.id;
                      return (
                        <li key={r.seq} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                          <span className="min-w-0">
                            <ChangeTitle entityType={r.entity_type} entityId={r.entity_id} op={r.op} payload={payload} names={names} />
                            {others && <span className="ms-2 text-xs text-status-due_soon">{t("settings.sync.queueOtherUser")}</span>}
                          </span>
                          <span className="text-xs text-muted-foreground tabular">{fmtCairo(r.enqueued_at, WHEN, locale)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )
              }
            </QueryState>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-bold">{t("settings.sync.resyncTitle")}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{t("settings.sync.resyncHint")}</p>
            <Button
              variant="outline"
              disabled={resync.isPending || s?.online !== true || s.auth_paused}
              onClick={() => setConfirmResync(true)}
            >
              {resync.isPending ? <Loader2 className="animate-spin" /> : <Download />}
              {t("settings.sync.resync")}
            </Button>
            {s?.online === false && <p className="text-sm text-muted-foreground">{t("settings.sync.resyncOffline")}</p>}
            {resyncResult && (
              <div role="status" className="rounded-lg bg-status-ok-soft px-3 py-2.5 text-sm leading-6 tabular">
                <div className="font-semibold">{t("settings.sync.resyncDone")}</div>
                <div>{t("settings.sync.resyncApplied", { n: n(resyncResult.applied) })}</div>
                <div>{t("settings.sync.resyncRemoved", { n: n(resyncResult.removed) })}</div>
                {resyncResult.held_for_local_work > 0 && (
                  <div>{t("settings.sync.resyncHeld", { n: n(resyncResult.held_for_local_work) })}</div>
                )}
                {resyncResult.errors.length > 0 && (
                  <div className="text-status-overdue">{t("settings.sync.resyncErrors", { n: n(resyncResult.errors.length) })}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </details>

      <ConfirmDialog
        open={confirmResync}
        onOpenChange={setConfirmResync}
        title={t("settings.sync.resyncConfirmTitle")}
        description={t("settings.sync.resyncConfirmBody")}
        confirmLabel={t("settings.sync.resync")}
        pending={resync.isPending}
        onConfirm={() => resync.mutate()}
      />
    </SettingsCard>
  );
}
