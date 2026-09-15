/**
 * Persistent Browser CacheStorage Wrapper for Halstead Bay Assets.
 *
 * Intercepts network fetches for .glb models, .json manifests, and textures,
 * storing them in the browser's CacheStorage API.
 *
 * Benefits:
 * - 0ms network latency on subsequent loads.
 * - Completely avoids 304 HTTP round-trip overhead.
 * - Graceful fallback in environments without CacheStorage (Node.js test runners, incognito).
 */

const CACHE_NAME = 'halstead-bay-assets-v1';

export async function fetchCached(url, responseType = 'json') {
  if (typeof caches === 'undefined') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    if (responseType === 'json') return res.json();
    if (responseType === 'arrayBuffer') return res.arrayBuffer();
    if (responseType === 'blob') return res.blob();
    return res.text();
  }

  try {
    const cache = await caches.open(CACHE_NAME);
    let cached = await cache.match(url);

    if (cached) {
      if (responseType === 'json') return cached.json();
      if (responseType === 'arrayBuffer') return cached.arrayBuffer();
      if (responseType === 'blob') return cached.blob();
      return cached.text();
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);

    // Clone response before caching (streams can only be consumed once)
    try {
      cache.put(url, response.clone());
    } catch {
      /* Quota exceeded or private browsing */
    }

    if (responseType === 'json') return response.json();
    if (responseType === 'arrayBuffer') return response.arrayBuffer();
    if (responseType === 'blob') return response.blob();
    return response.text();
  } catch (err) {
    // Network or cache fallback
    const res = await fetch(url);
    if (responseType === 'json') return res.json();
    if (responseType === 'arrayBuffer') return res.arrayBuffer();
    if (responseType === 'blob') return res.blob();
    return res.text();
  }
}

/** Clear asset cache if needed */
export async function clearAssetCache() {
  if (typeof caches !== 'undefined') {
    return caches.delete(CACHE_NAME);
  }
  return false;
}
