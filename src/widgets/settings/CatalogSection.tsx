import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useCatalog } from "@/shared/api/queries";
import { fmtNumber } from "@/shared/lib/numbers";
import { QueryState } from "@/shared/ui/query-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

import { JobsList } from "./CatalogJobs";
import { OilTypesList, TireTypesList } from "./CatalogProducts";
import { useCatalogGate } from "./catalogGate";
import { Note, SettingsCard } from "./parts";

type Tab = "tires" | "oil" | "jobs";

/** The lists behind the dropdowns: tire types, oil types and the standard
 * jobs. New types add themselves as people work; this is where a wrong
 * spelling is corrected and two entries for the same thing are joined. */
export function CatalogSection() {
  const { t, i18n } = useTranslation();
  const gate = useCatalogGate();
  const catalog = useCatalog();
  const [tab, setTab] = useState<Tab>("tires");
  const count = (v: number | undefined) => (v == null ? "" : ` (${fmtNumber(v, i18n.language)})`);
  const trigger = "min-h-10 whitespace-normal px-2 py-1.5 pointer-coarse:min-h-11";

  return (
    <SettingsCard id="catalog" title={t("settings.catalog.title")} description={t("settings.catalog.intro")}>
      {gate.reason && <Note>{gate.reason}</Note>}

      <QueryState query={catalog}>
        {(data) => (
          <Tabs dir={i18n.dir()} value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
            <TabsList className="h-auto w-full group-data-[orientation=horizontal]/tabs:h-auto">
              <TabsTrigger value="tires" className={trigger}>
                {t("settings.catalog.tabs.tires")}
                {count(data.tire_products.length)}
              </TabsTrigger>
              <TabsTrigger value="oil" className={trigger}>
                {t("settings.catalog.tabs.oil")}
                {count(data.oil_products.length)}
              </TabsTrigger>
              <TabsTrigger value="jobs" className={trigger}>
                {t("settings.catalog.tabs.jobs")}
                {count(data.standard_jobs.length)}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="tires" className="space-y-3">
              <p className="text-sm leading-6 text-muted-foreground">{t("settings.catalog.tires.intro")}</p>
              <TireTypesList rows={data.tire_products} />
            </TabsContent>
            <TabsContent value="oil" className="space-y-3">
              <p className="text-sm leading-6 text-muted-foreground">{t("settings.catalog.oil.intro")}</p>
              <OilTypesList rows={data.oil_products} />
            </TabsContent>
            <TabsContent value="jobs" className="space-y-3">
              <p className="text-sm leading-6 text-muted-foreground">{t("settings.catalog.jobs.intro")}</p>
              <JobsList rows={data.standard_jobs} />
            </TabsContent>
          </Tabs>
        )}
      </QueryState>
    </SettingsCard>
  );
}
