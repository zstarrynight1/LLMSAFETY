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
      LLMProvidersModule: require('./llm-providers'),
    };
  }
  // Service worker that: 1 file duy nhat duoc khai trong manifest, phai tu importScripts
  // cac file con lai vao cung global scope.
  importScripts('../shared/constants.js', '../shared/utils.js', './cache.js', './llm-providers.js', './llm-client.js');
  return {
    Utils: globalThis.SafetyExt,
    Constants: globalThis.SafetyExt,
    Cache: globalThis.SafetyExt,
    LLMClientModule: globalThis.SafetyExt,
    LLMProvidersModule: globalThis.SafetyExt,
  };
})();

const { formatErrorForLog, APIRateLimitError, getTodayKey } = Modules.Utils;
const {
  MAX_DAILY_API_CALLS,
  MAX_DAILY_COST_USD,
  DEBUG_MODE,
  ANTHROPIC_API_KEY_STORAGE_KEY,
  EXTENSION_ENABLED_STORAGE_KEY,
} = Modules.Constants;
const { CacheStore } = Modules.Cache;
const { LLMClient } = Modules.LLMClientModule;
const { MockProvider, AnthropicProvider } = Modules.LLMProvidersModule;

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

// Toggle "bat/tat" trong popup ghi vao day - PHAI doc lai o day truoc khi phan tich, neu khong
// toggle chi doi UI ma khong co tac dung thuc te (popup va service-worker phai dung chung 1 key).
async function isExtensionEnabled(storage) {
  const stored = await storage.get(EXTENSION_ENABLED_STORAGE_KEY);
  if (stored && EXTENSION_ENABLED_STORAGE_KEY in stored) {
    return Boolean(stored[EXTENSION_ENABLED_STORAGE_KEY]);
  }
  return true; // mac dinh bat, giong popup.js
}

// Lock trong bo nho (promise chain) de serialize cac thao tac doc-sua-ghi tren quota qua
// chrome.storage.local. Service worker JS la single-threaded, nhung nhieu message
// (vd nhieu code block tren 1 trang) deu spawn 1 async handler rieng khong cho nhau - giua
// 1 lan "await storage.get" va "await storage.set" co the co handler khac xen vao doc cung
// gia tri cu (TOCTOU), khien quota bi vuot. Lock nay ep moi thao tac quota chay tuan tu.
let quotaLockChain = Promise.resolve();
function withQuotaLock(fn) {
  const run = quotaLockChain.then(fn, fn);
  quotaLockChain = run.then(() => {}, () => {});
  return run;
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

  // Check-and-increment ATOMIC (qua withQuotaLock) - goi NGAY TRUOC 1 lan goi API that (xem
  // LLMClient.beforeProviderCall trong llm-client.js). Tra ve false neu da vuot quota - khong
  // tang calls trong truong hop do. Chi tang "calls", chua biet costUsd that (xem addCost()).
  async reserveCall() {
    return withQuotaLock(async () => {
      const usage = await this.getUsage();
      if (usage.calls >= this.maxCalls || usage.costUsd >= this.maxCostUsd) {
        return false;
      }
      const key = getTodayKey(this.now());
      await this.storage.set({ [key]: { calls: usage.calls + 1, costUsd: usage.costUsd } });
      return true;
    });
  }

  // Cong don chi phi THAT sau khi 1 lan goi API thanh cong (qua onUsage callback cua LLMClient).
  // Tach rieng khoi reserveCall() vi tai thoi diem reserve chua biet costUsd chinh xac.
  async addCost(costUsd) {
    if (!costUsd) return;
    return withQuotaLock(async () => {
      const usage = await this.getUsage();
      const key = getTodayKey(this.now());
      await this.storage.set({ [key]: { calls: usage.calls, costUsd: usage.costUsd + costUsd } });
    });
  }
}

class ServiceWorkerController {
  // Quota gio duoc gate ben trong LLMClient (qua beforeProviderCall, xem wiring ben duoi) -
  // chi gate dung luc sap goi API that, khong chan nham cache hit (fix loi thu tu cu).
  // Controller chi con trach nhiem: kiem tra extensionEnabled roi giao cho llmClient.
  constructor({ llmClient, isEnabledFn = async () => true } = {}) {
    if (!llmClient || typeof llmClient.analyzeCode !== 'function') {
      throw new Error('ServiceWorkerController can mot llmClient hop le');
    }
    this.llmClient = llmClient;
    this.isEnabledFn = isEnabledFn;
  }

  async handleAnalyzeRequest(payload) {
    const enabled = await this.isEnabledFn();
    if (!enabled) {
      throw new Error('Extension dang tat (xem popup) - khong phan tich code snippet.');
    }
    const { codeText, context } = payload || {};
    return this.llmClient.analyzeCode(codeText, context);
  }
}

const serviceWorkerExports = {
  DailyQuotaTracker,
  ServiceWorkerController,
  getTodayKey,
  resolveProvider,
  isExtensionEnabled,
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
        // Gate quota dung luc sap goi API that (sau khi LLMClient da xac nhan cache MISS) -
        // qua reserveCall() atomic (xem withQuotaLock o tren), tranh TOCTOU khi nhieu code
        // block tren cung 1 trang gui message gan nhu dong thoi.
        beforeProviderCall: async () => {
          const allowed = await quotaTracker.reserveCall();
          if (!allowed) {
            throw new APIRateLimitError(
              'Da vuot qua gioi han goi LLM API trong ngay (MAX_DAILY_API_CALLS hoac MAX_DAILY_COST_USD).',
            );
          }
        },
        onUsage: (usage) => {
          quotaTracker.addCost(usage.costUsd || 0).catch((err) => {
            if (DEBUG_MODE) {
              // eslint-disable-next-line no-console
              console.error('[service-worker] khong the ghi quota:', formatErrorForLog(err));
            }
          });
        },
      });
      const controller = new ServiceWorkerController({
        llmClient,
        isEnabledFn: () => isExtensionEnabled(storage),
      });

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
