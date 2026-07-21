import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { maintApi, type AiResult } from "@/shared/api/maint";
import { appErrorMessage } from "@/shared/api/tauri";

const EXAMPLES = ["فرامل", "تنابير", "جهاز الهوا أو بلف", "تغيير كاوتش الشهر ده", "أي عربية اتعملها فتيس"];

export function AiSearchPage() {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<AiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = useMutation({
    mutationFn: (query: string) => maintApi.aiQuery(query),
    onSuccess: (r) => { setResult(r); setError(null); },
    onError: (e) => { setError(appErrorMessage(e)); setResult(null); },
  });

  const run = (query: string) => {
    if (!query.trim()) return;
    setQ(query);
    ask.mutate(query);
  };

  const cols = result?.rows?.length ? Object.keys(result.rows[0]) : [];

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">بحث ذكي في سجل الصيانة</h1>
          <p className="text-sm text-muted-foreground">اكتب أي حاجة عامة — هيدوّر على البنود المرتبطة بيها</p>
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); run(q); }}
        className="mb-4 flex gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="مثال: فرامل، تنابير، جهاز الهوا…"
          className="flex-1 rounded-xl border bg-card px-4 py-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="submit"
          disabled={ask.isPending || !q.trim()}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          بحث
        </button>
      </form>

      <div className="mb-6 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => run(ex)} className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
            {ex}
          </button>
        ))}
      </div>

      {ask.isPending && (
        <div className="flex items-center gap-2 rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> بيدوّر في السجل…
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700">
          {error.includes("ANTHROPIC") ? "ميزة البحث الذكي محتاجة مفتاح ANTHROPIC_API_KEY على السيرفر." : error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {result.answer && (
            <div className="rounded-2xl border bg-gradient-to-br from-primary/5 to-transparent p-5 leading-relaxed whitespace-pre-wrap">
              {result.answer}
            </div>
          )}
          {result.rows?.length > 0 && (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-start">
                    {cols.map((c) => (
                      <th key={c} className="p-2 text-start font-medium text-muted-foreground">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 50).map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {cols.map((c) => (
                        <td key={c} className="p-2 tabular">{String(row[c] ?? "—")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
