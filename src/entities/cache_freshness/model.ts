export interface CacheFreshnessRow {
  cache_name: string;
  fetched_at: string;
  ttl_seconds: number;
  is_stale: boolean;
}
