/**
 * Safe localStorage / sessionStorage helpers. Catch all errors (private
 * browsing, quota exceeded, parse failures) so callers don't have to.
 *
 * Usage:
 *   const value = readJson<MyType>('rp.foo', { count: 0 });
 *   writeJson('rp.foo', { count: value.count + 1 });
 */

type Storage = 'local' | 'session';

function getStore(s: Storage) {
  try {
    return s === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readString(key: string, fallback: string, store: Storage = 'local'): string {
  try {
    const v = getStore(store)?.getItem(key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeString(key: string, value: string, store: Storage = 'local'): boolean {
  try {
    getStore(store)?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readJson<T>(key: string, fallback: T, store: Storage = 'local'): T {
  try {
    const raw = getStore(store)?.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T, store: Storage = 'local'): boolean {
  try {
    getStore(store)?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string, store: Storage = 'local'): void {
  try {
    getStore(store)?.removeItem(key);
  } catch {
    /* no-op */
  }
}
