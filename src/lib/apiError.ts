/**
 * apiError.ts
 *
 * Unified, comprehensive error classification for AI API Doctor.
 * Maps every HTTP status, network condition, and response pattern
 * to a specific ApiErrorType with a user-facing message + suggestion.
 *
 * NEVER logs or exposes the full API key anywhere.
 */

import { ApiErrorType } from '../types';

// ─── Result type ───────────────────────────────────────────

export interface ClassifyResult {
  code: ApiErrorType;
  message: string;
  providerMessage?: string;
  httpStatus?: number;
}

// ─── Internal helpers ──────────────────────────────────────

type JsonObject = Record<string, unknown>;

function tryParseJson(text: string): JsonObject | null {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as JsonObject;
    }
    return null;
  } catch {
    return null;
  }
}

function extractProviderMessage(bodyText: string): string | undefined {
  const json = tryParseJson(bodyText);
  if (json) {
    // Nested error object: { error: { message: "..." } }
    const errObj = json['error'];
    if (errObj && typeof errObj === 'object') {
      const o = errObj as JsonObject;
      const msg =
        o['message'] ||
        o['code'] ||
        undefined;
      if (typeof msg === 'string' && msg.length > 0) return msg.slice(0, 300);
    }
    // Direct fields
    const msg =
      json['message'] ||
      json['detail'] ||
      json['error'] ||
      json['msg'] ||
      undefined;
    if (typeof msg === 'string' && msg.length > 0) return msg.slice(0, 300);
  }
  // Not JSON — safe text snippet only
  const trimmed = bodyText.trim();
  if (trimmed.length > 0 && !trimmed.startsWith('<') && !trimmed.startsWith('<!')) {
    return trimmed.slice(0, 200);
  }
  return undefined;
}

function isHtmlLike(text: string): boolean {
  const t = text.trim();
  if (t.startsWith('<') || t.startsWith('<!')) return true;
  const lower = t.toLowerCase();
  return (
    lower.includes('<html') ||
    lower.includes('<!doctype') ||
    lower.includes('<head>') ||
    lower.includes('<body') ||
    lower.includes('<title') ||
    lower.includes('<form')
  );
}

function isCloudflare(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('cloudflare') ||
    lower.includes('ray id:') ||
    lower.includes('attention required') ||
    lower.includes('_cf_chl_opt') ||
    lower.includes('cf-dns') ||
    lower.includes('chk_jschl')
  );
}

function isLoginPage(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('sign in') ||
    lower.includes('sign-in') ||
    lower.includes('login page') ||
    lower.includes('log in') ||
    lower.includes('请登录') ||
    lower.includes('登录页') ||
    lower.includes('/auth/login') ||
    lower.includes('/auth/signin') ||
    lower.includes('oauth/authorize')
  );
}

// ─── Main classifier ──────────────────────────────────────

