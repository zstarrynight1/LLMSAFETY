// Logic cua popup: doc trang thai tu chrome.storage.local, hien thi privacy notice
// lan dau cai dat, hien usage hom nay, cho bat/tat extension.
// KHONG goi LLM truc tiep tu day - moi LLM call phai qua background (coding-rules.md 3.3).

const Modules = (() => {
  if (typeof module !== 'undefined' && module.exports) {
    return { Utils: require('../shared/utils') };
  }
  // popup.html da load constants.js/utils.js qua <script src> truoc popup.js,
  // 2 file do gan export vao globalThis.SafetyExt.
  return { Utils: globalThis.SafetyExt };
})();

const { getTodayKey } = Modules.Utils;

const PRIVACY_ACCEPTED_KEY = 'privacyAccepted';
const EXTENSION_ENABLED_KEY = 'extensionEnabled';

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

  async getStatus() {
    const [privacyAccepted, enabled, usage] = await Promise.all([
      this.isPrivacyAccepted(),
      this.isExtensionEnabled(),
      this.getTodayUsage(),
    ]);
    return { privacyAccepted, enabled, usage };
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

  if (acceptBtn && !acceptBtn.dataset.bound) {
    acceptBtn.dataset.bound = 'true';
  }
  if (enabledToggle && !enabledToggle.dataset.bound) {
    enabledToggle.dataset.bound = 'true';
    enabledToggle.addEventListener('change', async () => {
      await controller.setExtensionEnabled(enabledToggle.checked);
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
