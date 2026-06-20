// Cau hinh dung chung cho extension. KHONG chua API key hay bat ky secret nao.

const CWE_TAXONOMY = Object.freeze({
  'CWE-79': 'Cross-site Scripting (XSS)',
  'CWE-89': 'SQL Injection',
  'CWE-78': 'OS Command Injection',
  'CWE-22': 'Path Traversal',
  'CWE-94': 'Code Injection',
  'CWE-502': 'Deserialization of Untrusted Data',
  'CWE-798': 'Use of Hard-coded Credentials',
  'CWE-327': 'Use of a Broken or Risky Cryptographic Algorithm',
  'CWE-352': 'Cross-Site Request Forgery (CSRF)',
  'CWE-611': 'XML External Entity (XXE)',
});

const MAX_PROMPT_LENGTH = 8000; // ky tu, tinh tu code snippet sau khi truncate
const TIMEOUT_MS = 20000; // 15-30s theo coding-rules.md 4.2
const MAX_RETRY_COUNT = 3;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngay

const MAX_DAILY_API_CALLS = 200;
const MAX_DAILY_COST_USD = 5;

const SUPPORTED_DOMAINS = Object.freeze(['stackoverflow.com', 'github.com']);

const DEBUG_MODE = false; // bat thu cong khi dev, PHAI tat khi build production

// --- Anthropic provider config (KHONG chua API key - key luu o chrome.storage.local) ---
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
// claude-haiku-4-5: re nhat/nhanh nhat, phu hop use case real-time trong extension
// (xem RESEARCH_PLAN.md RQ3 - co the doi sang claude-sonnet-4-6/claude-opus-4-8 de
// so sanh trade-off chi phi/do chinh xac trong research/evaluation/).
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_PRICING_USD_PER_MTOK = Object.freeze({
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
});
// Ten key trong chrome.storage.local - KHONG phai gia tri secret, chi la ten field.
const ANTHROPIC_API_KEY_STORAGE_KEY = 'anthropicApiKey';

// Dung chung boi popup.js (ghi khi user bat/tat) va service-worker.js (doc truoc khi phan tich) -
// dat o day de 2 file luon dung chung 1 ten key, tranh tinh trang toggle "tat" trong popup
// khong co tac dung thuc te vi khong noi nao doc lai.
const EXTENSION_ENABLED_STORAGE_KEY = 'extensionEnabled';

const constantsExports = {
  CWE_TAXONOMY,
  MAX_PROMPT_LENGTH,
  TIMEOUT_MS,
  MAX_RETRY_COUNT,
  CACHE_TTL_MS,
  MAX_DAILY_API_CALLS,
  MAX_DAILY_COST_USD,
  SUPPORTED_DOMAINS,
  DEBUG_MODE,
  ANTHROPIC_API_URL,
  ANTHROPIC_API_VERSION,
  DEFAULT_ANTHROPIC_MODEL,
  ANTHROPIC_PRICING_USD_PER_MTOK,
  ANTHROPIC_API_KEY_STORAGE_KEY,
  EXTENSION_ENABLED_STORAGE_KEY,
};

if (typeof module !== 'undefined' && module.exports) {
  // Node/Jest: moi file la 1 CommonJS module rieng, dung require() de lay.
  module.exports = constantsExports;
} else if (typeof globalThis !== 'undefined') {
  // Browser (content script nhieu file / service worker importScripts):
  // gan vao namespace chung de cac file khac doc duoc, khong dua vao lexical scope ngam dinh.
  globalThis.SafetyExt = globalThis.SafetyExt || {};
  Object.assign(globalThis.SafetyExt, constantsExports);
}
