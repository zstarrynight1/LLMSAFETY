const {
  DailyQuotaTracker,
  ServiceWorkerController,
  getTodayKey,
  resolveProvider,
} = require('../../extension/src/background/service-worker');
const { APIRateLimitError } = require('../../extension/src/shared/utils');
const { MockProvider, AnthropicProvider } = require('../../extension/src/background/llm-client');

function createMockStorage() {
  const store = {};
  return {
    store,
    get: jest.fn(async (key) => (key in store ? { [key]: store[key] } : {})),
    set: jest.fn(async (obj) => {
      Object.assign(store, obj);
    }),
  };
}

describe('getTodayKey', () => {
  test('produces a different key for a different UTC date', () => {
    const keyA = getTodayKey(new Date('2026-06-20T10:00:00Z'));
    const keyB = getTodayKey(new Date('2026-06-21T10:00:00Z'));
    expect(keyA).not.toBe(keyB);
    expect(keyA).toBe('dailyQuota:2026-06-20');
  });
});

describe('DailyQuotaTracker', () => {
  test('isExceeded() is false when usage has not been recorded yet', async () => {
    const tracker = new DailyQuotaTracker({ storage: createMockStorage(), maxCalls: 5, maxCostUsd: 1 });
    expect(await tracker.isExceeded()).toBe(false);
  });

  test('recordUsage() accumulates calls and cost across the same day', async () => {
    const fixedNow = () => new Date('2026-06-20T12:00:00Z');
    const tracker = new DailyQuotaTracker({ storage: createMockStorage(), now: fixedNow });

    await tracker.recordUsage({ costUsd: 0.01 });
    const usage = await tracker.recordUsage({ costUsd: 0.02 });

    expect(usage).toEqual({ calls: 2, costUsd: 0.03 });
  });

  test('isExceeded() becomes true once maxCalls is reached', async () => {
    const tracker = new DailyQuotaTracker({ storage: createMockStorage(), maxCalls: 2, maxCostUsd: 100 });
    await tracker.recordUsage({ costUsd: 0 });
    await tracker.recordUsage({ costUsd: 0 });
    expect(await tracker.isExceeded()).toBe(true);
  });

  test('isExceeded() becomes true once maxCostUsd is reached', async () => {
    const tracker = new DailyQuotaTracker({ storage: createMockStorage(), maxCalls: 1000, maxCostUsd: 0.05 });
    await tracker.recordUsage({ costUsd: 0.05 });
    expect(await tracker.isExceeded()).toBe(true);
  });

  test('usage resets on a new UTC day (different storage key)', async () => {
    const storage = createMockStorage();
    let current = new Date('2026-06-20T12:00:00Z');
    const tracker = new DailyQuotaTracker({ storage, maxCalls: 1, maxCostUsd: 100, now: () => current });

    await tracker.recordUsage({ costUsd: 0 });
    expect(await tracker.isExceeded()).toBe(true);

    current = new Date('2026-06-21T00:00:01Z');
    expect(await tracker.isExceeded()).toBe(false);
  });

  test('throws when constructed without a storage backend', () => {
    expect(() => new DailyQuotaTracker({ storage: null })).toThrow();
  });
});

describe('ServiceWorkerController', () => {
  function createControllerWith({ exceeded = false, analyzeResult = { vulnerable: false } } = {}) {
    const llmClient = { analyzeCode: jest.fn(async () => analyzeResult) };
    const quotaTracker = { isExceeded: jest.fn(async () => exceeded), recordUsage: jest.fn() };
    return { controller: new ServiceWorkerController({ llmClient, quotaTracker }), llmClient, quotaTracker };
  }

  test('calls llmClient.analyzeCode and returns its result when quota is not exceeded', async () => {
    const { controller, llmClient } = createControllerWith({ analyzeResult: { vulnerable: true, cweId: 'CWE-79' } });

    const result = await controller.handleAnalyzeRequest({ codeText: '<script>', context: { language: 'html' } });

    expect(llmClient.analyzeCode).toHaveBeenCalledWith('<script>', { language: 'html' });
    expect(result).toEqual({ vulnerable: true, cweId: 'CWE-79' });
  });

  test('throws APIRateLimitError and never calls the LLM client when quota is exceeded', async () => {
    const { controller, llmClient } = createControllerWith({ exceeded: true });

    await expect(controller.handleAnalyzeRequest({ codeText: 'x', context: {} })).rejects.toThrow(APIRateLimitError);
    expect(llmClient.analyzeCode).not.toHaveBeenCalled();
  });

  test('constructor rejects missing llmClient or quotaTracker', () => {
    expect(() => new ServiceWorkerController({ quotaTracker: { isExceeded: jest.fn() } })).toThrow();
    expect(() => new ServiceWorkerController({ llmClient: { analyzeCode: jest.fn() } })).toThrow();
  });
});

describe('resolveProvider', () => {
  test('returns a MockProvider when no Anthropic API key is stored', async () => {
    const storage = { get: jest.fn(async () => ({})) };
    const provider = await resolveProvider(storage);
    expect(provider).toBeInstanceOf(MockProvider);
  });

  test('returns an AnthropicProvider using the key from chrome.storage.local when present', async () => {
    const storage = { get: jest.fn(async () => ({ anthropicApiKey: 'sk-ant-from-storage' })) };
    const provider = await resolveProvider(storage);
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.apiKey).toBe('sk-ant-from-storage');
  });
});

describe('chrome.runtime.onMessage wiring (full module bootstrap)', () => {
  let addListenerSpy;
  let registeredListener;

  beforeEach(() => {
    jest.resetModules();
    addListenerSpy = jest.fn((listener) => {
      registeredListener = listener;
    });
    global.chrome = {
      runtime: { onMessage: { addListener: addListenerSpy } },
      storage: {
        local: {
          get: jest.fn(async () => ({})),
          set: jest.fn(async () => {}),
        },
      },
    };
  });

  afterEach(() => {
    delete global.chrome;
  });

  test('registers exactly one onMessage listener on module load', () => {
    // eslint-disable-next-line global-require
    require('../../extension/src/background/service-worker');
    expect(addListenerSpy).toHaveBeenCalledTimes(1);
  });

  test('listener responds with { ok: true, result } for a valid ANALYZE_CODE_SNIPPET message', async () => {
    // eslint-disable-next-line global-require
    require('../../extension/src/background/service-worker');

    const sendResponse = jest.fn();
    const keepChannelOpen = registeredListener(
      { type: 'ANALYZE_CODE_SNIPPET', payload: { codeText: 'os.system(x)', context: { language: 'python' } } },
      {},
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, result: expect.objectContaining({ vulnerable: expect.any(Boolean) }) }),
    );
  });

  test('listener responds with { ok: false, error } and never throws for an empty codeText', async () => {
    // eslint-disable-next-line global-require
    require('../../extension/src/background/service-worker');

    const sendResponse = jest.fn();
    registeredListener({ type: 'ANALYZE_CODE_SNIPPET', payload: { codeText: '', context: {} } }, {}, sendResponse);

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.any(Object) }));
  });

  test('listener returns false (ignores) messages of an unrelated type', () => {
    // eslint-disable-next-line global-require
    require('../../extension/src/background/service-worker');
    const sendResponse = jest.fn();
    const result = registeredListener({ type: 'SOME_OTHER_MESSAGE' }, {}, sendResponse);
    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
