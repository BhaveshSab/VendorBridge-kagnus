import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ApiError, api, type Query } from "./api";

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(0, "Unable to complete this request.", "unknown");
}

/**
 * Query keys are `[apiPath, query]`, so caches are keyed by resource path and
 * can be invalidated by path prefix (e.g. everything under "/vendors").
 */
export function apiQueryKey(path: string | null, query?: Query) {
  return [path, query ?? {}] as const;
}

/** Invalidate every cached query whose API path starts with one of `prefixes`. */
export function invalidateApiPaths(queryClient: QueryClient, ...prefixes: string[]) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const root = query.queryKey[0];
      return typeof root === "string" && prefixes.some((prefix) => root.startsWith(prefix));
    },
  });
}

/**
 * Reads an API endpoint through TanStack Query: cached data, background
 * re-fetching, and race-free cancellation out of the box.
 */
export function useApi<T>(path: string | null, query?: Query) {
  const queryClient = useQueryClient();
  const queryKey = apiQueryKey(path, query);

  const { data, error, isLoading, refetch } = useQuery<T>({
    queryKey,
    enabled: Boolean(path),
    queryFn: ({ signal }) => api.get<T>(path as string, query, signal),
  });

  const refetchNow = useCallback(() => {
    void refetch();
  }, [refetch]);

  const setData = useCallback(
    (next: T | null) => {
      queryClient.setQueryData<T | null>(queryKey, next);
    },
    [queryClient, queryKey],
  );

  const apiError = error ? toApiError(error) : null;

  return {
    data: data ?? null,
    // Surface fetch errors only when there is no data to show, so a failed
    // background re-fetch never blanks out an already-rendered page.
    error: data === undefined ? apiError : null,
    loading: isLoading,
    refetch: refetchNow,
    setData,
  };
}

interface ApiMutationOptions<TData, TVariables> {
  /** API path prefixes (e.g. "/vendors") whose cached queries refresh on success. */
  invalidate?: string[];
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: ApiError, variables: TVariables) => void;
}

/**
 * Runs a write through TanStack Query, invalidating the cached reads under the
 * given API path prefixes on success (mutation invalidation).
 */
export function useApiMutation<TData = unknown, TVariables = void>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: ApiMutationOptions<TData, TVariables> = {},
) {
  const queryClient = useQueryClient();
  const { invalidate = [], onSuccess, onError } = options;

  return useMutation<TData, ApiError, TVariables>({
    mutationFn,
    onSuccess: (data, variables) => {
      if (invalidate.length > 0) void invalidateApiPaths(queryClient, ...invalidate);
      onSuccess?.(data, variables);
    },
    onError: (error, variables) => {
      onError?.(toApiError(error), variables);
    },
  });
}
