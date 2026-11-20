import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Info, Loader2, Search, Sparkles, X } from "lucide-react";

import { useAuth } from "@/shared/api/auth";
import { commands, unwrap, isApiError, isOffline } from "@/shared/api/client";
import type { AiSearchResult } from "@/shared/api/client";
import { useTrucks } from "@/shared/api/queries";
import { fallbackNoticeKey, isAggregateQuestion } from "@/shared/lib/aiSearch";
import { errorText } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Skeleton } from "@/shared/ui/skeleton";
import { PageShell } from "@/widgets/layout/PageShell";
import { AdvisorHits, AiAnswer } from "@/widgets/AiSearch/AiResults";
import { aiSearchKey, useAiSession } from "@/widgets/AiSearch/store";

export const Route = createFileRoute("/_app/ai")({
  component: AiSearchPage,
});

/** Counting / comparing questions go to an endpoint that needs this level. */
const AGGREGATE_PERMISSION = 3;

/** Why the search failed, as a sentence the user can act on. */
function failureText(e: unknown, t: (k: string) => string): string {
  if (isOffline(e)) return t("ai.errOffline");
  if (isApiError(e)) {
    if (e.code === "forbidden" || e.code === "no_access") return t("ai.errPermission");
    if (e.code === "unavailable") return t("ai.errNotSetUp");
    if (e.code === "too_many_requests") return t("ai.errBusy");
  }
  return errorText(e);
}

function AiSearchPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const trucks = useTrucks();
  const { draft, asked, setDraft, ask, clear } = useAiSession();

  const permission = user?.permission ?? null;
  const canAggregate = permission != null && permission >= AGGREGATE_PERMISSION;
  // A counting question from someone below the level is never sent: the
  // server would refuse it, so the screen explains instead.
  const blocked = asked != null && permission != null && !canAggregate && isAggregateQuestion(asked);

  // Keyed by the question: an answer that arrives late can only ever land
  // under its own question, and coming back to this page re-reads the cache
  // instead of asking again.
  const search = useQuery({
    queryKey: aiSearchKey(asked),
    queryFn: (): Promise<AiSearchResult> => unwrap(commands.aiSearch(asked ?? "")),
    enabled: asked != null && permission != null && !blocked,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const loading = asked != null && !blocked && (search.isFetching || (search.isPending && permission == null));
  const result = !blocked && asked != null ? search.data : undefined;
  const failed = !blocked && asked != null && search.isError && !search.isFetching;
  const notice = result ? fallbackNoticeKey(result) : null;

  const submit = (question: string) => {
    const q = question.trim();
    if (!q || loading) return;
    if (q === asked && search.isError) void search.refetch();
    else ask(q);
  };

  const plate = trucks.data?.[0]?.plate;
  const examples = [
    plate ? t("ai.examples.lastOil", { plate }) : t("ai.examples.lastOilNoPlate"),
    t("ai.examples.brakes"),
    canAggregate ? t("ai.examples.mostTires") : t("ai.examples.battery"),
  ];

  return (
    <PageShell
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 flex-none text-primary" />
          {t("ai.title")}
        </span>
      }
    >
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <Label htmlFor="ai-question">{t("ai.questionLabel")}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="ai-question"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("ai.placeholder")}
            dir="auto"
            enterKeyHint="search"
            className="h-11 text-base"
          />
          <Button type="submit" size="lg" disabled={loading || !draft.trim() || permission == null}>
            {loading ? <Loader2 className="animate-spin" /> : <Search />}
            {t("ai.submit")}
          </Button>
        </div>
      </form>

      {asked == null && (
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <div className="space-y-2">
            <h2 className="text-base font-bold">{t("ai.canAnswerTitle")}</h2>
            <ul className="list-disc space-y-1.5 ps-5 text-sm leading-7">
              <li>{t("ai.canAnswerHistory")}</li>
              <li>{t("ai.canAnswerWords")}</li>
              <li>{canAggregate ? t("ai.canAnswerCounts") : t("ai.cannotAnswerCounts")}</li>
            </ul>
            <p className="text-sm text-muted-foreground">{t("ai.needsInternet")}</p>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold">{t("ai.tryOne")}</div>
            <div className="flex flex-col gap-2">
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  disabled={permission == null}
                  onClick={() => submit(ex)}
                  className="min-h-11 rounded-lg border bg-background px-3.5 py-2.5 text-start text-sm transition hover:border-border-strong hover:bg-accent disabled:opacity-50"
                >
                  <bdi>{ex}</bdi>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {asked != null && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3.5 py-2.5">
          <div className="min-w-0 text-sm">
            <span className="text-muted-foreground">{t("ai.youAsked")} </span>
            <bdi className="font-semibold">{asked}</bdi>
          </div>
          <Button variant="outline" size="sm" onClick={clear}>
            <X />
            {loading ? t("common.cancel") : t("ai.newQuestion")}
          </Button>
        </div>
      )}

      {blocked && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-status-due_soon/40 bg-status-due_soon-soft p-4 text-sm leading-7">
          <Info className="mt-1 h-5 w-5 flex-none text-status-due_soon" />
          <div>
            <div className="font-semibold">{t("ai.blockedTitle")}</div>
            <div>{t("ai.blockedBody")}</div>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-3" aria-busy="true" role="status">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("ai.thinking")}
          </p>
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      )}

      {failed && (
        <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-soft p-5 text-sm">
          <div className="font-semibold">{t("ai.failedTitle")}</div>
          <div className="mt-1 leading-7">{failureText(search.error, t)}</div>
          <Button variant="outline" className="mt-3" onClick={() => void search.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {!loading && result?.source === "advisor" && (
        <AdvisorHits variants={result.variants} hits={result.hits} locale={i18n.language} />
      )}

      {!loading && result?.source === "ai_query" && (
        <>
          {notice && <p className="text-sm text-muted-foreground">{t(notice)}</p>}
          <AiAnswer answer={result.answer} rows={result.rows as Record<string, unknown>[]} />
        </>
      )}
    </PageShell>
  );
}
