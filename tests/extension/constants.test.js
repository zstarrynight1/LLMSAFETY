const constants = require('../../extension/src/shared/constants');

describe('constants', () => {
  test('does not contain any real secret value (storage key NAMES like ANTHROPIC_API_KEY_STORAGE_KEY are allowed - they are labels, not secrets)', () => {
    const serialized = JSON.stringify(constants);
    // Gia tri secret that thuong co prefix dac trung nha cung cap (vd sk-ant-..., sk-proj-...).
    expect(serialized).not.toMatch(/sk-ant-|sk-proj-|sk-[a-zA-Z0-9]{20,}/);
  });

  test('ANTHROPIC_API_KEY_STORAGE_KEY is only a storage key name, not a secret value', () => {
    expect(constants.ANTHROPIC_API_KEY_STORAGE_KEY).toBe('anthropicApiKey');
  });

  test('CWE_TAXONOMY is frozen and covers common web vulnerability classes', () => {
    expect(Object.isFrozen(constants.CWE_TAXONOMY)).toBe(true);
    expect(constants.CWE_TAXONOMY).toHaveProperty('CWE-79');
    expect(constants.CWE_TAXONOMY).toHaveProperty('CWE-89');
  });

  test('numeric limits are positive and DEBUG_MODE defaults to false', () => {
    expect(constants.MAX_PROMPT_LENGTH).toBeGreaterThan(0);
    expect(constants.TIMEOUT_MS).toBeGreaterThan(0);
    expect(constants.MAX_RETRY_COUNT).toBeGreaterThan(0);
    expect(constants.MAX_DAILY_API_CALLS).toBeGreaterThan(0);
    expect(constants.MAX_DAILY_COST_USD).toBeGreaterThan(0);
    expect(constants.DEBUG_MODE).toBe(false);
  });

  test('SUPPORTED_DOMAINS only lists stackoverflow.com and github.com', () => {
    expect(constants.SUPPORTED_DOMAINS).toEqual(['stackoverflow.com', 'github.com']);
  });
});
