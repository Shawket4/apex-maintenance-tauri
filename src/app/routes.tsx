import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  redirect,
  RouterProvider,
} from "@tanstack/react-router";

import { MainLayout } from "./layouts/MainLayout";
import { AuthLayout } from "./layouts/AuthLayout";
import { fetchCurrentUser } from "@/shared/api/auth";
import { LoginPage } from "@/pages/login/LoginPage";
import { TrucksPage } from "@/pages/trucks/TrucksPage";
import { TruckDetailPage } from "@/pages/trucks/TruckDetailPage";
import { WorkOrderDetailPage } from "@/pages/wo/WorkOrderDetailPage";
import { DueBoardPage } from "@/pages/board/DueBoardPage";
import { InventoryPage } from "@/pages/inventory/InventoryPage";
import { SettingsPage } from "@/pages/settings/SettingsPage";
import { AiSearchPage } from "@/pages/ai/AiSearchPage";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: async () => {
    const user = await fetchCurrentUser();
    if (user) throw redirect({ to: "/" });
  },
  component: () => (
    <AuthLayout>
      <LoginPage />
    </AuthLayout>
  ),
});

const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "protected",
  beforeLoad: async () => {
    const user = await fetchCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  component: () => (
    <MainLayout>
      <Outlet />
    </MainLayout>
  ),
});

const trucksRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/", component: () => <TrucksPage /> });
const truckDetailRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/trucks/$id", component: () => <TruckDetailPage /> });
const workOrderDetailRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/wo/$id", component: () => <WorkOrderDetailPage /> });
const aiRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/ai", component: () => <AiSearchPage /> });
const dueRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/due", component: () => <DueBoardPage /> });
const inventoryRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/inventory", component: () => <InventoryPage /> });
const settingsRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/settings", component: () => <SettingsPage /> });

const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  component: () => <Navigate to="/" />,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedRoute.addChildren([
    trucksRoute,
    truckDetailRoute,
    workOrderDetailRoute,
    aiRoute,
    dueRoute,
    inventoryRoute,
    settingsRoute,
  ]),
  notFoundRoute,
]);

const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function Router() {
  return <RouterProvider router={router} />;
}
