import { useCallback, useEffect, useState } from "react";

interface Paged {
  items: unknown[];
  total: number;
}

/**
 * Numbered paging over an endpoint that takes (offset, limit) and answers
 * { items, total }: the current page, the rows-per-page choice and the data.
 *
 * `fetchPage` must be stable for the list being paged (wrap it in useCallback
 * keyed on its filters); a new one starts again from page 1. A page turn keeps
 * the previous rows on screen until the new ones arrive (`loading` is true in
 * between) so the list does not flash empty.
 */
export function usePagedList<R extends Paged>(
  fetchPage: (offset: number, limit: number) => Promise<R>,
  initialPageSize: number,
) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [data, setData] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  // A different list (new fetchPage) or default size starts again from page 1.
  // Done during render so no frame shows the old list under the new filters.
  const [forFetcher, setForFetcher] = useState(() => fetchPage);
  const [forSize, setForSize] = useState(initialPageSize);
  if (forFetcher !== fetchPage || forSize !== initialPageSize) {
    setForFetcher(() => fetchPage);
    setForSize(initialPageSize);
    setPage(1);
    setPageSizeState(initialPageSize);
    setData(null);
    setError(null);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    fetchPage((page - 1) * pageSize, pageSize)
      .then((result) => {
        if (cancelled) return;
        // Rows were removed while this page was open: land on the last page that exists.
        const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }
        setData(result);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load this page.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, page, pageSize, version]);

  const goToPage = useCallback((n: number) => {
    setLoading(true);
    setPage(n);
  }, []);

  const setPageSize = useCallback((n: number) => {
    setLoading(true);
    setPage(1);
    setPageSizeState(n);
  }, []);

  /// Re-reads the page on screen (after an action, or a realtime nudge).
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  return { data, error, loading, page, pageSize, total: data?.total ?? 0, goToPage, setPageSize, reload };
}
