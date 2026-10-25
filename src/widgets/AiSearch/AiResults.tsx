import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ReceiptText } from "lucide-react";

import type { HistoryHit } from "@/shared/api/client";
import { hitKey, hitMeta } from "@/shared/lib/aiSearch";
import { fmtNumber } from "@/shared/lib/numbers";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent } from "@/shared/ui/card";
import { EmptyState } from "@/widgets/layout/PageShell";

function cell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** The old free-form answer: Claude's text + the rows its SQL returned. */
export function AiAnswer({ answer, rows }: { answer: string; rows: Record<string, unknown>[] }) {
  const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <p className="text-sm leading-7 whitespace-pre-wrap">{answer}</p>
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
  );
}

/** Advisor search hits, styled like the truck history timeline. */
export function AdvisorHits({
  variants,
  hits,
  locale,
}: {
  variants: string[];
  hits: HistoryHit[];
  locale: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {variants.length > 0 && (
          <>
            <span className="text-muted-foreground">{t("ai.searchedFor")}</span>
            {variants.map((v) => (
              <Badge key={v} variant="secondary" dir="auto">
                {v}
              </Badge>
            ))}
          </>
        )}
        <span className="text-muted-foreground tabular ms-auto">
          {t("ai.hitsCount", { n: fmtNumber(hits.length, locale) })}
        </span>
      </div>

      {hits.length === 0 ? (
        <EmptyState className="p-10">{t("ai.noHits")}</EmptyState>
      ) : (
        <div className="space-y-2">
          {hits.map((h, i) => {
            const meta = hitMeta(h, locale);
            const body = (
              <>
                <div className="flex min-w-0 items-start gap-3">
                  <ReceiptText className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold" dir="auto">
                      {h.service}
                    </div>
                    {h.notes && (
                      <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs" dir="auto">
                        {h.notes}
                      </div>
                    )}
                    {meta && (
                      <div className="text-muted-foreground tabular mt-1 text-xs">{meta}</div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {h.plate_number && (
                    <span className="text-sm font-bold whitespace-nowrap [word-spacing:0.12em]">
                      {h.plate_number}
                    </span>
                  )}
                  <span className="text-muted-foreground tabular text-[11px]">
                    {t("ai.invoice", { id: h.invoice_id })}
                  </span>
                </div>
              </>
            );
            const cls =
              "flex w-full items-start justify-between gap-3 rounded-xl border bg-card p-4 text-start shadow-sm";
            return h.car_id != null ? (
              <Link
                key={hitKey(h, i)}
                to="/trucks/$truckId/history"
                params={{ truckId: String(h.car_id) }}
                title={t("ai.openTruck")}
                className={`${cls} hover:border-border-strong transition hover:shadow-md`}
              >
                {body}
              </Link>
            ) : (
              <div key={hitKey(h, i)} className={cls}>
                {body}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
