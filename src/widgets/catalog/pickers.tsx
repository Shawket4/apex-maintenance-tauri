import * as React from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Plus } from "lucide-react";

import { useCatalog, useCategories } from "@/shared/api/queries";
import { norm } from "@/shared/lib/normalize";
import { fmtLiters, fmtNumber, parseIntInput } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { Combo, type ComboOption } from "@/shared/ui/combo";
import { Label } from "@/shared/ui/label";
import { NumberInput } from "@/shared/ui/number-input";
import {
  AH_RANGE,
  CCA_RANGE,
  VOLT_RANGE,
  batteryKey,
  batteryLabel,
  inRange,
  specOf,
  type BatterySpec,
} from "@/widgets/batteries/lib";

/** A tire type: what is written on the sidewall. */
export interface TireSpec {
  brand: string;
  model: string;
  size: string;
}

export function tireLabel(t: { brand: string; model?: string | null; size?: string | null }): string {
  return [t.brand, t.model, t.size].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ");
}

export const tireKey = (t: TireSpec) => `${norm(t.brand)}|${norm(t.model)}|${norm(t.size)}`;

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
        valueLabel={value ? tireLabel(value) : undefined}
        placeholder={t("catalog.tire.placeholder")}
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

/** Choose a battery type from the catalog, or describe one that is not on it.
 *
 * Like the tire picker: the list is every type the garage has had (search by
 * brand, model, Ah or volts); a new type is brand + model as names (offering
 * the spellings already used) and Ah / volts / CCA as numbers. The server adds
 * it to the catalog when it first arrives. */
