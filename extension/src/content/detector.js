// Tim code block trong DOM (StackOverflow/GitHub). Khong tu goi LLM o day -
// chi phat hien + trich xuat, viec phan tich do background dam nhiem.

const CODE_BLOCK_SELECTORS = ['pre code', '.highlight', '.blob-code'];

class CodeDetector {
  constructor({ document: doc = document, location: loc = (typeof location !== 'undefined' ? location : null), onCodeBlocksFound } = {}) {
    this.document = doc;
    this.location = loc;
    this.onCodeBlocksFound = onCodeBlocksFound;
    this.processedElements = new WeakSet();
    this.observer = null;
  }

  scan() {
    const elements = this.document.querySelectorAll(CODE_BLOCK_SELECTORS.join(', '));
    const found = [];
    elements.forEach((element) => {
      if (this.processedElements.has(element)) return;
      const codeText = element.textContent || '';
      if (!codeText.trim()) return;
      this.processedElements.add(element);
      found.push({
        element,
        codeText,
        context: this.extractContext(element),
      });
    });
    if (found.length > 0 && typeof this.onCodeBlocksFound === 'function') {
      this.onCodeBlocksFound(found);
    }
    return found;
  }

  extractContext(element) {
    const languageMatch = (element.className || '').match(/language-([a-zA-Z0-9+#]+)/);
    return {
      language: languageMatch ? languageMatch[1] : null,
      url: this.location ? this.location.href : null,
      platform: this.detectPlatform(),
    };
  }

  detectPlatform() {
    const host = this.location ? this.location.hostname || '' : '';
    if (host.includes('stackoverflow.com')) return 'stackoverflow';
    if (host.includes('github.com')) return 'github';
    return 'unknown';
  }

  observe(target = this.document.body) {
    if (!target) return;
    this.observer = new MutationObserver(() => this.scan());
    this.observer.observe(target, { childList: true, subtree: true });
    this.scan();
  }

  disconnect() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CodeDetector, CODE_BLOCK_SELECTORS };
}

// Bootstrap chi chay trong moi truong extension that (co chrome.runtime),
// khong chay khi file duoc require() boi test.
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
  const detector = new CodeDetector({
    onCodeBlocksFound: (blocks) => {
      blocks.forEach(({ codeText, context }) => {
        chrome.runtime.sendMessage({
          type: 'ANALYZE_CODE_SNIPPET',
          payload: { codeText, context },
        });
      });
    },
  });
  detector.observe();
}
