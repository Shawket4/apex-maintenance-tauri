import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2 } from "lucide-react";

import { commands, unwrap, isApiError } from "@/shared/api/client";
import type { AiSearchResult } from "@/shared/api/client";
import { fallbackNoticeKey } from "@/shared/lib/aiSearch";
import { notifyError } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { EmptyState, PageShell } from "@/widgets/layout/PageShell";
import { AdvisorHits, AiAnswer } from "@/widgets/AiSearch/AiResults";

export const Route = createFileRoute("/_app/ai")({
  component: AiSearchPage,
});

function AiSearchPage() {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const [keyMissing, setKeyMissing] = useState(false);

  const ask = useMutation({
    // Service-history lookups → apex-rust advisor search; aggregate questions,
    // and any advisor failure / empty result → maint-rust /ai/query (Rust side).
    mutationFn: (query: string): Promise<AiSearchResult> => unwrap(commands.aiSearch(query)),
    onError: (e) => {
      if (isApiError(e) && e.message.includes("ANTHROPIC")) {
        setKeyMissing(true);
        return;
      }
      notifyError(e);
    },
  });

  const examples = [t("ai.examples.one"), t("ai.examples.two"), t("ai.examples.three")];
  const submit = (query: string) => {
    if (!query.trim() || ask.isPending) return; // Enter path has no disabled state
    setQ(query);
    setKeyMissing(false);
    ask.mutate(query);
  };

  const result = ask.data;
  const notice = result ? fallbackNoticeKey(result) : null;

  return (
    <PageShell
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          {t("ai.title")}
        </span>
      }
    >

      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit(q)}
          placeholder={t("ai.placeholder")}
          dir="auto"
          autoFocus
        />
        <Button onClick={() => submit(q)} disabled={ask.isPending || !q.trim()}>
          {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("ai.submit")}
        </Button>
      </div>

      {keyMissing && (
        <div className="rounded-xl border border-status-due_soon/40 bg-status-due_soon-soft p-4 text-sm">
          {t("ai.keyNeeded")}
        </div>
      )}

      {ask.isPending && (
        <p className="text-sm text-muted-foreground">{t("ai.thinking")}</p>
      )}

      {result?.source === "advisor" && (
        <AdvisorHits
          variants={result.variants}
          hits={result.hits}
          locale={i18n.language}
        />
      )}

      {result?.source === "ai_query" && (
        <>
          {notice && <p className="text-xs text-muted-foreground">{t(notice)}</p>}
          <AiAnswer answer={result.answer} rows={result.rows as Record<string, unknown>[]} />
        </>
      )}

      {!ask.data && !ask.isPending && (
        <EmptyState>
          <p className="mb-4 text-sm text-muted-foreground">{t("ai.empty")}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {examples.map((ex) => (
              <button
                key={ex}
                onClick={() => submit(ex)}
                className="rounded-full border bg-card px-3 py-1.5 text-xs transition hover:bg-accent"
              >
                {ex}
              </button>
            ))}
          </div>
        </EmptyState>
      )}
    </PageShell>
  );
}

