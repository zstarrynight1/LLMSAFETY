/**
 * @jest-environment jsdom
 */

const { CodeDetector } = require('../../extension/src/content/detector');

function buildStackOverflowDom() {
  document.body.innerHTML = `
    <div class="question">
      <pre><code class="language-python">import os
os.system(user_input)</code></pre>
    </div>
    <div class="highlight">const x = eval(input);</div>
  `;
}

function buildGithubDom() {
  document.body.innerHTML = `
    <table>
      <tr><td class="blob-code">SELECT * FROM users WHERE id = '" + id + "'</td></tr>
    </table>
  `;
}

describe('CodeDetector', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('finds code blocks via <pre><code> and .highlight selectors on StackOverflow-like DOM', () => {
    buildStackOverflowDom();
    const detector = new CodeDetector({
      document,
      location: { hostname: 'stackoverflow.com', href: 'https://stackoverflow.com/q/1' },
    });

    const found = detector.scan();

    expect(found).toHaveLength(2);
    expect(found[0].codeText).toContain('os.system');
    expect(found[0].context.platform).toBe('stackoverflow');
    expect(found[0].context.language).toBe('python');
  });

  test('finds code blocks via .blob-code selector on GitHub-like DOM', () => {
    buildGithubDom();
    const detector = new CodeDetector({
      document,
      location: { hostname: 'github.com', href: 'https://github.com/owner/repo' },
    });

    const found = detector.scan();

    expect(found).toHaveLength(1);
    expect(found[0].codeText).toContain('SELECT * FROM users');
    expect(found[0].context.platform).toBe('github');
  });

  test('extracts text via textContent, not innerHTML (no script execution / no HTML tags leak)', () => {
    document.body.innerHTML = '<pre><code>&lt;img src=x onerror=alert(1)&gt;</code></pre>';
    const detector = new CodeDetector({ document, location: { hostname: 'github.com', href: 'https://github.com/x' } });

    const found = detector.scan();

    expect(found[0].codeText).toBe('<img src=x onerror=alert(1)>');
  });

  test('does not re-report already processed elements on subsequent scan()', () => {
    buildStackOverflowDom();
    const detector = new CodeDetector({ document, location: { hostname: 'stackoverflow.com', href: 'https://stackoverflow.com' } });

    const first = detector.scan();
    const second = detector.scan();

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(0);
  });

  test('ignores empty code blocks', () => {
    document.body.innerHTML = '<pre><code>   </code></pre>';
    const detector = new CodeDetector({ document, location: { hostname: 'github.com', href: 'https://github.com' } });

    expect(detector.scan()).toHaveLength(0);
  });

  test('calls onCodeBlocksFound callback with found blocks', () => {
    buildGithubDom();
    const onCodeBlocksFound = jest.fn();
    const detector = new CodeDetector({
      document,
      location: { hostname: 'github.com', href: 'https://github.com' },
      onCodeBlocksFound,
    });

    detector.scan();

    expect(onCodeBlocksFound).toHaveBeenCalledTimes(1);
    expect(onCodeBlocksFound.mock.calls[0][0]).toHaveLength(1);
  });
});
