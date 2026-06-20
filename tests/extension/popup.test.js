/**
 * @jest-environment jsdom
 */

const { PopupController, renderPopup, bootstrapPopup } = require('../../extension/src/popup/popup');

function createMockStorage(initial = {}) {
  const store = { ...initial };
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

function buildPopupDom() {
  document.body.innerHTML = `
    <section id="privacy-notice" hidden>
      <button id="accept-privacy-btn" type="button">Toi dong y</button>
    </section>
    <section id="main-view" hidden>
      <input id="enabled-toggle" type="checkbox" />
      <span id="usage-calls">0</span>
      <span id="usage-cost">0.0000</span>
      <p id="api-key-status"></p>
      <input id="api-key-input" type="password" />
      <button id="api-key-save-btn" type="button">Luu key</button>
    </section>
  `;
}

describe('PopupController', () => {
  test('isPrivacyAccepted() is false before acceptPrivacyNotice() is called', async () => {
    const controller = new PopupController({ storage: createMockStorage() });
    expect(await controller.isPrivacyAccepted()).toBe(false);
    await controller.acceptPrivacyNotice();
    expect(await controller.isPrivacyAccepted()).toBe(true);
  });

  test('isExtensionEnabled() defaults to true when never set', async () => {
    const controller = new PopupController({ storage: createMockStorage() });
    expect(await controller.isExtensionEnabled()).toBe(true);
  });

  test('setExtensionEnabled(false) persists and is read back', async () => {
    const controller = new PopupController({ storage: createMockStorage() });
    await controller.setExtensionEnabled(false);
    expect(await controller.isExtensionEnabled()).toBe(false);
  });

  test('getTodayUsage() returns zeroed usage when nothing recorded yet', async () => {
    const controller = new PopupController({ storage: createMockStorage(), now: () => new Date('2026-06-20T10:00:00Z') });
    expect(await controller.getTodayUsage()).toEqual({ calls: 0, costUsd: 0 });
  });

  test('getTodayUsage() reads the same dailyQuota:<date> key the service worker writes to', async () => {
    const storage = createMockStorage({ 'dailyQuota:2026-06-20': { calls: 3, costUsd: 0.05 } });
    const controller = new PopupController({ storage, now: () => new Date('2026-06-20T10:00:00Z') });
    expect(await controller.getTodayUsage()).toEqual({ calls: 3, costUsd: 0.05 });
  });

  test('throws when constructed without a storage backend', () => {
    expect(() => new PopupController({ storage: null })).toThrow();
  });

  test('hasAnthropicApiKey() is false when no key is stored', async () => {
    const controller = new PopupController({ storage: createMockStorage() });
    expect(await controller.hasAnthropicApiKey()).toBe(false);
  });

  test('setAnthropicApiKey() trims and persists the key under chrome.storage.local; hasAnthropicApiKey() reads it back', async () => {
    const storage = createMockStorage();
    const controller = new PopupController({ storage });

    await controller.setAnthropicApiKey('  sk-ant-abc123  ');

    expect(storage.store.anthropicApiKey).toBe('sk-ant-abc123');
    expect(await controller.hasAnthropicApiKey()).toBe(true);
  });

  test('setAnthropicApiKey("") removes the stored key', async () => {
    const storage = createMockStorage({ anthropicApiKey: 'sk-ant-existing' });
    const controller = new PopupController({ storage });

    await controller.setAnthropicApiKey('');

    expect(storage.remove).toHaveBeenCalledWith('anthropicApiKey');
    expect(await controller.hasAnthropicApiKey()).toBe(false);
  });
});

describe('renderPopup', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('shows the privacy notice and hides main view when not yet accepted', async () => {
    buildPopupDom();
    const controller = new PopupController({ storage: createMockStorage() });

    await renderPopup(document, controller);

    expect(document.getElementById('privacy-notice').hidden).toBe(false);
    expect(document.getElementById('main-view').hidden).toBe(true);
  });

  test('shows main view with usage and enabled state once privacy is accepted', async () => {
    buildPopupDom();
    const storage = createMockStorage({
      privacyAccepted: true,
      extensionEnabled: false,
      'dailyQuota:2026-06-20': { calls: 7, costUsd: 0.1234 },
    });
    const controller = new PopupController({ storage, now: () => new Date('2026-06-20T10:00:00Z') });

    await renderPopup(document, controller);

    expect(document.getElementById('privacy-notice').hidden).toBe(true);
    expect(document.getElementById('main-view').hidden).toBe(false);
    expect(document.getElementById('enabled-toggle').checked).toBe(false);
    expect(document.getElementById('usage-calls').textContent).toBe('7');
    expect(document.getElementById('usage-cost').textContent).toBe('0.1234');
  });

  test('shows MockProvider status when no API key, Anthropic status once a key is stored', async () => {
    buildPopupDom();
    const noKeyController = new PopupController({ storage: createMockStorage({ privacyAccepted: true }) });
    await renderPopup(document, noKeyController);
    expect(document.getElementById('api-key-status').textContent).toMatch(/MockProvider/);

    const withKeyController = new PopupController({
      storage: createMockStorage({ privacyAccepted: true, anthropicApiKey: 'sk-ant-x' }),
    });
    await renderPopup(document, withKeyController);
    expect(document.getElementById('api-key-status').textContent).toMatch(/Da luu/);
  });
});

describe('bootstrapPopup', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('accepting the privacy notice persists it and re-renders the main view (does not show notice again)', async () => {
    buildPopupDom();
    const storage = createMockStorage();
    const controller = new PopupController({ storage });

    await bootstrapPopup(document, controller);
    expect(document.getElementById('privacy-notice').hidden).toBe(false);

    document.getElementById('accept-privacy-btn').dispatchEvent(new window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await controller.isPrivacyAccepted()).toBe(true);
    expect(document.getElementById('privacy-notice').hidden).toBe(true);
    expect(document.getElementById('main-view').hidden).toBe(false);
  });

  test('toggling enabled-toggle calls setExtensionEnabled with the new value', async () => {
    buildPopupDom();
    const storage = createMockStorage({ privacyAccepted: true });
    const controller = new PopupController({ storage });

    await bootstrapPopup(document, controller);

    const toggle = document.getElementById('enabled-toggle');
    toggle.checked = false;
    toggle.dispatchEvent(new window.Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await controller.isExtensionEnabled()).toBe(false);
  });

  test('saving the API key field persists it and re-renders the status text', async () => {
    buildPopupDom();
    const storage = createMockStorage({ privacyAccepted: true });
    const controller = new PopupController({ storage });

    await bootstrapPopup(document, controller);
    expect(document.getElementById('api-key-status').textContent).toMatch(/MockProvider/);

    document.getElementById('api-key-input').value = 'sk-ant-new-key';
    document.getElementById('api-key-save-btn').dispatchEvent(new window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await controller.hasAnthropicApiKey()).toBe(true);
    expect(document.getElementById('api-key-status').textContent).toMatch(/Da luu/);
    // Input duoc xoa sau khi luu - khong giu lai key tho tren man hinh.
    expect(document.getElementById('api-key-input').value).toBe('');
  });
});
