import * as React from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Plus } from "lucide-react";

import { useCatalog, useCategories } from "@/shared/api/queries";
import { norm } from "@/shared/lib/normalize";
import { fmtLiters, fmtNumber } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { Combo, type ComboOption } from "@/shared/ui/combo";
import { Label } from "@/shared/ui/label";

/** A tire type: what is written on the sidewall. */
export interface TireSpec {
  brand: string;
  model: string;
  size: string;
}

export function tireLabel(t: { brand: string; model?: string | null; size?: string | null }): string {
  return [t.brand, t.model, t.size].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ");
}

const tireKey = (t: TireSpec) => `${norm(t.brand)}|${norm(t.model)}|${norm(t.size)}`;

/** Choose a tire type from the catalog, or describe one that is not on it.
 *
 * The list is every type the garage has ever used, searchable by brand,
 * model or size in any order. A type that is not there is entered once —
 * brand, model, size, each offering what already exists so "Pirelli" is not
 * typed three ways — and the server adds it to the catalog, so it is on the
 * list from then on. */
export function TireProductPicker({
  value,
  onChange,
  id,
  disabled,
  /** Show how many new tires of each type are in stock (fitting from stock). */
  showStock = false,
  "aria-labelledby": labelledBy,
}: {
  value: TireSpec | null;
  onChange: (v: TireSpec | null) => void;
  id?: string;
  disabled?: boolean;
  showStock?: boolean;
  "aria-labelledby"?: string;
}) {
  const { t, i18n } = useTranslation();
  const catalog = useCatalog();
  const products = React.useMemo(() => catalog.data?.tire_products ?? [], [catalog.data]);
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState<TireSpec>({ brand: "", model: "", size: "" });

  const options: ComboOption[] = React.useMemo(
    () =>
      products.map((p) => ({
        value: tireKey(p),
        label: tireLabel(p),
        description: showStock
          ? p.on_hand == null
            ? t("catalog.tire.noStock")
            : t("catalog.tire.onHand", { n: fmtNumber(p.on_hand, i18n.language) })
          : p.id == null
            ? t("catalog.tire.unconfirmed")
            : undefined,
      })),
    [products, showStock, t, i18n.language],
  );
  const distinct = (pick: (p: TireSpec) => string): ComboOption[] => {
    const seen = new Map<string, string>();
    for (const p of products) {
      const v = pick(p).trim();
      if (v && !seen.has(norm(v))) seen.set(norm(v), v);
    }
    return [...seen.values()].sort().map((v) => ({ value: v, label: v }));
  };

  if (adding) {
    const field = (key: keyof TireSpec, ph: string, opts: ComboOption[]) => (
      <div className="space-y-1.5">
        <Label id={`${id ?? "tire"}-${key}-label`}>{t(`catalog.tire.${key}`)}</Label>
        <Combo
          aria-labelledby={`${id ?? "tire"}-${key}-label`}
          options={opts}
          value={draft[key] || null}
          onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
          placeholder={ph}
          allowCustom
        />
      </div>
    );
    const ready = draft.brand.trim() !== "";
    return (
      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
        <div className="text-sm font-bold">{t("catalog.tire.newTitle")}</div>
        <p className="text-xs text-muted-foreground">{t("catalog.tire.newHint")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {field("brand", t("catalog.tire.brandPh"), distinct((p) => p.brand))}
          {field("model", t("catalog.tire.modelPh"), distinct((p) => p.model))}
          {field("size", t("catalog.tire.sizePh"), distinct((p) => p.size))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!ready}
            onClick={() => {
              const spec = { brand: draft.brand.trim(), model: draft.model.trim(), size: draft.size.trim() };
              // Already on the list under another spelling: that entry, not a twin.
              const twin = products.find((p) => tireKey(p) === tireKey(spec));
              onChange(twin ? { brand: twin.brand, model: twin.model, size: twin.size } : spec);
              setAdding(false);
            }}
          >
            {t("catalog.tire.useThis")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
            <ArrowRight className="ltr:-scale-x-100" />
            {t("catalog.tire.back")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Combo
        id={id}
        aria-labelledby={labelledBy}
        disabled={disabled}
        options={options}
        value={value ? tireKey(value) : null}
        onChange={(key) => {
          const p = products.find((x) => tireKey(x) === key);
          onChange(p ? { brand: p.brand, model: p.model, size: p.size } : null);
        }}
        placeholder={value ? tireLabel(value) : t("catalog.tire.placeholder")}
        searchPlaceholder={t("catalog.tire.search")}
      />
      <button
        type="button"
        disabled={disabled}
        className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary hover:underline disabled:opacity-50"
        onClick={() => {
          setDraft(value ?? { brand: "", model: "", size: "" });
          setAdding(true);
        }}
      >
        <Plus className="h-4 w-4" />
        {t("catalog.tire.notListed")}
      </button>
    </div>
  );
}

/** Choose an oil type; one that is not on the list can be typed and is
 * added to the catalog by the server. */
export function OilProductPicker({
  value,
  onChange,
  id,
  disabled,
  "aria-labelledby": labelledBy,
}: {
  value: string;
  onChange: (name: string) => void;
  id?: string;
  disabled?: boolean;
  "aria-labelledby"?: string;
}) {
  const { t, i18n } = useTranslation();
  const catalog = useCatalog();
  const options: ComboOption[] = (catalog.data?.oil_products ?? []).map((p) => ({
    value: p.name,
    label: p.name,
    description: p.on_hand == null ? undefined : t("catalog.oil.onHand", { n: fmtLiters(p.on_hand, i18n.language) }),
  }));
  return (
    <Combo
      id={id}
      aria-labelledby={labelledBy}
      disabled={disabled}
      options={options}
      value={value || null}
      onChange={(v, o) => onChange(o ? o.value : v.trim())}
      placeholder={t("catalog.oil.placeholder")}
      searchPlaceholder={t("catalog.oil.search")}
      allowCustom
      customLabel={(text) => t("catalog.oil.useNew", { text })}
    />
  );
}

/** What a task is: a standard job from the list (which also sets the
 * maintenance type it counts toward), or a sentence typed as it is. */
export function JobPicker({
  value,
  onChange,
  id,
  disabled,
  "aria-labelledby": labelledBy,
}: {
  value: string;
  /** `categoryId` is given only when a standard job was picked. */
  onChange: (description: string, categoryId?: string | null) => void;
  id?: string;
  disabled?: boolean;
  "aria-labelledby"?: string;
}) {
  const { t, i18n } = useTranslation();
  const catalog = useCatalog();
  const categories = useCategories();
  const ar = i18n.language.startsWith("ar");
  const catName = (cid: string | null) => {
    const c = categories.data?.find((x) => x.id === cid);
    return c ? (ar ? c.name_ar : c.name_en) : null;
  };
  const jobs = catalog.data?.standard_jobs ?? [];
  const options: ComboOption[] = jobs.map((j) => {
    const cat = catName(j.category_id);
    return {
      value: j.name_ar,
      label: ar ? j.name_ar : j.name_en || j.name_ar,
      keywords: `${j.name_ar} ${j.name_en ?? ""}`,
      description: cat ? t("catalog.job.resets", { name: cat }) : undefined,
    };
  });
  return (
    <Combo
      id={id}
      aria-labelledby={labelledBy}
      disabled={disabled}
      options={options}
      value={value || null}
      onChange={(v, o) => {
        const job = o ? jobs.find((j) => j.name_ar === o.value) : undefined;
        if (job) onChange(job.name_ar, job.category_id);
        else onChange(v.trim());
      }}
      placeholder={t("catalog.job.placeholder")}
      searchPlaceholder={t("catalog.job.search")}
      allowCustom
      customLabel={(text) => t("catalog.job.useNew", { text })}
    />
  );
}
