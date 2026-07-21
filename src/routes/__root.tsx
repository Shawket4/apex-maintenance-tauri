import { createRootRoute, Outlet } from "@tanstack/react-router";

import { Toaster } from "@/shared/ui/sonner";

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster position="bottom-left" richColors />
    </>
  ),
});
