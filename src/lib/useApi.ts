import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type Query } from "./api";

interface State<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
}

export function useApi<T>(path: string | null, query?: Query) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: Boolean(path) });
  const [version, setVersion] = useState(0);
  const queryKey = JSON.stringify(query ?? {});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    api
      .get<T>(path, query, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const apiError =
          error instanceof ApiError ? error : new ApiError(0, "Unable to load this data.", "unknown");
        setState({ data: null, error: apiError, loading: false });
      });
    return () => controller.abort();
  }, [path, queryKey, version]);

  const refetch = useCallback(() => setVersion((value) => value + 1), []);

  return { ...state, refetch, setData: (data: T | null) => setState((prev) => ({ ...prev, data })) };
}
