import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2 } from "lucide-react";

import { commands, unwrap, isApiError } from "@/shared/api/client";
import { notifyError } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Card, CardContent } from "@/shared/ui/card";
import { EmptyState, PageShell } from "@/widgets/layout/PageShell";

export const Route = createFileRoute("/_app/ai")({
  component: AiSearchPage,
});

interface AiResult {
  answer: string;
  rows: Record<string, unknown>[];
}

function cell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return typeof v === "string" ? v : JSON.stringify(v);
}

function AiSearchPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [keyMissing, setKeyMissing] = useState(false);

  const ask = useMutation({
    mutationFn: (query: string) => unwrap(commands.aiQuery(query)) as unknown as Promise<AiResult>,
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
    if (!query.trim()) return;
    setQ(query);
    setKeyMissing(false);
    ask.mutate(query);
  };

  const rows = ask.data?.rows ?? [];
  const cols = rows.length > 0 ? Object.keys(rows[0]) : [];

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

      {ask.data && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="whitespace-pre-wrap text-sm leading-7">{ask.data.answer}</p>
            {rows.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {cols.map((c) => (
                        <th key={c} className="px-3 py-2 text-start font-medium" dir="ltr">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t">
                        {cols.map((c) => (
                          <td key={c} className="px-3 py-2" dir="auto">
                            {cell(r[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
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
