/**
 * @jest-environment jsdom
 */

const { WarningInjector } = require('../../extension/src/content/injector');

describe('WarningInjector', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('injects a Shadow DOM host element next to the target, isolated from page CSS/JS', () => {
    document.body.innerHTML = '<pre id="target">some code</pre>';
    const target = document.getElementById('target');
    const injector = new WarningInjector({ document });

    const host = injector.inject(target, { vulnerable: true, cweId: 'CWE-89', confidence: 0.9 });

    expect(host).not.toBeNull();
    // mode 'closed' => trang goc khong doc duoc host.shadowRoot (dung yeu cau coding-rules.md 3.2).
    expect(host.shadowRoot).toBeNull();
    expect(injector.getShadowRoot(host)).not.toBeNull();
    expect(target.nextSibling).toBe(host);
    // Noi dung canh bao nam trong shadow root, khong lo ra light DOM cua trang.
    expect(document.body.innerHTML).not.toContain('CWE-89');
  });

  test('uses textContent (not innerHTML) so malicious LLM output cannot inject HTML/script', () => {
    document.body.innerHTML = '<pre id="target">some code</pre>';
    const target = document.getElementById('target');
    const injector = new WarningInjector({ document });

    const maliciousResult = {
      vulnerable: true,
      cweId: '<img src=x onerror=alert(1)>',
      confidence: 0.5,
    };

    const host = injector.inject(target, maliciousResult);
    const badge = injector.getShadowRoot(host).querySelector('.badge');

    expect(badge.querySelector('img')).toBeNull();
    expect(badge.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  test('renders a "safe" badge when result.vulnerable is false', () => {
    document.body.innerHTML = '<pre id="target">some code</pre>';
    const target = document.getElementById('target');
    const injector = new WarningInjector({ document });

    const host = injector.inject(target, { vulnerable: false });
    const badge = injector.getShadowRoot(host).querySelector('.badge');

    expect(badge.className).toContain('safe');
    expect(badge.textContent).toMatch(/Khong phat hien/);
  });

  test('returns null when target has no parentNode', () => {
    const detachedTarget = document.createElement('pre');
    const injector = new WarningInjector({ document });

    expect(injector.inject(detachedTarget, { vulnerable: false })).toBeNull();
  });
});
