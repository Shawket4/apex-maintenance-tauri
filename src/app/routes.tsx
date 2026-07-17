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
import { DuePage } from "@/pages/due/DuePage";
import { VehicleDetailPage } from "@/pages/vehicles/detail/VehicleDetailPage";
import { TiresPage } from "@/pages/tires/TiresPage";
import { DiagnosticsPage } from "@/pages/diagnostics/DiagnosticsPage";
import { VehiclesListPage } from "@/pages/vehicles/list/VehiclesListPage";
import { ServiceInvoicesIndexPage } from "@/pages/service-invoices/index/ServiceInvoicesIndexPage";
import { ServiceInvoicesByVehiclePage } from "@/pages/service-invoices/by-vehicle/ServiceInvoicesByVehiclePage";
import { ServiceInvoiceDetailPage } from "@/pages/service-invoices/detail/ServiceInvoiceDetailPage";

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

const dueRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/",
  component: () => <DuePage />,
});

const vehicleDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/vehicles/$vehicleId",
  component: () => <VehicleDetailPage />,
});

const tiresRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/tires",
  component: () => <TiresPage />,
});

const diagnosticsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/diagnostics",
  component: () => <DiagnosticsPage />,
});

const vehiclesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/vehicles",
  component: () => <VehiclesListPage />,
});

/* ---- service invoices: vehicles → invoices → detail ---- */

const serviceInvoicesIndexRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/service-invoices",
  component: () => <ServiceInvoicesIndexPage />,
});

const serviceInvoicesByVehicleRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/service-invoices/$vehicleId",
  component: () => <ServiceInvoicesByVehiclePage />,
});

const serviceInvoiceDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/service-invoices/$vehicleId/$invoiceId",
  component: () => <ServiceInvoiceDetailPage />,
});

const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  component: () => <Navigate to="/" />,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedRoute.addChildren([
    dueRoute,
    vehicleDetailRoute,
    tiresRoute,
    diagnosticsRoute,
    vehiclesRoute,
    serviceInvoicesIndexRoute,
    serviceInvoicesByVehicleRoute,
    serviceInvoiceDetailRoute,
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
