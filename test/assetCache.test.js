import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCached, clearAssetCache } from '../src/core/assetCache.js';

test('assetCache: handles fallback environment and fetch functions', async () => {
  assert.equal(typeof fetchCached, 'function');
  assert.equal(typeof clearAssetCache, 'function');

  // Test clear cache in fallback environment
  const cleared = await clearAssetCache();
  assert.equal(cleared, false); // No window.caches in node environment
});

test('assetCache: mocks CacheStorage API when available', async () => {
  const store = new Map();
  const mockCache = {
    async match(url) {
      return store.get(url) ?? null;
    },
    async put(url, response) {
      store.set(url, response);
    },
  };

  globalThis.caches = {
    async open() {
      return mockCache;
    },
    async delete() {
      store.clear();
      return true;
    },
  };

  // Mock global fetch
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount++;
    return {
      ok: true,
      status: 200,
      clone() {
        return this;
      },
      async json() {
        return { asset: 'test', url };
      },
      async arrayBuffer() {
        return new ArrayBuffer(16);
      },
    };
  };

  try {
    // First call: misses cache, calls network fetch
    const data1 = await fetchCached('/test/model.glb', 'json');
    assert.deepEqual(data1, { asset: 'test', url: '/test/model.glb' });
    assert.equal(fetchCount, 1);

    // Second call: hits cache, does not call network fetch
    const data2 = await fetchCached('/test/model.glb', 'json');
    assert.deepEqual(data2, { asset: 'test', url: '/test/model.glb' });
    assert.equal(fetchCount, 1, 'second call should hit cache without network fetch');

    // Test clear
    const res = await clearAssetCache();
    assert.equal(res, true);
    assert.equal(store.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.caches;
  }
});
