import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight, ReceiptText } from "lucide-react";

import type { HistoryHit } from "@/shared/api/client";
import {
  columnLabelKey,
  fmtId,
  formatCell,
  hitKey,
  hitMeta,
  plainColumnName,
  visibleColumns,
} from "@/shared/lib/aiSearch";
import { fmtNumber } from "@/shared/lib/numbers";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent } from "@/shared/ui/card";
import { EmptyState } from "@/widgets/layout/PageShell";

/** The free-form answer: the sentence, then the rows behind it as a table a
 * person can read — human column names, dates and numbers formatted, database
 * ids left out. On a phone each row is a small card. */
export function AiAnswer({ answer, rows }: { answer: string; rows: Record<string, unknown>[] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const cols = visibleColumns(rows);
  const words = { yes: t("ai.yes"), no: t("ai.no") };
  const header = (c: string) => {
    const key = columnLabelKey(c);
    return key ? t(key) : plainColumnName(c);
  };
  const isPlate = (c: string) => columnLabelKey(c) === "ai.col.plate";
  const text = answer.trim();

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {text ? (
          <p className="whitespace-pre-wrap text-base leading-8" dir="auto">
            {text}
          </p>
        ) : (
          rows.length === 0 && <p className="text-sm text-muted-foreground">{t("ai.noAnswer")}</p>
        )}
        {rows.length > 0 && cols.length > 0 && (
          <>
            <div className="text-sm font-semibold">
              {t("ai.rowsTitle", { n: fmtNumber(rows.length, locale) })}
            </div>

            {/* Phone: one card per row. */}
            <div className="space-y-2 sm:hidden">
              {rows.map((r, i) => (
                <dl key={i} className="space-y-1.5 rounded-lg border p-3 text-sm">
                  {cols.map((c) => (
                    <div key={c} className="flex items-baseline justify-between gap-3">
                      <dt className="flex-none text-muted-foreground" dir="auto">
                        {header(c)}
                      </dt>
                      <dd className="min-w-0 break-words text-end font-medium tabular" dir="auto">
                        {isPlate(c) ? <bdi>{formatCell(c, r[c], locale, words)}</bdi> : formatCell(c, r[c], locale, words)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ))}
            </div>

            {/* Wider screens: a table. */}
            <div className="hidden overflow-x-auto rounded-lg border sm:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {cols.map((c) => (
                      <th key={c} scope="col" className="px-3 py-2.5 text-start font-semibold" dir="auto">
                        {header(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      {cols.map((c) => (
                        <td key={c} className="px-3 py-2.5 align-top tabular" dir="auto">
                          {isPlate(c) ? <bdi>{formatCell(c, r[c], locale, words)}</bdi> : formatCell(c, r[c], locale, words)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Service lines found in the history. Each one opens its truck's history. */
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
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold tabular">{t("ai.hitsCount", { n: fmtNumber(hits.length, locale) })}</span>
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
      </div>

      {hits.length === 0 ? (
        <EmptyState className="p-10">{t("ai.noHits")}</EmptyState>
      ) : (
        <div className="space-y-2">
          {hits.map((h, i) => {
            const meta = hitMeta(h, locale);
            const body = (
              <>
                <ReceiptText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <div className="min-w-0 text-sm font-semibold" dir="auto">
                      {h.service || t("ai.noServiceText")}
                    </div>
                    {h.plate_number && (
                      <bdi className="whitespace-nowrap text-sm font-bold [word-spacing:0.12em]">{h.plate_number}</bdi>
                    )}
                  </div>
                  {h.notes && (
                    <div className="mt-0.5 line-clamp-3 text-sm text-muted-foreground" dir="auto">
                      {h.notes}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular">
                    {meta && <span>{meta}</span>}
                    <span>{t("ai.invoice", { id: fmtId(h.invoice_id, locale) })}</span>
                  </div>
                </div>
              </>
            );
            const cls = "flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-start shadow-sm";
            return h.car_id != null ? (
              <Link
                key={hitKey(h, i)}
                to="/trucks/$truckId/history"
                params={{ truckId: String(h.car_id) }}
                aria-label={`${h.service} — ${t("ai.openTruck")}`}
                className={`${cls} transition hover:border-border-strong hover:shadow-md`}
              >
                {body}
                <span className="flex flex-none items-center gap-0.5 self-center text-xs font-semibold text-primary">
                  <span className="hidden sm:inline">{t("ai.openTruck")}</span>
                  <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
                </span>
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
