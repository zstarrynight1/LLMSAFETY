// Provider implementations (MockProvider + AnthropicProvider). Tach rieng khoi llm-client.js
// (coding-rules.md muc 0 rule 4: file vuot 300 dong PHAI duoc tach truoc khi tiep tuc -
// llm-client.js da vuot nguong nay). LLMClient (orchestration: cache/timeout/retry/validate)
// KHONG phu thuoc truc tiep vao MockProvider/AnthropicProvider - chi can mot object bat ky
// co method analyze(promptPayload) -> { raw, usage }, duoc truyen vao tu ben ngoai.
//
// AnthropicProvider goi thang Anthropic Messages API qua fetch() (KHONG dung @anthropic-ai/sdk
// vi service worker MV3 cua project nay chua co bundler/build step - npm SDK can bundling de
// chay duoc trong importScripts/service worker context; day la quyet dinh kien truc, khong phai
// bo qua SDK tuy tien).

const Utils = (typeof module !== 'undefined' && module.exports)
  ? require('../shared/utils')
  : globalThis.SafetyExt;
const Constants = (typeof module !== 'undefined' && module.exports)
  ? require('../shared/constants')
  : globalThis.SafetyExt;

const { ValidationError, APIRateLimitError, SchemaValidationError } = Utils;
const {
  ANTHROPIC_API_URL,
  ANTHROPIC_API_VERSION,
  DEFAULT_ANTHROPIC_MODEL,
  ANTHROPIC_PRICING_USD_PER_MTOK,
} = Constants;

// --- Provider interface --------------------------------------------------
// Moi provider phai implement: async analyze(promptPayload) -> { raw, usage }
// raw: object tho LLM tra ve (truoc validate). usage: { promptTokens, completionTokens, totalTokens, costUsd }.

class MockProvider {
  constructor({ fixedResponse } = {}) {
    this.fixedResponse = fixedResponse || {
      vulnerable: false,
      cweId: null,
      explanation: 'MockProvider: chua goi LLM that, day la du lieu gia co dinh.',
      confidence: 0.5,
      fixSuggestion: null,
    };
  }

  // eslint-disable-next-line no-unused-vars
  async analyze(promptPayload) {
    return {
      raw: { ...this.fixedResponse },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
    };
  }
}

// Tool dinh nghia bat buoc Claude tra ve structured output (tool_choice ep buoc + strict: true),
// thay vi parse free-text bang regex (cam theo coding-rules.md 4.2).
function buildAnalysisTool() {
  return {
    name: 'report_code_safety_analysis',
    description: 'Bao cao ket qua phan tich an toan cho code snippet trong tag <code_to_analyze>.',
    input_schema: {
      type: 'object',
      properties: {
        vulnerable: { type: 'boolean', description: 'true neu code co van de an toan/lo thoi' },
        cweId: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: 'CWE ID lien quan, vd "CWE-89", hoac null neu khong xac dinh duoc',
        },
        explanation: { type: 'string', description: 'Giai thich ngan gon ly do (tieng Viet hoac tieng Anh deu duoc)' },
        confidence: { type: 'number', description: 'Do tin cay cua ket luan, trong khoang 0 den 1' },
        fixSuggestion: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: 'Goi y cach sua, hoac null neu khong co/khong can',
        },
      },
      required: ['vulnerable', 'cweId', 'explanation', 'confidence', 'fixSuggestion'],
      additionalProperties: false,
    },
    strict: true,
  };
}

function estimateCostUsd(model, usage) {
  const pricing = ANTHROPIC_PRICING_USD_PER_MTOK[model];
  if (!pricing || !usage) return 0;
  const inputCost = ((usage.input_tokens || 0) / 1_000_000) * pricing.input;
  const outputCost = ((usage.output_tokens || 0) / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

async function safeParseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Phan loai loi HTTP tu Anthropic API theo coding-rules.md muc 5: 429 -> APIRateLimitError
// (retry duoc qua withRetry); 4xx con lai (400/401/403/404/413) -> ValidationError (request/key/
// quyen sai, retry vo ich, withRetry da coi ValidationError la non-retryable); 5xx -> Error thuong
// (van retry duoc, dung cho loi tam thoi phia Anthropic).
function classifyAnthropicError(status, errorBody) {
  const message = errorBody && errorBody.error && errorBody.error.message
    ? errorBody.error.message
    : `Anthropic API tra ve HTTP ${status}`;
  if (status === 429) {
    return new APIRateLimitError(message);
  }
  if (status >= 400 && status < 500) {
    return new ValidationError(`Anthropic API request khong hop le (HTTP ${status}): ${message}`);
  }
  return new Error(`Anthropic API loi server (HTTP ${status}): ${message}`);
}

class AnthropicProvider {
  constructor({ apiKey, model = DEFAULT_ANTHROPIC_MODEL, fetchImpl = fetch, maxTokens = 1024 } = {}) {
    if (!apiKey) {
      throw new ValidationError('AnthropicProvider can API key (luu o chrome.storage.local, khong hardcode)');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.maxTokens = maxTokens;
  }

  async analyze(promptPayload) {
    const { system, user } = promptPayload;
    const tool = buildAnalysisTool();

    const response = await this.fetchImpl(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
      }),
    });

    if (!response.ok) {
      const errorBody = await safeParseJson(response);
      throw classifyAnthropicError(response.status, errorBody);
    }

    const data = await response.json();
    const toolUseBlock = (data.content || []).find((block) => block.type === 'tool_use');
    if (!toolUseBlock) {
      throw new SchemaValidationError(
        `Anthropic response khong chua tool_use block (stop_reason: ${data.stop_reason})`,
      );
    }

    const usage = data.usage || {};
    return {
      raw: toolUseBlock.input,
      usage: {
        promptTokens: usage.input_tokens || 0,
        completionTokens: usage.output_tokens || 0,
        totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
        costUsd: estimateCostUsd(this.model, usage),
      },
    };
  }
}

const llmProvidersExports = {
  MockProvider,
  AnthropicProvider,
  buildAnalysisTool,
  estimateCostUsd,
  classifyAnthropicError,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = llmProvidersExports;
} else if (typeof globalThis !== 'undefined') {
  globalThis.SafetyExt = globalThis.SafetyExt || {};
  Object.assign(globalThis.SafetyExt, llmProvidersExports);
}
