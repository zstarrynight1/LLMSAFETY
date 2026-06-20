// Inject UI canh bao vao trang qua Shadow DOM, co lap CSS/JS voi trang goc.
// Moi text dua vao DOM qua textContent - KHONG dung innerHTML, ke ca voi output LLM.

class WarningInjector {
  constructor({ document: doc = document } = {}) {
    this.document = doc;
    // mode: 'closed' an host.shadowRoot khoi script cua trang goc (xem coding-rules.md 3.2).
    // Giu rieng reference o day de extension van doc/test duoc noi dung minh vua render.
    this._shadowRoots = new WeakMap();
  }

  getShadowRoot(host) {
    return this._shadowRoots.get(host) || null;
  }

  inject(targetElement, result) {
    if (!targetElement || !targetElement.parentNode) return null;

    const host = this.document.createElement('div');
    host.setAttribute('data-llm-safety-badge', 'true');
    const shadow = host.attachShadow({ mode: 'closed' });
    this._shadowRoots.set(host, shadow);

    const style = this.document.createElement('style');
    style.textContent = [
      '.badge { font-family: sans-serif; font-size: 12px; padding: 4px 8px;',
      'border-radius: 4px; margin: 4px 0; display: inline-block; }',
      '.badge.vulnerable { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }',
      '.badge.safe { background: #ecfdf5; color: #065f46; border: 1px solid #6ee7b7; }',
    ].join(' ');
    shadow.appendChild(style);

    const badge = this.document.createElement('div');
    badge.className = `badge ${result && result.vulnerable ? 'vulnerable' : 'safe'}`;
    badge.textContent = this.buildLabel(result);
    shadow.appendChild(badge);

    targetElement.parentNode.insertBefore(host, targetElement.nextSibling);
    return host;
  }

  buildLabel(result) {
    if (!result) return 'Khong co du lieu phan tich';
    if (!result.vulnerable) return 'Khong phat hien van de an toan ro rang';
    const confidencePct = Math.round((result.confidence || 0) * 100);
    const cwe = result.cweId || 'tiem an rui ro';
    return `Canh bao: ${cwe} (tin cay ${confidencePct}%)`;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WarningInjector };
}
