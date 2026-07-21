import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import "./index.css";
import "./shared/i18n";
import { Providers } from "./app/providers";
import { routeTree } from "./routeTree.gen";

// Hash history: works identically under the vite dev server and the tauri://
// custom protocol in production builds, and gives real back/forward + linkable
// screens (the old memory history had neither).
const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

/** Keeps <html dir/lang> in sync with the active locale (RTL for Arabic). */
function DirectionSync({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();
  useEffect(() => {
    const apply = (lng: string) => {
      document.documentElement.dir = lng.startsWith("ar") ? "rtl" : "ltr";
      document.documentElement.lang = lng;
    };
    apply(i18n.language);
    i18n.on("languageChanged", apply);
    return () => i18n.off("languageChanged", apply);
  }, [i18n]);
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Providers>
      <DirectionSync>
        <RouterProvider router={router} />
      </DirectionSync>
    </Providers>
  </React.StrictMode>,
);
