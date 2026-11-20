import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { errorText } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";

type QueryLike<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
  isFetching?: boolean;
};

/** A failed read, said plainly, with a way to try again. */
export function ErrorState({ error, onRetry, retrying }: { error?: unknown; onRetry?: () => void; retrying?: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-soft p-6 text-center">
      <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-status-overdue" />
      <div className="text-sm font-semibold">{t("errors.loadFailed")}</div>
      {error != null && <div className="mt-1 text-xs text-muted-foreground">{errorText(error)}</div>}
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={retrying ? "animate-spin" : undefined} />
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

/** The three states every screen forgot two of: loading, failed, loaded.
 * A failed read never renders as "nothing here". */
export function QueryState<T>({
  query,
  skeleton,
  children,
}: {
  query: QueryLike<T>;
  skeleton?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isError && query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  if (query.isPending || query.data === undefined) {
    return (
      <>
        {skeleton ?? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        )}
      </>
    );
  }
  return <>{children(query.data)}</>;
}
