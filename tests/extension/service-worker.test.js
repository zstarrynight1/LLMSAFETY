const {
  DailyQuotaTracker,
  ServiceWorkerController,
  getTodayKey,
  resolveProvider,
  isExtensionEnabled,
} = require('../../extension/src/background/service-worker');
const { MockProvider, AnthropicProvider } = require('../../extension/src/background/llm-providers');

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

  test('reserveCall() increments calls and returns true when under quota', async () => {
    const fixedNow = () => new Date('2026-06-20T12:00:00Z');
    const tracker = new DailyQuotaTracker({ storage: createMockStorage(), now: fixedNow, maxCalls: 5, maxCostUsd: 1 });

    const allowed = await tracker.reserveCall();
    const usage = await tracker.getUsage();

    expect(allowed).toBe(true);
    expect(usage).toEqual({ calls: 1, costUsd: 0 });
  });

  test('reserveCall() returns false and does not increment once maxCalls is reached', async () => {
    const tracker = new DailyQuotaTracker({ storage: createMockStorage(), maxCalls: 1, maxCostUsd: 100 });

    expect(await tracker.reserveCall()).toBe(true);
    expect(await tracker.reserveCall()).toBe(false);

    const usage = await tracker.getUsage();
    expect(usage.calls).toBe(1); // lan reserve thu 2 bi tu choi, khong tang them
  });

  test('reserveCall() returns false once maxCostUsd is already reached', async () => {
    const storage = createMockStorage();
    const tracker = new DailyQuotaTracker({ storage, maxCalls: 1000, maxCostUsd: 0.05 });
    await tracker.addCost(0.05);

    expect(await tracker.reserveCall()).toBe(false);
  });

  test('addCost() accumulates cost without touching calls', async () => {
    const tracker = new DailyQuotaTracker({ storage: createMockStorage() });
    await tracker.reserveCall();
    await tracker.addCost(0.01);
    await tracker.addCost(0.02);

    const usage = await tracker.getUsage();
    expect(usage).toEqual({ calls: 1, costUsd: 0.03 });
  });

  test('addCost(0) is a no-op (does not write to storage)', async () => {
    const storage = createMockStorage();
    const tracker = new DailyQuotaTracker({ storage });
    await tracker.addCost(0);
    expect(storage.set).not.toHaveBeenCalled();
  });

  test('reserveCall() is atomic under concurrent calls (no TOCTOU race past maxCalls)', async () => {
    // Mo phong nhieu code block tren 1 trang gui message gan nhu dong thoi (vd detector.js
    // forEach qua N code block, moi cai goi chrome.runtime.sendMessage rieng) - tat ca cung
    // goi reserveCall() truoc khi handler nao kip ghi lai storage.
    const storage = createMockStorage();
    const tracker = new DailyQuotaTracker({ storage, maxCalls: 5, maxCostUsd: 100 });

    const results = await Promise.all(Array.from({ length: 10 }, () => tracker.reserveCall()));

    const allowedCount = results.filter(Boolean).length;
    expect(allowedCount).toBe(5); // dung 5/10 duoc chap nhan, khong vuot maxCalls
    const usage = await tracker.getUsage();
    expect(usage.calls).toBe(5);
  });

  test('usage resets on a new UTC day (different storage key)', async () => {
    const storage = createMockStorage();
    let current = new Date('2026-06-20T12:00:00Z');
    const tracker = new DailyQuotaTracker({ storage, maxCalls: 1, maxCostUsd: 100, now: () => current });

    await tracker.reserveCall();
    expect(await tracker.isExceeded()).toBe(true);

    current = new Date('2026-06-21T00:00:01Z');
    expect(await tracker.isExceeded()).toBe(false);
  });

  test('throws when constructed without a storage backend', () => {
    expect(() => new DailyQuotaTracker({ storage: null })).toThrow();
  });
});