export function classifyApiError(
  response: Response | null,
  responseText: string,
  caughtError?: Error | string
): ClassifyResult {
  // ── 1. Network-level failure ───────────────────────────
  if (caughtError) {
    const msg = typeof caughtError === 'string' ? caughtError : caughtError.message;
    const lower = msg.toLowerCase();

    if (
      lower.includes('net::err_') ||
      lower.includes('net::') ||
      lower.includes('dns') ||
      lower.includes('erefused') ||
      lower.includes('econnrefused') ||
      lower.includes('enetunreach') ||
      lower.includes('connection refused') ||
      lower.includes('connection reset') ||
      lower.includes('failed to fetch')
    ) {
      return {
        code: 'HOST_UNREACHABLE',
        message: 'Cannot reach the host — the domain may be wrong or the server is down.',
      };
    }
    if (lower.includes('ssl') || lower.includes('tls') || lower.includes('certificate')) {
      return {
        code: 'SSL_ERROR',
        message: 'SSL/TLS certificate error — the server certificate is invalid or expired.',
      };
    }
    if (lower.includes('timeout') || lower.includes('timed out')) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Request timed out — the server took too long to respond.',
      };
    }
    if (lower.includes('cors') || lower.includes('access-control') || lower.includes('blocked by')) {
      return {
        code: 'CORS_ERROR',
        message:
          'CORS error — the server blocked this request from the browser. ' +
          'Check host_permissions in manifest.json.',
      };
    }
    if (lower.includes('aborted')) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Request aborted — possible timeout or network interruption.',
      };
    }
    return {
      code: 'NETWORK_ERROR',
      message: `Network error: ${msg}`,
    };
  }

  // ── 2. No response ──────────────────────────────────
  if (!response) {
    return { code: 'UNKNOWN_ERROR', message: 'No response received from the server.' };
  }

  const status = response.status;
  const pm = extractProviderMessage(responseText);
  const lower = (pm || '').toLowerCase();

  // ── 3. HTML / login / Cloudflare ───────────────────
  if (isCloudflare(responseText)) {
    return {
      code: 'CLOUDFLARE_BLOCK',
      message:
        'Cloudflare blocked this request. ' +
        'The server is behind Cloudflare protection and requires additional verification.',
      providerMessage: pm,
      httpStatus: status,
    };
  }
  if (isLoginPage(responseText)) {
    return {
      code: 'LOGIN_PAGE',
      message:
        'Request redirected to a login page. ' +
        'You may have entered a website URL instead of an API endpoint.',
      providerMessage: pm,
      httpStatus: status,
    };
  }
  if (isHtmlLike(responseText)) {
    return {
      code: 'HTML_RESPONSE',
      message:
        'Server returned an HTML page. ' +
        'You may have entered a website URL instead of an API base URL.',
      providerMessage: pm,
      httpStatus: status,
    };
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json') && !response.ok) {
    return {
      code: 'NON_JSON_RESPONSE',
      message:
        'Server returned a non-JSON response. ' +
        'The endpoint may not be an OpenAI-compatible API.',
      providerMessage: pm,
      httpStatus: status,
    };
  }

  // ── 4. HTTP 5xx ─────────────────────────────────────
  if (status >= 500) {
    return {
      code: 'HTTP_5XX',
      message: `Provider server error (HTTP ${status}). The server encountered an internal error.`,
      providerMessage: pm,
      httpStatus: status,
    };
  }

  // ── 5. HTTP 4xx ─────────────────────────────────────

  if (status === 400) {
    if (/invalid.*key|bad.*key|malformed|missing.*key/i.test(lower)) {
      return {
        code: 'HTTP_401',
        message: 'Bad request — the API key format may be invalid.',
        providerMessage: pm,
        httpStatus: status,
      };
    }
    return {
      code: 'HTTP_400',
      message: 'Bad request (HTTP 400) — check the URL, model ID, or request parameters.',
      providerMessage: pm,
      httpStatus: status,
    };
  }

  if (status === 401) {
    if (/expired|过期|失效/i.test(lower)) {
      return {
        code: 'KEY_EXPIRED',
        message: 'API key has expired. Please use a valid, non-expired key.',
        providerMessage: pm,
        httpStatus: status,
      };
    }
    if (/disabled|禁用|停用/i.test(lower)) {
      return {
        code: 'KEY_DISABLED',
        message: 'API key has been disabled. Please enable or regenerate it.',
        providerMessage: pm,
        httpStatus: status,
      };
    }
    if (/wrong.*host|another.*site|不属于/i.test(lower)) {
      return {
        code: 'KEY_WRONG_HOST',
        message:
          'This API key belongs to a different site. ' +
          'Check that the base URL matches the key provider.',
        providerMessage: pm,
        httpStatus: status,
      };
    }
    return {
      code: 'HTTP_401',
      message: 'API key is invalid or missing. Please check your API key.',
      providerMessage: pm,
      httpStatus: status,
    };
  }

  if (status === 402) {
    return {
      code: 'KEY_NO_BALANCE',
      message: 'Insufficient balance or quota. Please top up your account.',
      providerMessage: pm,
      httpStatus: status,
    };
  }

  if (status === 403) {
    if (/ip.*restrict|ip.*whitelist|ip.*allow|ip.*limit/i.test(lower)) {
      return {
        code: 'KEY_IP_RESTRICTED',
        message:
          'Access denied — this API key is restricted to specific IP addresses. ' +
          'Browser requests may not be allowed.',
        providerMessage: pm,
        httpStatus: status,
      };
    }
    if (/concurren|并发|too.*many.*request/i.test(lower)) {
      return {
        code: 'KEY_CONCURRENCY_LIMITED',
        message: 'Concurrency limit reached — too many simultaneous requests.',
        providerMessage: pm,
        httpStatus: status,
      };
    }
    if (/expired|过期|失效/i.test(lower)) {
      return {
        code: 'KEY_EXPIRED',
        message: 'API key has expired.',
        providerMessage: pm,
        httpStatus: status,
      };
    }
    if (/disabled|禁用|停用/i.test(lower)) {
      return {
        code: 'KEY_DISABLED',
        message: 'API key has been disabled.',
        providerMessage: pm,
        httpStatus: status,
      };
    }
    if (
      /无权访问|分组|模型组|GPT官方|group.*permission|permission.*group|forbidden.*group|group.*not.*allow/i
        .test(pm || '')
    ) {
      return {
        code: 'KEY_NO_PERMISSION',
        message:
          'Permission denied — this API key does not have access to the selected model or model group.',
        providerMessage: pm,
        httpStatus: status,
      };
    }
    if (/not.*found|model.*not.*exist|模型.*不存在|不存在/i.test(lower)) {
      return {
        code: 'MODEL_NOT_FOUND',
        message: 'Model not found (HTTP 403). The model ID may be incorrect or not in your key group.',
        providerMessage: pm,
        httpStatus: status,
      };
    }
    return {
      code: 'HTTP_403',
      message: 'Permission denied (HTTP 403).',
      providerMessage: pm,
      httpStatus: status,
    };
  }

  if (status === 404) {
    if (/model|not.*found|不存在|未找到/i.test(lower)) {
      return {
        code: 'MODEL_NOT_FOUND',
        message:
          'Model not found (HTTP 404). ' +
          'The model ID may be incorrect, or the model is not available on this provider.',
        providerMessage: pm,
        httpStatus: status,
      };
    }
    return {
      code: 'HTTP_404',
      message: 'Endpoint not found (HTTP 404). The base URL may be incorrect.',
      providerMessage: pm,
      httpStatus: status,
    };
  }

  if (status === 408) {
    return {
      code: 'HTTP_408',
      message: 'Request timeout (HTTP 408).',
      providerMessage: pm,
      httpStatus: status,
    };
  }

  if (status === 429) {
    if (/balance|quota|额度|充值/i.test(lower)) {
      return {
        code: 'KEY_NO_BALANCE',
        message: 'Quota exceeded or rate limited. Please top up or wait before retrying.',
        providerMessage: pm,
        httpStatus: status,
      };
    }
    return {
      code: 'HTTP_429',
      message: 'Rate limited (HTTP 429). Too many requests — please wait and try again.',
      providerMessage: pm,
      httpStatus: status,
    };
  }

  // ── 6. Non-OK but unrecognized ────────────────────
  if (!response.ok) {
    return {
      code: 'UNKNOWN_ERROR',
      message: `Request failed with HTTP ${status}.`,
      providerMessage: pm,
      httpStatus: status,
    };
  }

  // ── 7. OK (usage handling done elsewhere) ─────────
  return {
    code: 'NETWORK_ERROR',
    message: '',
    httpStatus: status,
  };
}

