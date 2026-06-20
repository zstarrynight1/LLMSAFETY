// Logic cua popup: doc trang thai tu chrome.storage.local, hien thi privacy notice
// lan dau cai dat, hien usage hom nay, cho bat/tat extension.
// KHONG goi LLM truc tiep tu day - moi LLM call phai qua background (coding-rules.md 3.3).

const Modules = (() => {
  if (typeof module !== 'undefined' && module.exports) {
    return { Utils: require('../shared/utils'), Constants: require('../shared/constants') };
  }
  // popup.html da load constants.js/utils.js qua <script src> truoc popup.js,
  // 2 file do gan export vao globalThis.SafetyExt.
  return { Utils: globalThis.SafetyExt, Constants: globalThis.SafetyExt };
})();

const { getTodayKey } = Modules.Utils;
const { ANTHROPIC_API_KEY_STORAGE_KEY, EXTENSION_ENABLED_STORAGE_KEY } = Modules.Constants;

const PRIVACY_ACCEPTED_KEY = 'privacyAccepted';
const EXTENSION_ENABLED_KEY = EXTENSION_ENABLED_STORAGE_KEY;

class PopupController {
  constructor({ storage = (typeof chrome !== 'undefined' ? chrome.storage.local : null), now = () => new Date() } = {}) {
    if (!storage) {
      throw new Error('PopupController can mot storage backend (vd chrome.storage.local hoac mock trong test)');
    }
    this.storage = storage;
    this.now = now;
  }

  async isPrivacyAccepted() {
    const stored = await this.storage.get(PRIVACY_ACCEPTED_KEY);
    return Boolean(stored && stored[PRIVACY_ACCEPTED_KEY]);
  }

  async acceptPrivacyNotice() {
    await this.storage.set({ [PRIVACY_ACCEPTED_KEY]: true });
  }

  async isExtensionEnabled() {
    const stored = await this.storage.get(EXTENSION_ENABLED_KEY);
    if (stored && EXTENSION_ENABLED_KEY in stored) {
      return Boolean(stored[EXTENSION_ENABLED_KEY]);
    }
    return true; // mac dinh bat
  }

  async setExtensionEnabled(enabled) {
    await this.storage.set({ [EXTENSION_ENABLED_KEY]: Boolean(enabled) });
  }

  async getTodayUsage() {
    const key = getTodayKey(this.now());
    const stored = await this.storage.get(key);
    return (stored && stored[key]) || { calls: 0, costUsd: 0 };
  }

  // Chi tra ve co/khong co key, KHONG bao gio tra ve gia tri that cua key ra UI
  // (tranh lo key qua console/DOM inspector).
  async hasAnthropicApiKey() {
    const stored = await this.storage.get(ANTHROPIC_API_KEY_STORAGE_KEY);
    return Boolean(stored && stored[ANTHROPIC_API_KEY_STORAGE_KEY]);
  }

  async setAnthropicApiKey(apiKey) {
    const trimmed = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!trimmed) {
      await this.storage.remove(ANTHROPIC_API_KEY_STORAGE_KEY);
      return;
    }
    await this.storage.set({ [ANTHROPIC_API_KEY_STORAGE_KEY]: trimmed });
  }

  async getStatus() {
    const [privacyAccepted, enabled, usage, hasApiKey] = await Promise.all([
      this.isPrivacyAccepted(),
      this.isExtensionEnabled(),
      this.getTodayUsage(),
      this.hasAnthropicApiKey(),
    ]);
    return {
      privacyAccepted, enabled, usage, hasApiKey,
    };
  }
}

// --- Render UI (chi chay khi co document that, khong chay khi require() boi test logic thuan) ---

async function renderPopup(doc, controller) {
  const privacyView = doc.getElementById('privacy-notice');
  const mainView = doc.getElementById('main-view');
  const acceptBtn = doc.getElementById('accept-privacy-btn');
  const enabledToggle = doc.getElementById('enabled-toggle');
  const usageCallsEl = doc.getElementById('usage-calls');
  const usageCostEl = doc.getElementById('usage-cost');
  const apiKeyStatusEl = doc.getElementById('api-key-status');
  const apiKeyInput = doc.getElementById('api-key-input');
  const apiKeySaveBtn = doc.getElementById('api-key-save-btn');

  const status = await controller.getStatus();

  if (!status.privacyAccepted) {
    privacyView.hidden = false;
    mainView.hidden = true;
    return;
  }

  privacyView.hidden = true;
  mainView.hidden = false;
  enabledToggle.checked = status.enabled;
  usageCallsEl.textContent = String(status.usage.calls);
  usageCostEl.textContent = status.usage.costUsd.toFixed(4);
  apiKeyStatusEl.textContent = status.hasApiKey
    ? 'Da luu (dang dung Anthropic that)'
    : 'Chua co - dang dung du lieu gia (MockProvider)';
  apiKeyInput.value = '';

  if (acceptBtn && !acceptBtn.dataset.bound) {
    acceptBtn.dataset.bound = 'true';
  }
  if (enabledToggle && !enabledToggle.dataset.bound) {
    enabledToggle.dataset.bound = 'true';
    enabledToggle.addEventListener('change', async () => {
      await controller.setExtensionEnabled(enabledToggle.checked);
    });
  }
  if (apiKeySaveBtn && !apiKeySaveBtn.dataset.bound) {
    apiKeySaveBtn.dataset.bound = 'true';
    apiKeySaveBtn.addEventListener('click', async () => {
      await controller.setAnthropicApiKey(apiKeyInput.value);
      await renderPopup(doc, controller);
    });
  }
}

function bootstrapPopup(doc, controller) {
  const acceptBtn = doc.getElementById('accept-privacy-btn');
  acceptBtn.addEventListener('click', async () => {
    await controller.acceptPrivacyNotice();
    await renderPopup(doc, controller);
  });
  return renderPopup(doc, controller);
}

const popupExports = { PopupController, renderPopup, bootstrapPopup, PRIVACY_ACCEPTED_KEY, EXTENSION_ENABLED_KEY };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = popupExports;
} else if (typeof document !== 'undefined') {
  bootstrapPopup(document, new PopupController());
}