describe('isExtensionEnabled', () => {
  test('defaults to true when never set', async () => {
    const storage = { get: jest.fn(async () => ({})) };
    expect(await isExtensionEnabled(storage)).toBe(true);
  });

  test('returns false when explicitly disabled in storage', async () => {
    const storage = { get: jest.fn(async () => ({ extensionEnabled: false })) };
    expect(await isExtensionEnabled(storage)).toBe(false);
  });

  test('returns true when explicitly enabled in storage', async () => {
    const storage = { get: jest.fn(async () => ({ extensionEnabled: true })) };
    expect(await isExtensionEnabled(storage)).toBe(true);
  });
});

describe('ServiceWorkerController', () => {
  function createControllerWith({ enabled = true, analyzeResult = { vulnerable: false } } = {}) {
    const llmClient = { analyzeCode: jest.fn(async () => analyzeResult) };
    const isEnabledFn = jest.fn(async () => enabled);
    return { controller: new ServiceWorkerController({ llmClient, isEnabledFn }), llmClient, isEnabledFn };
  }

  test('calls llmClient.analyzeCode and returns its result when extension is enabled', async () => {
    const { controller, llmClient } = createControllerWith({ analyzeResult: { vulnerable: true, cweId: 'CWE-79' } });

    const result = await controller.handleAnalyzeRequest({ codeText: '<script>', context: { language: 'html' } });

    expect(llmClient.analyzeCode).toHaveBeenCalledWith('<script>', { language: 'html' });
    expect(result).toEqual({ vulnerable: true, cweId: 'CWE-79' });
  });

  test('throws and never calls the LLM client when extension is disabled', async () => {
    const { controller, llmClient } = createControllerWith({ enabled: false });

    await expect(controller.handleAnalyzeRequest({ codeText: 'x', context: {} })).rejects.toThrow();
    expect(llmClient.analyzeCode).not.toHaveBeenCalled();
  });

  test('defaults to enabled when isEnabledFn is not provided', async () => {
    const llmClient = { analyzeCode: jest.fn(async () => ({ vulnerable: false })) };
    const controller = new ServiceWorkerController({ llmClient });
    await expect(controller.handleAnalyzeRequest({ codeText: 'x', context: {} })).resolves.toEqual({ vulnerable: false });
  });

  test('constructor rejects missing llmClient', () => {
    expect(() => new ServiceWorkerController({})).toThrow();
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

// So vong await trong chain that su (resolveProvider -> reserveCall qua withQuotaLock ->
// provider.analyze -> onUsage -> addCost qua withQuotaLock) khong co dinh - dem tick co dinh
// (vd 2x setImmediate) la flaky. Poll toi khi sendResponse duoc goi thay vi doan so tick.
function waitForSendResponse(sendResponse, { timeoutMs = 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (sendResponse.mock.calls.length > 0) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitForSendResponse: timeout cho sendResponse duoc goi'));
        return;
      }
      setImmediate(check);
    };
    check();
  });
}

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
    await waitForSendResponse(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, result: expect.objectContaining({ vulnerable: expect.any(Boolean) }) }),
    );
  });

  test('listener responds with { ok: false, error } and never throws for an empty codeText', async () => {
    // eslint-disable-next-line global-require
    require('../../extension/src/background/service-worker');

    const sendResponse = jest.fn();
    registeredListener({ type: 'ANALYZE_CODE_SNIPPET', payload: { codeText: '', context: {} } }, {}, sendResponse);

    await waitForSendResponse(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.any(Object) }));
  });

  test('listener responds with { ok: false } and does not call analyzeCode when extension is disabled', async () => {
    global.chrome.storage.local.get = jest.fn(async (key) => (key === 'extensionEnabled' ? { extensionEnabled: false } : {}));
    // eslint-disable-next-line global-require
    require('../../extension/src/background/service-worker');

    const sendResponse = jest.fn();
    registeredListener(
      { type: 'ANALYZE_CODE_SNIPPET', payload: { codeText: 'os.system(x)', context: {} } },
      {},
      sendResponse,
    );

    await waitForSendResponse(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
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