export function BatteryProductPicker({
  value,
  onChange,
  id,
  disabled,
  /** Show how many new ones of each type are on the shelf (fitting, receiving). */
  showStock = false,
  "aria-labelledby": labelledBy,
}: {
  value: BatterySpec | null;
  onChange: (v: BatterySpec | null) => void;
  id?: string;
  disabled?: boolean;
  showStock?: boolean;
  "aria-labelledby"?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const catalog = useCatalog();
  const products = React.useMemo(() => catalog.data?.battery_products ?? [], [catalog.data]);
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState({ brand: "", model: "", ah: "", volts: "12", cca: "" });
  const [tried, setTried] = React.useState(false);
  const base = id ?? "battery";

  const options: ComboOption[] = React.useMemo(
    () =>
      products.map((p) => {
        const parts = [
          p.cca != null ? `CCA ${p.cca}` : null,
          showStock
            ? p.on_hand == null
              ? t("batteries.picker.noStock")
              : t("batteries.picker.onHand", { n: fmtNumber(p.on_hand, lang) })
            : p.id == null
              ? t("batteries.picker.unconfirmed")
              : null,
        ].filter(Boolean);
        return {
          value: batteryKey(p),
          label: batteryLabel(p),
          keywords: `${p.capacity_ah ?? ""} ${p.voltage ?? ""}`,
          description: parts.length ? parts.join(" · ") : undefined,
        };
      }),
    [products, showStock, t, lang],
  );
  const distinct = (pick: (p: { brand: string; model: string }) => string): ComboOption[] => {
    const seen = new Map<string, string>();
    for (const p of products) {
      const v = pick(p).trim();
      if (v && !seen.has(norm(v))) seen.set(norm(v), v);
    }
    return [...seen.values()].sort().map((v) => ({ value: v, label: v }));
  };

  if (adding) {
    const ah = parseIntInput(draft.ah);
    const volts = parseIntInput(draft.volts);
    const cca = parseIntInput(draft.cca);
    const bad = {
      ah: (draft.ah.trim() !== "" && ah == null) || !inRange(ah, AH_RANGE),
      volts: (draft.volts.trim() !== "" && volts == null) || !inRange(volts, VOLT_RANGE),
      cca: (draft.cca.trim() !== "" && cca == null) || !inRange(cca, CCA_RANGE),
    };
    const ready = draft.brand.trim() !== "" && !bad.ah && !bad.volts && !bad.cca;
    const name = (key: "brand" | "model", ph: string, opts: ComboOption[]) => (
      <div className="space-y-1.5">
        <Label id={`${base}-${key}-label`}>{t(`batteries.picker.${key}`)}</Label>
        <Combo
          aria-labelledby={`${base}-${key}-label`}
          options={opts}
          value={draft[key] || null}
          onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
          placeholder={ph}
          allowCustom
        />
      </div>
    );
    const number = (key: "ah" | "volts" | "cca", range: readonly [number, number]) => (
      <div className="space-y-1.5">
        <Label htmlFor={`${base}-${key}`}>{t(`batteries.picker.${key}`)}</Label>
        <NumberInput
          id={`${base}-${key}`}
          value={draft[key]}
          onValueChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
          aria-invalid={(tried && bad[key]) || undefined}
          aria-describedby={`${base}-${key}-err`}
        />
        {tried && bad[key] && (
          <p id={`${base}-${key}-err`} className="text-sm text-status-overdue">
            {t("batteries.picker.range", { lo: fmtNumber(range[0], lang), hi: fmtNumber(range[1], lang) })}
          </p>
        )}
      </div>
    );
    return (
      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
        <div className="text-sm font-bold">{t("batteries.picker.newTitle")}</div>
        <p className="text-xs text-muted-foreground">{t("batteries.picker.newHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {name("brand", t("batteries.picker.brandPh"), distinct((p) => p.brand))}
          {name("model", t("batteries.picker.modelPh"), distinct((p) => p.model))}
        </div>
        <div className="grid grid-cols-3 items-end gap-3">
          {number("ah", AH_RANGE)}
          {number("volts", VOLT_RANGE)}
          {number("cca", CCA_RANGE)}
        </div>
        {tried && !draft.brand.trim() && (
          <p role="alert" className="text-sm text-status-overdue">
            {t("batteries.picker.brandRequired")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => {
              setTried(true);
              if (!ready) return;
              const spec: BatterySpec = {
                brand: draft.brand.trim(),
                model: draft.model.trim(),
                capacity_ah: ah,
                voltage: volts,
                cca,
              };
              // Already on the list under another spelling: that entry, not a twin.
              const twin = products.find((p) => batteryKey(p) === batteryKey(spec));
              onChange(twin ? { ...specOf(twin), cca: cca ?? twin.cca } : spec);
              setAdding(false);
            }}
          >
            {t("batteries.picker.useThis")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
            <ArrowRight className="ltr:-scale-x-100" />
            {t("batteries.picker.back")}
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
        value={value ? batteryKey(value) : null}
        onChange={(key) => {
          const p = products.find((x) => batteryKey(x) === key);
          onChange(p ? specOf(p) : null);
        }}
        valueLabel={value ? batteryLabel(value) : undefined}
        placeholder={t("batteries.picker.placeholder")}
        searchPlaceholder={t("batteries.picker.search")}
      />
      <button
        type="button"
        disabled={disabled}
        className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary hover:underline disabled:opacity-50 pointer-coarse:min-h-11"
        onClick={() => {
          setDraft(
            value
              ? {
                  brand: value.brand,
                  model: value.model,
                  ah: value.capacity_ah != null ? String(value.capacity_ah) : "",
                  volts: value.voltage != null ? String(value.voltage) : "",
                  cca: value.cca != null ? String(value.cca) : "",
                }
              : { brand: "", model: "", ah: "", volts: "12", cca: "" },
          );
          setTried(false);
          setAdding(true);
        }}
      >
        <Plus className="h-4 w-4" />
        {t("batteries.picker.notListed")}
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

/** What a task is: a standard job from the list, or a sentence typed as it is.
 *
 * With a maintenance type chosen (`typeId`), only that type's jobs are listed,
 * and a typed job is kept under the type (offered next time). With none, every
 * job is listed and picking one brings its type with it. */
export function JobPicker({
  value,
  onChange,
  typeId,
  typeName,
  id,
  disabled,
  "aria-labelledby": labelledBy,
}: {
  value: string;
  /** `categoryId` is given only when a standard job was picked. */
  onChange: (description: string, categoryId?: string | null) => void;
  /** Only this type's jobs. Absent or "": every job. `null`: a type typed in
   * just now, which has no jobs yet. */
  typeId?: string | null;
  /** The chosen type's name, for the "add it to this type" row. */
  typeName?: string | null;
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
  const all = catalog.data?.standard_jobs ?? [];
  const filtered = typeId !== undefined && typeId !== "";
  const jobs = !filtered ? all : typeId === null ? [] : all.filter((j) => j.category_id === typeId);
  const options: ComboOption[] = jobs.map((j) => {
    const cat = filtered ? null : catName(j.category_id);
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
        // A job with no maintenance type leaves the chosen type alone.
        if (job) onChange(job.name_ar, job.category_id ?? undefined);
        else onChange(v.trim());
      }}
      placeholder={filtered && typeName ? t("catalog.job.placeholderOfType", { type: typeName }) : t("catalog.job.placeholder")}
      searchPlaceholder={t("catalog.job.search")}
      emptyText={filtered ? t("catalog.job.noneOfType") : undefined}
      allowCustom
      clearable
      customLabel={(text) =>
        filtered && typeName ? t("catalog.job.addToType", { text, type: typeName }) : t("catalog.job.useNew", { text })
      }
    />
  );
}
