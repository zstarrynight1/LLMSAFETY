const {
  MockProvider,
  AnthropicProvider,
} = require('../../extension/src/background/llm-providers');
const {
  ValidationError,
  APIRateLimitError,
  SchemaValidationError,
} = require('../../extension/src/shared/utils');

const VALID_RAW = {
  vulnerable: true,
  cweId: 'CWE-89',
  explanation: 'SQL query duoc noi chuoi truc tiep tu input.',
  confidence: 0.92,
  fixSuggestion: 'Dung prepared statement.',
};

describe('MockProvider', () => {
  test('analyze() returns the fixed response with zero usage/cost, no network call', async () => {
    const provider = new MockProvider({ fixedResponse: VALID_RAW });
    const { raw, usage } = await provider.analyze({ system: 's', user: 'u' });

    expect(raw).toEqual(VALID_RAW);
    expect(usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 });
  });

  test('uses a sensible default fixedResponse when none is provided', async () => {
    const provider = new MockProvider();
    const { raw } = await provider.analyze({ system: 's', user: 'u' });
    expect(raw.vulnerable).toBe(false);
  });
});

function buildAnthropicResponse({ input = VALID_RAW, stopReason = 'tool_use', usage = { input_tokens: 100, output_tokens: 50 } } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      stop_reason: stopReason,
      content: input === null ? [] : [{ type: 'tool_use', id: 'toolu_1', name: 'report_code_safety_analysis', input }],
      usage,
    }),
  };
}

describe('AnthropicProvider — goi Anthropic Messages API qua fetch, khong network that trong test', () => {
  test('constructor throws ValidationError when apiKey is missing', () => {
    expect(() => new AnthropicProvider({ apiKey: '' })).toThrow(ValidationError);
  });

  test('analyze() sends x-api-key/anthropic-version headers and forces structured output via tool_choice', async () => {
    const fetchImpl = jest.fn(async () => buildAnthropicResponse());
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test', fetchImpl });

    await provider.analyze({ system: 'sys prompt', user: '<code_to_analyze>...</code_to_analyze>' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options.headers['x-api-key']).toBe('sk-ant-test');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'report_code_safety_analysis' });
    expect(body.tools[0].strict).toBe(true);
    expect(body.tools[0].input_schema.additionalProperties).toBe(false);
  });

  test('analyze() returns the tool_use input as raw, with usage/cost computed from response.usage', async () => {
    const fetchImpl = jest.fn(async () => buildAnthropicResponse({
      input: VALID_RAW,
      usage: { input_tokens: 1000, output_tokens: 500 },
    }));
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test', model: 'claude-haiku-4-5', fetchImpl });

    const { raw, usage } = await provider.analyze({ system: 's', user: 'u' });

    expect(raw).toEqual(VALID_RAW);
    expect(usage.promptTokens).toBe(1000);
    expect(usage.completionTokens).toBe(500);
    // claude-haiku-4-5: $1/$5 per MTok -> 1000/1e6*1 + 500/1e6*5 = 0.001 + 0.0025 = 0.0035
    expect(usage.costUsd).toBeCloseTo(0.0035, 6);
  });

  test('analyze() throws SchemaValidationError when response has no tool_use block', async () => {
    const fetchImpl = jest.fn(async () => buildAnthropicResponse({ input: null, stopReason: 'end_turn' }));
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test', fetchImpl });

    await expect(provider.analyze({ system: 's', user: 'u' })).rejects.toThrow(SchemaValidationError);
  });

  test('analyze() throws APIRateLimitError on HTTP 429 (retryable by withRetry)', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ type: 'error', error: { type: 'rate_limit_error', message: 'Too many requests' } }),
    }));
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test', fetchImpl });

    await expect(provider.analyze({ system: 's', user: 'u' })).rejects.toThrow(APIRateLimitError);
  });

  test('analyze() throws ValidationError on HTTP 401 (non-retryable, bad API key)', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
    }));
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-bad', fetchImpl });

    await expect(provider.analyze({ system: 's', user: 'u' })).rejects.toThrow(ValidationError);
  });

  test('analyze() throws a generic (retryable) Error on HTTP 500', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ type: 'error', error: { type: 'api_error', message: 'internal error' } }),
    }));
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test', fetchImpl });

    await expect(provider.analyze({ system: 's', user: 'u' }))
      .rejects.not.toBeInstanceOf(ValidationError);
    await expect(new AnthropicProvider({ apiKey: 'sk-ant-test', fetchImpl }).analyze({ system: 's', user: 'u' }))
      .rejects.toThrow(/HTTP 500/);
  });
});
