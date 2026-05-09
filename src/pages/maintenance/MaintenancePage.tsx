/**
 * PROMPT FOR GEMINI 1.5 PRO:
 * 
 * Task: Build the Maintenance Overview Page.
 * 
 * Requirements:
 * 1. Layout: Use a Tabbed interface (from shadcn/ui) with three tabs:
 *    - "Due Soon" (قريباً): Shows vehicles needing service based on v_maintenance_due view.
 *    - "Templates" (النماذج): Management of maintenance schedules.
 *    - "History" (السجل): Recent maintenance activities.
 * 
 * 2. Due Soon Tab:
 *    - Render a grid of cards or a table showing vehicles that are 'overdue' or 'due_soon'.
 *    - Include: Vehicle Plate, Category (with icon), Status Badge (red/amber), and "Record Service" button.
 * 
 * 3. Components to use:
 *    - useQuery for v_maintenance_due (use existing invoke hooks).
 *    - Card, Tabs, Badge, Button from @/shared/ui.
 *    - RTL support (Arabic labels).
 * 
 * 4. Architecture:
 *    - This is a page component.
 *    - Use TanStack Router for sub-navigation if needed, but tabs are preferred for the main view.
 */

import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/shared/ui/card";
import { MaintenanceTemplatesPage } from "./templates/MaintenanceTemplatesPage";
import { MaintenanceRecordsPage } from "./records/MaintenanceRecordsPage";

export function MaintenancePage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("nav.maintenance")}</h1>
      </header>

      <Tabs defaultValue="due" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="due">{t("maintenance.due_soon") || "Due Soon"}</TabsTrigger>
          <TabsTrigger value="templates">{t("maintenance.templates") || "Templates"}</TabsTrigger>
          <TabsTrigger value="history">{t("maintenance.history") || "History"}</TabsTrigger>
        </TabsList>
        
        <TabsContent value="due" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("maintenance.due_soon_title") || "Vehicles Needing Service"}</CardTitle>
            </CardHeader>
            <CardContent>
              {/* GEMINI: Implement the Due Soon list here using v_maintenance_due */}
              <div className="text-center py-12 text-muted-foreground">
                Loading due maintenance...
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="mt-6">
          <MaintenanceTemplatesPage />
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <MaintenanceRecordsPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
