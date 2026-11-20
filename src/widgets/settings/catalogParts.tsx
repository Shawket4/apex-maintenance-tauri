import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Search } from "lucide-react";

import { matches } from "@/shared/lib/normalize";
import { fmtNumber } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { Combo, type ComboOption } from "@/shared/ui/combo";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { EmptyState } from "@/widgets/layout/PageShell";

const PAGE = 20;

/** A searchable list of rows as stacked cards (no table: it has to fit a
 * phone). `text` is what the search looks in. */
export function CatalogList<T>({
  searchId,
  searchLabel,
  rows,
  rowKey,
  text,
  empty,
  children,
}: {
  searchId: string;
  searchLabel: string;
  rows: T[];
  rowKey: (row: T) => string;
  text: (row: T) => string;
  empty: React.ReactNode;
  children: (row: T) => React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;

  const typed = q.trim();
  const filtered = typed ? rows.filter((r) => matches(text(r), typed)) : rows;
  const shown = filtered.slice(0, limit);
  return (
    <div className="space-y-3">
      <div className="space-y-2 sm:max-w-sm">
        <Label htmlFor={searchId}>{searchLabel}</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={searchId}
            className="ps-9"
            dir="auto"
            inputMode="search"
            placeholder={t("settings.catalog.searchPlaceholder")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(PAGE);
            }}
          />
        </div>
      </div>
      {filtered.length === 0 ? (
        <EmptyState>
          {t("settings.catalog.noMatch")} <bdi>«{typed}»</bdi>
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-lg border">
          {shown.map((r) => (
            <li key={rowKey(r)} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              {children(r)}
            </li>
          ))}
        </ul>
      )}
      {filtered.length > shown.length && (
        <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
          {t("settings.catalog.showMore", { n: fmtNumber(filtered.length - shown.length, i18n.language) })}
        </Button>
      )}
    </div>
  );
}

/** The two lines of a row: the name, and what is known about it. */
export function RowText({ title, meta, ltr }: { title: string; meta: React.ReactNode; ltr?: boolean }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="break-words text-sm font-semibold" dir={ltr ? "ltr" : "auto"}>
        <bdi>{title}</bdi>
      </div>
      <div className="text-sm text-muted-foreground tabular">{meta}</div>
    </div>
  );
}

export function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-none flex-wrap items-center gap-2">{children}</div>;
}

/** "This is the same as another type": choose which one, then read exactly
 * what will happen before it happens. It cannot be undone, so the second
 * step is a separate question. */
export function MergeDialog({
  title,
  intro,
  pickLabel,
  pickPlaceholder,
  sourceLabel,
  options,
  confirmBody,
  pending,
  onMerge,
  onClose,
}: {
  title: string;
  intro: string;
  pickLabel: string;
  pickPlaceholder: string;
  /** The type that will disappear. */
  sourceLabel: string;
  /** Every other confirmed type; `value` is its id. */
  options: ComboOption[];
  confirmBody: (target: ComboOption) => string;
  pending: boolean;
  onMerge: (intoId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [into, setInto] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const target = options.find((o) => o.value === into) ?? null;

  if (asking && target) {
    return (
      <ConfirmDialog
        open
        onOpenChange={(o) => !o && setAsking(false)}
        title={t("settings.catalog.merge.confirmTitle")}
        description={confirmBody(target)}
        confirmLabel={t("settings.catalog.merge.confirm")}
        destructive
        pending={pending}
        onConfirm={() => onMerge(target.value)}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{intro}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p dir="auto" className="rounded-lg bg-muted px-3 py-2 text-sm font-semibold">
            <bdi>{sourceLabel}</bdi>
          </p>
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.catalog.merge.noOther")}</p>
          ) : (
            <div className="space-y-2">
              <Label id="catalog-merge-into-label">{pickLabel}</Label>
              <Combo
                aria-labelledby="catalog-merge-into-label"
                options={options}
                value={into}
                onChange={(v, o) => setInto(o ? v : null)}
                placeholder={pickPlaceholder}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={!target} onClick={() => setAsking(true)}>
            {t("settings.catalog.merge.next")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Save button of a dialog form. */
export function SaveButton({ pending, disabled }: { pending: boolean; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending && <Loader2 className="animate-spin" />}
      {t("common.save")}
    </Button>
  );
}
