const {
  sha256Hash,
  truncateText,
  formatErrorForLog,
  ValidationError,
  APITimeoutError,
  APIRateLimitError,
  SchemaValidationError,
} = require('../../extension/src/shared/utils');

describe('sha256Hash', () => {
  test('returns a deterministic 64-char hex digest for the same input', async () => {
    const a = await sha256Hash('const x = 1;');
    const b = await sha256Hash('const x = 1;');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('returns different digests for different input (used as cache key, not URL)', async () => {
    const a = await sha256Hash('snippet A');
    const b = await sha256Hash('snippet B');
    expect(a).not.toBe(b);
  });
});

describe('truncateText', () => {
  test('returns text unchanged when shorter than maxLength', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  test('truncates text longer than maxLength', () => {
    expect(truncateText('abcdefghij', 4)).toBe('abcd');
  });

  test('returns empty string for non-string input', () => {
    expect(truncateText(null, 10)).toBe('');
    expect(truncateText(undefined, 10)).toBe('');
  });
});

describe('formatErrorForLog', () => {
  test('extracts name/message and attaches context, without leaking raw error object', () => {
    const err = new ValidationError('bad input');
    const formatted = formatErrorForLog(err, { snippetLength: 42 });
    expect(formatted).toEqual({
      name: 'ValidationError',
      message: 'bad input',
      context: { snippetLength: 42 },
    });
  });
});

describe('error classes', () => {
  test('each error subclass sets the correct .name', () => {
    expect(new ValidationError('x').name).toBe('ValidationError');
    expect(new APITimeoutError('x').name).toBe('APITimeoutError');
    expect(new APIRateLimitError('x').name).toBe('APIRateLimitError');
    expect(new SchemaValidationError('x').name).toBe('SchemaValidationError');
  });

  test('each error subclass is still an instanceof Error', () => {
    expect(new ValidationError('x')).toBeInstanceOf(Error);
    expect(new SchemaValidationError('x')).toBeInstanceOf(Error);
  });
});
