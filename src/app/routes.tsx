/**
 * TanStack Router setup.
 *
 * Phase 2 routes:
 *   /login      → LoginPage
 *   /           → DashboardPage
 *   /vehicles   → VehiclesListPage
 *   /invoices   → InvoicesListPage
 *
 * Auth gating: a `beforeLoad` on the protected branch reads the cached user
 * via Tauri and redirects unauthenticated visitors to /login. The login page
 * does the inverse (already-logged-in users go to /).
 */

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

import { AppLayout } from "./layouts/AppLayout";
import { AuthLayout } from "./layouts/AuthLayout";
import { fetchCurrentUser } from "@/shared/api/auth";
import { LoginPage } from "@/pages/login/LoginPage";
import { DashboardPage } from "@/pages/dashboard/DashboardPage";
import { VehiclesListPage } from "@/pages/vehicles/list/VehiclesListPage";
import { InvoicesListPage } from "@/pages/invoices/list/InvoicesListPage";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: async () => {
    const user = await fetchCurrentUser();
    if (user) {
      throw redirect({ to: "/" });
    }
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
    if (!user) {
      throw redirect({ to: "/login" });
    }
    return { user };
  },
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});

const dashboardRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/",
  component: () => <DashboardPage />,
});

const vehiclesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/vehicles",
  component: () => <VehiclesListPage />,
});

const invoicesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/invoices",
  component: () => <InvoicesListPage />,
});

const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  component: () => <Navigate to="/" />,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedRoute.addChildren([dashboardRoute, vehiclesRoute, invoicesRoute]),
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
