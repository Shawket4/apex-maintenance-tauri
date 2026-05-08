import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ReactNode, useState } from "react";

import { env } from "@/shared/config/env";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Offline-first: don't auto-refetch on focus, the UI explicitly
            // pulls. Stale-while-revalidate is governed by cache_freshness.
            refetchOnWindowFocus: false,
            retry: (failureCount, error: unknown) => {
              // No retries on auth errors — the UI needs to react immediately.
              const kind = (error as { kind?: string } | undefined)?.kind;
              if (kind === "unauthorized" || kind === "auth_failed") return false;
              return failureCount < 2;
            },
            staleTime: 30_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      {import.meta.env.DEV && env.queryDevtools && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
