import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback } from "react";
import { samePlace } from "./queryClient";

export interface Loaded<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
  /**
   * Replace the loaded data here (after a successful change): the new data, or a function of the data as it is then
   * (so two changes close together both stay). Every screen showing the same key sees it, and a load still on its way
   * (which may have read the server before the change) is dropped.
   */
  setData: (next: T | ((prev: T) => T)) => void;
}

/**
 * Loads `key`'s answer with `load` when the page opens and whenever the key changes; screens with the same key share
 * one load and one copy (queryClient.ts). The key holds everything the answer depends on, as useEffect's deps would.
 */
export function useLoad<T>(key: QueryKey, load: () => Promise<T>): Loaded<T> {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: load,
    // While the next answer loads, keep showing the last one of the same place (see samePlace).
    placeholderData: (previous, previousQuery) => (previousQuery && samePlace(previousQuery.queryKey, key) ? previous : undefined),
  });
  const hash = JSON.stringify(key);
  const { refetch } = query;
  const reload = useCallback(() => void refetch(), [refetch]);
  const setData = useCallback(
    (next: T | ((prev: T) => T)) => {
      void client.cancelQueries({ queryKey: key, exact: true });
      client.setQueryData<T>(key, (prev) => (typeof next === "function" ? (prev === undefined ? prev : (next as (prev: T) => T)(prev)) : next));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, hash],
  );
  return {
    data: query.data ?? null,
    // As before: no error shown while it is asked again
    error: query.isFetching ? null : query.error,
    loading: query.isFetching || query.isPending,
    reload,
    setData,
  };
}
