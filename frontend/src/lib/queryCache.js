import { useCallback, useEffect, useRef, useState } from 'react';

const cache = new Map();
const listeners = new Map();
const inFlight = new Map();

function normalizeKey(key) {
  return Array.isArray(key) ? key : [key];
}

function serialize(key) {
  return JSON.stringify(normalizeKey(key));
}

function notify(serializedKey) {
  listeners.get(serializedKey)?.forEach((listener) => listener());
}

function keyStartsWith(candidate, prefix) {
  const candidateKey = normalizeKey(candidate);
  const prefixKey = normalizeKey(prefix);
  return prefixKey.every((part, index) => candidateKey[index] === part);
}

export async function fetchQuery(key, fetcher, { force = false } = {}) {
  const serializedKey = serialize(key);
  const current = cache.get(serializedKey);
  if (!force && current && current.data !== undefined) return current.data;
  const existing = inFlight.get(serializedKey);
  if (existing) {
    if (force) existing.refreshAfterResolve = true;
    return existing.promise;
  }

  const requestState = { promise: null, refreshAfterResolve: false };
  const request = Promise.resolve().then(fetcher).then((data) => {
    cache.set(serializedKey, { key: normalizeKey(key), data, updatedAt: Date.now() });
    if (inFlight.get(serializedKey) === requestState) inFlight.delete(serializedKey);
    notify(serializedKey);
    // If invalidation happened while the request was in flight, the response
    // may reflect the pre-mutation snapshot. Re-fetch after notifying current
    // subscribers so their loading state is refreshed from the server.
    if (requestState.refreshAfterResolve && !inFlight.has(serializedKey)) {
      fetchQuery(key, fetcher, { force: true }).catch(() => {});
    }
    return data;
  }).catch((error) => {
    if (inFlight.get(serializedKey) === requestState) inFlight.delete(serializedKey);
    throw error;
  });
  requestState.promise = request;
  inFlight.set(serializedKey, requestState);
  return request;
}

export function invalidateQueries(key) {
  const prefix = normalizeKey(key);
  cache.forEach((entry, serializedKey) => {
    if (keyStartsWith(entry.key, prefix)) {
      cache.delete(serializedKey);
      notify(serializedKey);
    }
  });
  inFlight.forEach((requestState, serializedKey) => {
    if (keyStartsWith(JSON.parse(serializedKey), prefix)) requestState.refreshAfterResolve = true;
  });
}

export function clearQueryCache() {
  cache.clear();
  inFlight.clear();
  listeners.forEach((set, key) => set.forEach(() => notify(key)));
}

export function subscribeQuery(key, listener) {
  const serializedKey = serialize(key);
  if (!listeners.has(serializedKey)) listeners.set(serializedKey, new Set());
  listeners.get(serializedKey).add(listener);
  return () => {
    const set = listeners.get(serializedKey);
    set?.delete(listener);
    if (set?.size === 0) listeners.delete(serializedKey);
  };
}

export function useApiQuery(key, fetcher, { enabled = true } = {}) {
  const serializedKey = serialize(key);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [state, setState] = useState(() => {
    const current = cache.get(serializedKey);
    return { data: current?.data, loading: enabled && !current, error: null };
  });

  const load = useCallback(async (force = false) => {
    if (!enabled) return;
    setState((previous) => ({ ...previous, loading: previous.data === undefined, error: null }));
    try {
      const data = await fetchQuery(JSON.parse(serializedKey), () => fetcherRef.current(), { force });
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState((previous) => ({ ...previous, loading: false, error }));
    }
  }, [enabled, serializedKey]);

  useEffect(() => {
    if (!enabled) return undefined;
    const unsubscribe = subscribeQuery(JSON.parse(serializedKey), () => {
      load();
    });
    load();
    return unsubscribe;
  }, [enabled, load, serializedKey]);

  return { ...state, refetch: () => load(true) };
}
