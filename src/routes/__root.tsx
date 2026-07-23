import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Toaster } from "@/shared/ui/sonner";

function Root() {
  const { i18n } = useTranslation();
  // The toast corner is the inline-END corner in both directions.
  const position = i18n.language.startsWith("ar") ? "bottom-left" : "bottom-right";
  return (
    <>
      <Outlet />
      <Toaster position={position} richColors />
    </>
  );
}

export const Route = createRootRoute({ component: Root });
