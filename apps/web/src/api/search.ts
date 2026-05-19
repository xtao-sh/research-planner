// Cross-entity server-side search. Backed by GET /api/search?q=…
// fetchJson forwards RequestInit (including `signal`) to fetch, so the
// caller can pass an AbortSignal to cancel in-flight requests.
import type { SearchResults } from '@rp/shared';
import { fetchJson } from './client';

export function searchAll(q: string, signal?: AbortSignal): Promise<SearchResults> {
  return fetchJson<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`, { signal });
}
