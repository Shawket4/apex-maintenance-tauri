import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ReactNode, useState } from "react";
import { ThemeProvider } from "next-themes";

import { env } from "@/shared/config/env";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: (failureCount, error: unknown) => {
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
    <ThemeProvider
      attribute="class"
      defaultTheme={env.defaultTheme}
      enableSystem
      disableTransitionOnChange
      storageKey="apex-theme"
    >
      <QueryClientProvider client={client}>
        {children}
        {import.meta.env.DEV && env.queryDevtools && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
