const constants = require('../../extension/src/shared/constants');

describe('constants', () => {
  test('does not contain any API key field', () => {
    const serialized = JSON.stringify(constants).toLowerCase();
    expect(serialized).not.toMatch(/api_key|apikey|secret|token/);
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
