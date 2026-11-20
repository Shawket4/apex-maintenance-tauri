import { useEffect } from "react";
import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PageShell } from "@/widgets/layout/PageShell";
import { AboutSection } from "@/widgets/settings/AboutSection";
import { AppearanceSection } from "@/widgets/settings/AppearanceSection";
import { CatalogSection } from "@/widgets/settings/CatalogSection";
import { ClassesSection } from "@/widgets/settings/ClassesSection";
import { DataSection } from "@/widgets/settings/DataSection";
import { PlansSection } from "@/widgets/settings/PlansSection";
import { SetupChecklist } from "@/widgets/settings/SetupChecklist";
import { SyncSection } from "@/widgets/settings/SyncSection";
import { TruckClassesSection } from "@/widgets/settings/TruckClassesSection";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

/** Settings, in the order a garage needs them: what is left to set up, what
 * is happening to my work, the fleet rules (classes → trucks → plans), the
 * lists behind the dropdowns, then the rest. Each block has an anchor:
 * `#setup`, `#sync`, `#classes`, `#truck-classes`, `#plans`, `#catalog`,
 * `#data`, `#appearance`, `#about`. */
function SettingsPage() {
  const { t } = useTranslation();
  const hash = useRouterState({ select: (s) => s.location.hash });

  // The page scrolls inside the shell's <main>, and a block can sit below
  // content that is still loading when the router first tries the anchor.
  useEffect(() => {
    if (!hash) return;
    const go = () => document.getElementById(hash)?.scrollIntoView({ block: "start" });
    go();
    const later = window.setTimeout(go, 350);
    return () => window.clearTimeout(later);
  }, [hash]);

  return (
    <PageShell title={t("settings.title")}>
      <SetupChecklist />
      <SyncSection />
      <ClassesSection />
      <TruckClassesSection />
      <PlansSection />
      <CatalogSection />
      <DataSection />
      <AppearanceSection />
      <AboutSection />
    </PageShell>
  );
}
