// Entry point cua background service worker:
// nhan message tu content script -> kiem tra quota -> goi llm-client -> tra ket qua ve content script.
//
// Service worker MV3 co the bi browser tat bat ky luc nao - KHONG giu state quan trong
// chi trong bien JS thuong, dung MAX_DAILY_API_CALLS/COST qua chrome.storage.local (coding-rules.md 3.3).

const Modules = (() => {
  if (typeof module !== 'undefined' && module.exports) {
    // Node/Jest: moi file la 1 CommonJS module rieng.
    return {
      Utils: require('../shared/utils'),
      Constants: require('../shared/constants'),
      Cache: require('./cache'),
      LLMClientModule: require('./llm-client'),
    };
  }
  // Service worker that: 1 file duy nhat duoc khai trong manifest, phai tu importScripts
  // cac file con lai vao cung global scope.
  importScripts('../shared/constants.js', '../shared/utils.js', './cache.js', './llm-client.js');
  return {
    Utils: globalThis.SafetyExt,
    Constants: globalThis.SafetyExt,
    Cache: globalThis.SafetyExt,
    LLMClientModule: globalThis.SafetyExt,
  };
})();

const { formatErrorForLog, APIRateLimitError, getTodayKey } = Modules.Utils;
const {
  MAX_DAILY_API_CALLS,
  MAX_DAILY_COST_USD,
  DEBUG_MODE,
  ANTHROPIC_API_KEY_STORAGE_KEY,
} = Modules.Constants;
const { CacheStore } = Modules.Cache;
const { LLMClient, MockProvider, AnthropicProvider } = Modules.LLMClientModule;

// Doc API key tu chrome.storage.local (KHONG phai constants.js - coding-rules.md 4.2/3.4).
// Neu user chua luu key (qua popup), fallback ve MockProvider de extension van chay duoc
// thay vi crash - khong tu y bat user phai co key truoc khi dung thu phan con lai.
async function resolveProvider(storage) {
  const stored = await storage.get(ANTHROPIC_API_KEY_STORAGE_KEY);
  const apiKey = stored ? stored[ANTHROPIC_API_KEY_STORAGE_KEY] : null;
  if (apiKey) {
    return new AnthropicProvider({ apiKey });
  }
  return new MockProvider();
}

class DailyQuotaTracker {
  constructor({
    storage = (typeof chrome !== 'undefined' ? chrome.storage.local : null),
    maxCalls = MAX_DAILY_API_CALLS,
    maxCostUsd = MAX_DAILY_COST_USD,
    now = () => new Date(),
  } = {}) {
    if (!storage) {
      throw new Error('DailyQuotaTracker can mot storage backend (vd chrome.storage.local hoac mock trong test)');
    }
    this.storage = storage;
    this.maxCalls = maxCalls;
    this.maxCostUsd = maxCostUsd;
    this.now = now;
  }

  async getUsage() {
    const key = getTodayKey(this.now());
    const stored = await this.storage.get(key);
    return (stored && stored[key]) || { calls: 0, costUsd: 0 };
  }

  async isExceeded() {
    const usage = await this.getUsage();
    return usage.calls >= this.maxCalls || usage.costUsd >= this.maxCostUsd;
  }

  async recordUsage({ costUsd = 0 } = {}) {
    const key = getTodayKey(this.now());
    const usage = await this.getUsage();
    const updated = { calls: usage.calls + 1, costUsd: usage.costUsd + costUsd };
    await this.storage.set({ [key]: updated });
    return updated;
  }
}

class ServiceWorkerController {
  constructor({ llmClient, quotaTracker } = {}) {
    if (!llmClient || typeof llmClient.analyzeCode !== 'function') {
      throw new Error('ServiceWorkerController can mot llmClient hop le');
    }
    if (!quotaTracker || typeof quotaTracker.isExceeded !== 'function') {
      throw new Error('ServiceWorkerController can mot quotaTracker hop le');
    }
    this.llmClient = llmClient;
    this.quotaTracker = quotaTracker;
  }

  async handleAnalyzeRequest(payload) {
    const { codeText, context } = payload || {};
    const exceeded = await this.quotaTracker.isExceeded();
    if (exceeded) {
      throw new APIRateLimitError(
        'Da vuot qua gioi han goi LLM API trong ngay (MAX_DAILY_API_CALLS hoac MAX_DAILY_COST_USD).',
      );
    }
    return this.llmClient.analyzeCode(codeText, context);
  }
}

const serviceWorkerExports = {
  DailyQuotaTracker,
  ServiceWorkerController,
  getTodayKey,
  resolveProvider,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = serviceWorkerExports;
} else if (typeof globalThis !== 'undefined') {
  globalThis.SafetyExt = globalThis.SafetyExt || {};
  Object.assign(globalThis.SafetyExt, serviceWorkerExports);
}

// --- Wiring that (chi chay trong service worker that, khong chay trong Jest) ---
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'ANALYZE_CODE_SNIPPET') return false;

    // Doc lai storage + chon provider TRONG MOI message (khong cache o module scope) -
    // service worker co the bi kill/restart bat ky luc nao, va key co the vua duoc luu/doi
    // qua popup giua 2 lan goi.
    (async () => {
      const storage = chrome.storage.local;
      const quotaTracker = new DailyQuotaTracker({ storage });
      const cache = new CacheStore({ storage });
      const provider = await resolveProvider(storage);
      const llmClient = new LLMClient({
        provider,
        cache,
        debugMode: DEBUG_MODE,
        onUsage: (usage) => {
          quotaTracker.recordUsage({ costUsd: usage.costUsd || 0 }).catch((err) => {
            if (DEBUG_MODE) {
              // eslint-disable-next-line no-console
              console.error('[service-worker] khong the ghi quota:', formatErrorForLog(err));
            }
          });
        },
      });
      const controller = new ServiceWorkerController({ llmClient, quotaTracker });

      try {
        const result = await controller.handleAnalyzeRequest(message.payload);
        sendResponse({ ok: true, result });
      } catch (err) {
        if (DEBUG_MODE) {
          // eslint-disable-next-line no-console
          console.error('[service-worker] loi phan tich:', formatErrorForLog(err, { type: message.type }));
        }
        sendResponse({ ok: false, error: formatErrorForLog(err) });
      }
    })();

    return true; // giu message channel mo cho sendResponse bat dong bo
  });
}
