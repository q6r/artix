"use client";

// Tiny SWR-style data layer. Solves three problems at once:
//  - in-flight dedup: concurrent (incl. StrictMode's double-invoke) requests for
//    the same key share ONE network call;
//  - cache + dedupe window: navigating between pages within the window reuses the
//    cached data instead of refetching;
//  - revalidation: optional interval refresh, and `mutate(key)` after writes.
//
// The cache key IS the API path, so `useQuery<T>("servers")` fetches `/api/servers`.

import { useEffect, useState } from "react";
import { api } from "./client";

type Entry = {
  data?: unknown;
  error?: unknown;
  promise?: Promise<unknown>;
  ts: number;
};

const cache = new Map<string, Entry>();
const subscribers = new Map<string, Set<() => void>>();

function emit(key: string) {
  subscribers.get(key)?.forEach((fn) => fn());
}

/** Optimistically set a key's cached value (e.g. the user after login). */
export function writeCache(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
  emit(key);
}

function revalidate(key: string): Promise<unknown> {
  const current = cache.get(key);
  if (current?.promise) return current.promise; // dedup in-flight

  const promise = api(key)
    .then((data) => {
      cache.set(key, { data, ts: Date.now() });
      emit(key);
      return data;
    })
    .catch((error) => {
      const prev = cache.get(key);
      cache.set(key, { data: prev?.data, error, ts: Date.now() });
      emit(key);
      throw error;
    });

  cache.set(key, { ...(current ?? { ts: 0 }), promise });
  return promise;
}

/** Invalidate a key and refetch it (call after a mutation). */
export function mutate(key: string): Promise<unknown> {
  const current = cache.get(key);
  if (current) cache.set(key, { ...current, ts: 0, promise: undefined });
  return revalidate(key).catch(() => undefined);
}

export type QueryResult<T> = {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refetch: () => Promise<unknown>;
};

export function useQuery<T>(
  key: string | null,
  opts?: { refreshInterval?: number },
): QueryResult<T> {
  const [, force] = useState(0);
  const interval = opts?.refreshInterval ?? 0;

  useEffect(() => {
    if (!key) return;
    let set = subscribers.get(key);
    if (!set) {
      set = new Set();
      subscribers.set(key, set);
    }
    const cb = () => force((x) => x + 1);
    set.add(cb);

    // Cache-first: only hit the network when we have neither data nor an
    // in-flight request. Navigating back to a cached page does NOT refetch
    // (use `mutate(key)` after writes, or `refreshInterval` to rotate). The
    // in-flight dedup also collapses StrictMode's double-invoke into one call.
    const entry = cache.get(key);
    const hasData = entry && entry.data !== undefined;
    if (!hasData && !entry?.promise) void revalidate(key).catch(() => undefined);

    let timer: ReturnType<typeof setInterval> | undefined;
    if (interval > 0) {
      timer = setInterval(() => void revalidate(key).catch(() => undefined), interval);
    }

    return () => {
      set?.delete(cb);
      if (timer) clearInterval(timer);
    };
  }, [key, interval]);

  const entry = key ? cache.get(key) : undefined;
  const data = entry?.data as T | undefined;
  return {
    data,
    error: entry?.error,
    loading: data === undefined && entry?.error === undefined,
    refetch: () => (key ? revalidate(key) : Promise.resolve(undefined)),
  };
}