// ─── Legacy compatibility ─────────────────────────────────

export function classifyApiErrorLegacy(
  response: Response | null,
  responseText: string,
  caughtError?: Error | string
): { code: string; message: string; providerMessage?: string; httpStatus?: number } {
  const result = classifyApiError(response, responseText, caughtError);
  return {
    code: mapToLegacyCode(result.code),
    message: result.message,
    providerMessage: result.providerMessage,
    httpStatus: result.httpStatus,
  };
}

function mapToLegacyCode(code: ApiErrorType): string {
  switch (code) {
    case 'HTTP_401':
    case 'KEY_EMPTY':
    case 'KEY_EXPIRED':
    case 'KEY_DISABLED':
    case 'KEY_WRONG_HOST':
    case 'KEY_NO_BALANCE':
    case 'KEY_NO_PERMISSION':
    case 'KEY_IP_RESTRICTED':
    case 'KEY_CONCURRENCY_LIMITED':
      return 'HTTP_401';
    case 'HTTP_403':
      return 'HTTP_403';
    case 'HTTP_404':
    case 'MODEL_NOT_FOUND':
    case 'MODEL_NOT_IN_GROUP':
    case 'MODEL_UNSUPPORTED':
    case 'CHANNEL_UNAVAILABLE':
    case 'MODEL_ALIAS_NOT_CONFIGURED':
    case 'MODELS_ENDPOINT_403':
      return 'HTTP_404';
    case 'HTTP_429':
      return 'HTTP_429';
    case 'HTTP_5XX':
      return 'HTTP_5XX';
    case 'NETWORK_ERROR':
    case 'SSL_ERROR':
    case 'CORS_ERROR':
    case 'HOST_UNREACHABLE':
    case 'HTML_RESPONSE':
    case 'CLOUDFLARE_BLOCK':
    case 'LOGIN_PAGE':
    case 'NON_JSON_RESPONSE':
      return 'NON_JSON_RESPONSE';
    default:
      return 'UNKNOWN_ERROR';
  }
}
