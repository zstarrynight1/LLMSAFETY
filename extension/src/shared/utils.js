// Ham dung chung, thuan (khong phu thuoc DOM/chrome.*) de de unit test.

async function sha256Hash(text) {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function truncateText(text, maxLength) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function formatErrorForLog(error, context) {
  return {
    name: error && error.name ? error.name : 'Error',
    message: error && error.message ? error.message : String(error),
    context: context || {},
  };
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

class APITimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'APITimeoutError';
  }
}

class APIRateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'APIRateLimitError';
  }
}

class SchemaValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

// Dung chung boi service-worker.js (ghi quota) va popup.js (doc quota hom nay)
// de ca hai luon doc/ghi cung 1 storage key cho cung 1 ngay.
const DAILY_QUOTA_KEY_PREFIX = 'dailyQuota:';

function getTodayKey(date = new Date()) {
  return DAILY_QUOTA_KEY_PREFIX + date.toISOString().slice(0, 10); // YYYY-MM-DD theo UTC
}

const utilsExports = {
  sha256Hash,
  truncateText,
  formatErrorForLog,
  ValidationError,
  APITimeoutError,
  APIRateLimitError,
  SchemaValidationError,
  DAILY_QUOTA_KEY_PREFIX,
  getTodayKey,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = utilsExports;
} else if (typeof globalThis !== 'undefined') {
  globalThis.SafetyExt = globalThis.SafetyExt || {};
  Object.assign(globalThis.SafetyExt, utilsExports);
}
