/**
 * TanStack Router setup.
 *
 * Phase 1 routes:
 *   /login      → LoginPage
 *   /           → DashboardPage (placeholder)
 *
 * Auth gating: a `beforeLoad` on the protected branch reads the cached user
 * via Tauri and redirects unauthenticated visitors to /login. The login page
 * does the inverse (already-logged-in users go to /).
 *
 * Per the architecture doc §11 we'll migrate to file-based routes once the
 * route surface grows beyond a handful — the `pages/` directory is already
 * laid out so the migration is mechanical.
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

// Catch-all for any unknown path → /login (until we have more routes)
const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  component: () => <Navigate to="/login" />,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedRoute.addChildren([dashboardRoute]),
  notFoundRoute,
]);

const router = createRouter({
  routeTree,
  // Memory history keeps URLs internal to the Tauri shell so refresh & deep
  // links behave predictably without a real address bar.
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
