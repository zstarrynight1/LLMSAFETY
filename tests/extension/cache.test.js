const { CacheStore, CACHE_KEY_PREFIX } = require('../../extension/src/background/cache');

function createMockStorage() {
  const store = {};
  return {
    store,
    get: jest.fn(async (key) => (key in store ? { [key]: store[key] } : {})),
    set: jest.fn(async (obj) => {
      Object.assign(store, obj);
    }),
    remove: jest.fn(async (key) => {
      delete store[key];
    }),
  };
}

describe('CacheStore', () => {
  test('throws when constructed without a storage backend', () => {
    expect(() => new CacheStore({ storage: null })).toThrow();
  });

  test('get() returns null for a key that was never set', async () => {
    const cache = new CacheStore({ storage: createMockStorage() });
    expect(await cache.get('missing-hash')).toBeNull();
  });

  test('set() then get() returns the stored value', async () => {
    const cache = new CacheStore({ storage: createMockStorage() });
    await cache.set('hash-abc', { vulnerable: true, cweId: 'CWE-89' });
    expect(await cache.get('hash-abc')).toEqual({ vulnerable: true, cweId: 'CWE-89' });
  });

  test('cache key is namespaced by CACHE_KEY_PREFIX and contains only the hash, never a URL', async () => {
    const storage = createMockStorage();
    const cache = new CacheStore({ storage });
    await cache.set('hash-xyz', { vulnerable: false });

    const storageKeys = Object.keys(storage.store);
    expect(storageKeys).toEqual([`${CACHE_KEY_PREFIX}hash-xyz`]);
    expect(storageKeys[0]).not.toMatch(/https?:\/\//);
  });

  test('entry expires after ttlMs and get() removes it', async () => {
    const storage = createMockStorage();
    const cache = new CacheStore({ storage });
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;

    await cache.set('hash-ttl', { vulnerable: false }, 1000);
    expect(await cache.get('hash-ttl')).toEqual({ vulnerable: false });

    now += 1001;
    expect(await cache.get('hash-ttl')).toBeNull();
    expect(storage.remove).toHaveBeenCalledWith(`${CACHE_KEY_PREFIX}hash-ttl`);

    Date.now = realNow;
  });

  test('entry with no ttlMs never expires', async () => {
    const storage = createMockStorage();
    const cache = new CacheStore({ storage });
    await cache.set('hash-persistent', { vulnerable: false });
    expect(await cache.get('hash-persistent')).toEqual({ vulnerable: false });
  });
});
