// Cache ket qua phan tich theo hash(snippet) qua chrome.storage.local.
// KHONG bao gio cache theo URL hoac thong tin dinh danh nguoi dung (coding-rules.md 3.4).

const CACHE_KEY_PREFIX = 'llmSafetyCache:';

class CacheStore {
  constructor({ storage = (typeof chrome !== 'undefined' ? chrome.storage.local : null), keyPrefix = CACHE_KEY_PREFIX } = {}) {
    if (!storage) {
      throw new Error('CacheStore can mot storage backend (vd chrome.storage.local hoac mock trong test)');
    }
    this.storage = storage;
    this.keyPrefix = keyPrefix;
  }

  buildStorageKey(cacheKey) {
    return this.keyPrefix + cacheKey;
  }

  async get(cacheKey) {
    const storageKey = this.buildStorageKey(cacheKey);
    const stored = await this.storage.get(storageKey);
    const entry = stored ? stored[storageKey] : null;
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      await this.storage.remove(storageKey);
      return null;
    }
    return entry.value;
  }

  async set(cacheKey, value, ttlMs) {
    const storageKey = this.buildStorageKey(cacheKey);
    const entry = {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    };
    await this.storage.set({ [storageKey]: entry });
  }
}

const cacheExports = { CacheStore, CACHE_KEY_PREFIX };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = cacheExports;
} else if (typeof globalThis !== 'undefined') {
  globalThis.SafetyExt = globalThis.SafetyExt || {};
  Object.assign(globalThis.SafetyExt, cacheExports);
}
