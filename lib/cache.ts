interface Entry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

/**
 * Returns cached data if still fresh, otherwise calls fn(), caches the
 * result for ttlMs milliseconds, and returns it.
 */
export async function withCache<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const entry = store.get(key) as Entry<T> | undefined;
  if (entry && entry.expiresAt > now) {
    return entry.data;
  }
  const data = await fn();
  store.set(key, { data, expiresAt: now + ttlMs });
  return data;
}
