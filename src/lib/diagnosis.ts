/**
 * diagnosis.ts
 *
 * AI API Doctor — runs a multi-step diagnostic on an OpenAI-compatible API.
 * Every error has: title, message, suggestion, badge.
 * Does NOT log or expose the full API key anywhere.
 */

import {
  Provider,
  ApiKey,
  DiagnosisReport,
  DiagnosisStepResult,
  DiagnosisStatus,
  DiagnosisStepId,
  DiagnosisUsage,
  DiagnosisUsageSummary,
  ApiErrorType,
} from '../types';
import { maskApiKey } from './storage';
import { classifyApiError } from './apiError';

// ─── URL helpers ─────────────────────────────────────────

function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  url = url.replace(/\/+$/, ''); // Remove trailing slashes
  // Dedupe /v1/v1
  url = url.replace(/\/v1\/v1(\/|$)/, '/v1$1');
  // Ensure /v1 suffix
  if (!url.endsWith('/v1')) {
    url = url + '/v1';
  }
  return url;
}

function checkUrlProblems(raw: string): string[] {
  const issues: string[] = [];
  const url = raw.trim();

  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    issues.push('URL must start with http:// or https://');
  }
  if (url.startsWith('http://')) {
    issues.push('Using HTTP (not HTTPS) — credentials may be transmitted insecurely');
  }
  if (url.includes('/v1/v1')) {
    issues.push('URL contains duplicate /v1');
  }
  if (!url.includes('api') && !url.includes('v1')) {
    issues.push('URL may be a website instead of an API endpoint');
  }
  return issues;
}

// ─── Step builders ────────────────────────────────────────

function ok(
  id: DiagnosisStepId,
  title: string,
  message: string,
  extras: Partial<DiagnosisStepResult> = {}
): DiagnosisStepResult {
  return { id, title, status: 'success', message, ...extras };
}

function warn(
  id: DiagnosisStepId,
  title: string,
  message: string,
  extras: Partial<DiagnosisStepResult> = {}
): DiagnosisStepResult {
  return { id, title, status: 'warning', message, ...extras };
}

function err(
  id: DiagnosisStepId,
  title: string,
  message: string,
  extras: Partial<DiagnosisStepResult> = {}
): DiagnosisStepResult {
  return { id, title, status: 'error', message, ...extras };
}

function skip(
  id: DiagnosisStepId,
  title: string,
  message: string
): DiagnosisStepResult {
  return { id, title, status: 'skipped', message };
}

function overall(s: DiagnosisStepResult[]): DiagnosisStatus {
  if (s.some((x) => x.status === 'error')) return 'error';
  if (s.some((x) => x.status === 'warning')) return 'warning';
  return 'success';
}

// ─── Usage audit ─────────────────────────────────────────

function auditUsage(u: DiagnosisUsage | undefined): DiagnosisUsageSummary {
  if (!u || u.total_tokens === undefined) {
    return {
      status: 'missing',
      hasUsage: false,
      suspicious: false,
      note: 'No usage data in response. Token consumption cannot be audited.',
    };
  }

  const { prompt_tokens = 0, completion_tokens = 0, total_tokens = 0 } = u;
  const anomalies: string[] = [];

  // Very high total tokens for a short test
  if (total_tokens > 500) {
    anomalies.push(`total_tokens (${total_tokens}) is unusually high for a short test`);
  }

  // Completion tokens way over max_tokens
  if (completion_tokens > 50) {
    anomalies.push(
      `completion_tokens (${completion_tokens}) is very high — may exceed what was requested`
    );
  }

  // Very low prompt tokens for a short prompt
  if (prompt_tokens < 3 && total_tokens > 10) {
    anomalies.push(`prompt_tokens (${prompt_tokens}) seems too low for the response`);
  }

  const suspicious = anomalies.length > 0;
  const note = suspicious
    ? `Token usage looks unusual. ${anomalies.join('. ')}. Please compare with your provider dashboard.`
    : undefined;

  return {
    status: suspicious ? 'anomaly' : 'available',
    promptTokens: prompt_tokens,
    completionTokens: completion_tokens,
    totalTokens: total_tokens,
    reasoningTokens: u.reasoning_tokens,
    cachedTokens: u.cached_tokens,
    hasUsage: true,
    suspicious,
    note,
  };
}

// ─── Parse usage from response body ──────────────────────

function parseUsage(text: string): DiagnosisUsage | undefined {
  try {
    const json = JSON.parse(text);
    const u = json?.usage;
    if (u && typeof u === 'object') {
      return {
        prompt_tokens: typeof u['prompt_tokens'] === 'number' ? (u['prompt_tokens'] as number) : undefined,
        completion_tokens: typeof u['completion_tokens'] === 'number' ? (u['completion_tokens'] as number) : undefined,
        total_tokens: typeof u['total_tokens'] === 'number' ? (u['total_tokens'] as number) : undefined,
        reasoning_tokens: typeof u['reasoning_tokens'] === 'number' ? (u['reasoning_tokens'] as number) : undefined,
        cached_tokens: typeof u['cached_tokens'] === 'number' ? (u['cached_tokens'] as number) : undefined,
      };
    }
    // Some providers put usage at top level
    if (typeof json['total_tokens'] === 'number') {
      return {
        total_tokens: json['total_tokens'] as number,
        prompt_tokens: typeof json['prompt_tokens'] === 'number' ? (json['prompt_tokens'] as number) : undefined,
        completion_tokens: typeof json['completion_tokens'] === 'number' ? (json['completion_tokens'] as number) : undefined,
      };
    }
  } catch {
    // not JSON
  }
  return undefined;
}

// ─── Group permission 403 suggestion ──────────────────────

const SUGGESTION_GROUP_PERMISSION = `当前 Base URL 可达，API Key 也可能有效，但该 Key 没有权限访问当前模型或模型分组。
请检查中转站后台：
1. Key 是否属于正确分组
2. 该分组是否包含当前模型
3. 模型是否绑定了可用渠道
4. 渠道是否支持当前模型`;

// ─── Main runDiagnosis ───────────────────────────────────

export async function runDiagnosis(
  provider: Provider,
  apiKey: ApiKey,
  activeModelId?: string
): Promise<DiagnosisReport> {
  const steps: DiagnosisStepResult[] = [];
  const startTime = Date.now();
  const rawUrl = provider.baseUrl;
  const maskedKey = maskApiKey(apiKey.key);

  // ── Step 1: base_url_format ─────────────────────────
  {
    const urlProblems = checkUrlProblems(rawUrl);
    if (urlProblems.length > 0) {
      const isHttpWarning = urlProblems.some((p) => p.includes('HTTP'));
      const isHtmlWarning = urlProblems.some(
        (p) => p.includes('website') || p.includes('API')
      );
      if (isHtmlWarning) {
        steps.push(
          warn(
            'base_url_format',
            'Base URL Format',
            'URL may be a website instead of an API endpoint. ' + urlProblems.join('. '),
            { errorType: 'HTML_RESPONSE' }
          )
        );
      } else if (isHttpWarning) {
        steps.push(warn('base_url_format', 'Base URL Format', urlProblems.join('. ')));
      } else {
        steps.push(err('base_url_format', 'Base URL Format', urlProblems.join('. ')));
      }
    } else {
      steps.push(ok('base_url_format', 'Base URL Format', 'Base URL looks correct.'));
    }
  }

  // ── Step 2: key_present ─────────────────────────────
  {
    const keyVal = apiKey.key.trim();
    if (!keyVal) {
      steps.push(
        err('key_present', 'API Key', 'No API key provided.', { errorType: 'KEY_EMPTY' })
      );
      return buildReport(provider.name, maskedKey, activeModelId, startTime, steps);
    }
    // Check for obvious whitespace issues
    if (keyVal !== keyVal.trim() || /^\s|\s$/.test(keyVal)) {
      steps.push(
        warn(
          'key_present',
          'API Key',
          'API key has leading or trailing whitespace. Trimmed.',
          { errorType: 'KEY_EMPTY' }
        )
      );
    } else {
      steps.push(ok('key_present', 'API Key', 'API key is present.'));
    }
  }

  // ── Step 3: models_endpoint ───────────────────────────
  const modelsUrl = normalizeBaseUrl(rawUrl) + '/models';
  let modelsOk = false;
  let modelsUsage: DiagnosisUsage | undefined;
  {
    const t0 = Date.now();
    let rawResp: Response | null = null;
    let caught: Error | undefined;
    let respText = '';
    let status = 0;
    try {
      rawResp = await fetch(modelsUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey.key}` },
      });
      status = rawResp.status;
      respText = await rawResp.text();
    } catch (e) {
      caught = e as Error;
    }

    const classified = classifyApiError(rawResp, respText, caught);

    if (classified.code === 'HOST_UNREACHABLE') {
      steps.push(
        err('models_endpoint', 'Models Endpoint', classified.message, {
          errorType: classified.code,
          latencyMs: Date.now() - t0,
        })
      );
    } else if (classified.code === 'SSL_ERROR') {
      steps.push(
        err('models_endpoint', 'Models Endpoint', classified.message, {
          errorType: classified.code,
          latencyMs: Date.now() - t0,
        })
      );
    } else if (classified.code === 'CORS_ERROR') {
      steps.push(
        err('models_endpoint', 'Models Endpoint', classified.message, {
          errorType: classified.code,
          latencyMs: Date.now() - t0,
        })
      );
    } else if (classified.code === 'HTML_RESPONSE' || classified.code === 'LOGIN_PAGE' || classified.code === 'CLOUDFLARE_BLOCK') {
      steps.push(
        err('models_endpoint', 'Models Endpoint', classified.message, {
          errorType: classified.code,
          providerMessage: classified.providerMessage,
          httpStatus: status,
          latencyMs: Date.now() - t0,
          suggestion:
            'You may have entered a website URL instead of an API base URL. ' +
            'Please check the base URL. You can still manually enter a model ID and test chat completion.',
        })
      );
    } else if (classified.code === 'HTTP_401' || classified.code === 'KEY_EXPIRED' || classified.code === 'KEY_DISABLED') {
      steps.push(
        err('models_endpoint', 'Models Endpoint', classified.message, {
          errorType: classified.code as ApiErrorType,
          providerMessage: classified.providerMessage,
          httpStatus: status,
          latencyMs: Date.now() - t0,
          suggestion: 'Please check your API key — it may be invalid, expired, or disabled.',
        })
      );
    } else if (classified.code === 'KEY_NO_PERMISSION') {
      steps.push(
        warn('models_endpoint', 'Models Endpoint', classified.message, {
          errorType: 'KEY_NO_PERMISSION',
          providerMessage: classified.providerMessage,
          httpStatus: status,
          latencyMs: Date.now() - t0,
          suggestion:
            'Permission denied on /v1/models. ' +
            'Some relay providers restrict model listing. ' +
            'You can still manually enter a model ID and test chat completion.',
        })
      );
    } else if (classified.code === 'KEY_IP_RESTRICTED') {
      steps.push(
        warn('models_endpoint', 'Models Endpoint', classified.message, {
          errorType: 'KEY_IP_RESTRICTED',
          providerMessage: classified.providerMessage,
          httpStatus: status,
          latencyMs: Date.now() - t0,
          suggestion:
            'Your API key is restricted to specific IPs. ' +
            'Browser requests may not be allowed.',
        })
      );
    } else if (classified.code === 'HTTP_404' || classified.code === 'MODEL_NOT_FOUND') {
      steps.push(
        warn('models_endpoint', 'Models Endpoint', classified.message, {
          errorType: 'MODEL_UNSUPPORTED',
          providerMessage: classified.providerMessage,
          httpStatus: status,
          latencyMs: Date.now() - t0,
          suggestion:
            '/v1/models endpoint not found. ' +
            'This provider may not support model listing. ' +
            'You can still manually enter a model ID.',
        })
      );
    } else if (classified.code === 'HTTP_429' || classified.code === 'KEY_NO_BALANCE') {
      steps.push(
        warn('models_endpoint', 'Models Endpoint', classified.message, {
          errorType: 'KEY_NO_BALANCE',
          providerMessage: classified.providerMessage,
          httpStatus: status,
          latencyMs: Date.now() - t0,
          suggestion: 'Rate limited or quota exceeded. Try again later.',
        })
      );
    } else if (classified.code === 'HTTP_5XX') {
      steps.push(
        warn('models_endpoint', 'Models Endpoint', classified.message, {
          errorType: 'HTTP_5XX',
          providerMessage: classified.providerMessage,
          httpStatus: status,
          latencyMs: Date.now() - t0,
          suggestion: 'Provider server error. Try again later.',
        })
      );
    } else if (classified.code === 'NON_JSON_RESPONSE') {
      steps.push(
        warn('models_endpoint', 'Models Endpoint', classified.message, {
          errorType: 'NON_JSON_RESPONSE',
          providerMessage: classified.providerMessage,
          httpStatus: status,
          latencyMs: Date.now() - t0,
          suggestion: 'The endpoint returned non-standard data. Model listing may not be supported.',
        })
      );
    } else if (rawResp?.ok && respText) {
      // Try to parse as valid model list
      try {
        const parsed = JSON.parse(respText);
        const hasData = Array.isArray(parsed) || (parsed?.data && Array.isArray(parsed.data));
        if (hasData) {
          modelsOk = true;
          const modelCount = Array.isArray(parsed)
            ? parsed.length
            : (parsed as { data: unknown[] }).data.length;
          steps.push(
            ok('models_endpoint', 'Models Endpoint', `Models list accessible (${modelCount} models).`, {
              latencyMs: Date.now() - t0,
              httpStatus: status,
              modelCount,
            })
          );
        } else {
          steps.push(
            warn('models_endpoint', 'Models Endpoint', 'Unexpected response format.', {
              latencyMs: Date.now() - t0,
              httpStatus: status,
              errorType: 'NON_JSON_RESPONSE',
            })
          );
        }
      } catch {
        steps.push(
          warn('models_endpoint', 'Models Endpoint', 'Could not parse response as JSON.', {
            latencyMs: Date.now() - t0,
            httpStatus: status,
            errorType: 'NON_JSON_RESPONSE',
          })
        );
      }
    } else {
      steps.push(
        warn('models_endpoint', 'Models Endpoint', classified.message || 'Unexpected response.', {
          errorType: classified.code as ApiErrorType,
          providerMessage: classified.providerMessage,
          httpStatus: status,
          latencyMs: Date.now() - t0,
        })
      );
    }
  }

  // ── Step 4: model_selected ───────────────────────────
  {
    if (!activeModelId || !activeModelId.trim()) {
      steps.push(
        warn('model_selected', 'Model Selected', 'No model selected. Please choose or enter a model ID to test chat completion.', {
          errorType: 'MODEL_NOT_SELECTED',
        })
      );
      // Skip downstream steps
      steps.push(skip('chat_completion', 'Chat Completion', 'Skipped — no model selected.'));
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — chat completion not tested.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data available.'));
      return buildReport(provider.name, maskedKey, activeModelId, startTime, steps);
    } else {
      steps.push(
        ok('model_selected', 'Model Selected', `Using model: ${activeModelId}`)
      );
    }
  }

  // ── Step 5: chat_completion ─────────────────────────
  const chatUrl = normalizeBaseUrl(rawUrl) + '/chat/completions';
  let chatResp: Response | null = null;
  let chatText = '';
  let chatStatus = 0;
  let chatUsage: DiagnosisUsage | undefined;
  {
    const t0 = Date.now();
    let caught: Error | undefined;
    try {
      chatResp = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: activeModelId,
          messages: [{ role: 'user', content: 'Reply exactly: OK' }],
          max_tokens: 8,
          temperature: 0,
        }),
      });
      chatStatus = chatResp.status;
      chatText = await chatResp.text();
      chatUsage = parseUsage(chatText);
    } catch (e) {
      caught = e as Error;
    }

    const classified = classifyApiError(chatResp, chatText, caught);

    if (caught || classified.code === 'HOST_UNREACHABLE' || classified.code === 'SSL_ERROR' || classified.code === 'CORS_ERROR') {
      steps.push(
        err('chat_completion', 'Chat Completion', classified.message, {
          errorType: classified.code as ApiErrorType,
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus || undefined,
          latencyMs: Date.now() - t0,
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — chat completion failed.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    } else if (classified.code === 'HTML_RESPONSE' || classified.code === 'LOGIN_PAGE' || classified.code === 'CLOUDFLARE_BLOCK') {
      steps.push(
        err('chat_completion', 'Chat Completion', classified.message, {
          errorType: classified.code as ApiErrorType,
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus,
          latencyMs: Date.now() - t0,
          suggestion:
            'The URL may be a website instead of an API endpoint. ' +
            'Please check your base URL.',
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — chat completion failed.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    } else if (classified.code === 'HTTP_401' || classified.code === 'KEY_EXPIRED' || classified.code === 'KEY_DISABLED' || classified.code === 'KEY_WRONG_HOST') {
      steps.push(
        err('chat_completion', 'Chat Completion', classified.message, {
          errorType: classified.code as ApiErrorType,
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus,
          latencyMs: Date.now() - t0,
          suggestion:
            classified.code === 'KEY_WRONG_HOST'
              ? 'This API key belongs to a different site. Check that the base URL matches the key provider.'
              : classified.code === 'KEY_EXPIRED'
              ? 'API key has expired. Please use a valid, non-expired key.'
              : classified.code === 'KEY_DISABLED'
              ? 'API key has been disabled. Please enable or regenerate it.'
              : 'Please check your API key.',
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — chat completion failed.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    } else if (classified.code === 'KEY_NO_BALANCE') {
      steps.push(
        err('chat_completion', 'Chat Completion', classified.message, {
          errorType: 'KEY_NO_BALANCE',
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus,
          latencyMs: Date.now() - t0,
          suggestion: 'Insufficient balance or quota. Please top up your account.',
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — balance insufficient.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    } else if (classified.code === 'KEY_NO_PERMISSION' || classified.code === 'HTTP_403') {
      const isGroup = /无权访问|分组|模型组|GPT官方|group|permission|forbidden|无权/i.test(
        classified.providerMessage || ''
      );
      steps.push(
        err('chat_completion', 'Chat Completion', classified.message, {
          errorType: isGroup ? 'KEY_NO_PERMISSION' : 'HTTP_403',
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus,
          latencyMs: Date.now() - t0,
          suggestion: isGroup ? SUGGESTION_GROUP_PERMISSION : classified.providerMessage || 'Permission denied.',
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — permission denied.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    } else if (classified.code === 'KEY_IP_RESTRICTED') {
      steps.push(
        err('chat_completion', 'Chat Completion', classified.message, {
          errorType: 'KEY_IP_RESTRICTED',
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus,
          latencyMs: Date.now() - t0,
          suggestion: 'Your API key is restricted to specific IPs. Browser requests may not be allowed.',
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — IP restricted.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    } else if (classified.code === 'KEY_CONCURRENCY_LIMITED') {
      steps.push(
        err('chat_completion', 'Chat Completion', classified.message, {
          errorType: 'KEY_CONCURRENCY_LIMITED',
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus,
          latencyMs: Date.now() - t0,
          suggestion: 'Concurrency limit reached. Wait for other requests to finish and retry.',
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — concurrency limited.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    } else if (classified.code === 'MODEL_NOT_FOUND') {
      steps.push(
        err('chat_completion', 'Chat Completion', classified.message, {
          errorType: 'MODEL_NOT_FOUND',
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus,
          latencyMs: Date.now() - t0,
          suggestion:
            'Model not found. Please check:\n' +
            '1. Model ID spelling\n' +
            '2. Model is in your key group\n' +
            '3. Model has an active channel',
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — model not found.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    } else if (classified.code === 'CHANNEL_UNAVAILABLE') {
      steps.push(
        err('chat_completion', 'Chat Completion', classified.message, {
          errorType: 'CHANNEL_UNAVAILABLE',
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus,
          latencyMs: Date.now() - t0,
          suggestion:
            'Model channel unavailable. Please check:\n' +
            '1. The channel bound to this model is online\n' +
            '2. The channel has sufficient quota',
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — channel unavailable.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    } else if (classified.code === 'HTTP_404') {
      steps.push(
        err('chat_completion', 'Chat Completion', classified.message, {
          errorType: 'HTTP_404',
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus,
          latencyMs: Date.now() - t0,
          suggestion: 'The /chat/completions endpoint was not found. Check the base URL.',
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — endpoint not found.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    } else if (classified.code === 'HTTP_429') {
      steps.push(
        warn('chat_completion', 'Chat Completion', classified.message, {
          errorType: 'HTTP_429',
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus,
          latencyMs: Date.now() - t0,
          suggestion: 'Rate limited. Wait and try again.',
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — rate limited.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    } else if (classified.code === 'HTTP_5XX') {
      steps.push(
        warn('chat_completion', 'Chat Completion', classified.message, {
          errorType: 'HTTP_5XX',
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus,
          latencyMs: Date.now() - t0,
          suggestion: 'Provider server error. Try again later.',
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — server error.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    } else if (classified.code === 'HTTP_400') {
      steps.push(
        err('chat_completion', 'Chat Completion', classified.message, {
          errorType: 'HTTP_400',
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus,
          latencyMs: Date.now() - t0,
          suggestion: 'Bad request. Check the model ID and request format.',
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — bad request.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    } else if (chatResp?.ok) {
      // Success!
      const latency = Date.now() - t0;
      steps.push(
        ok('chat_completion', 'Chat Completion', `Chat completion works (${latency}ms).`, {
          latencyMs: latency,
          httpStatus: chatStatus,
          usage: chatUsage,
        })
      );
    } else {
      // Fallback for any unclassified failure
      steps.push(
        err('chat_completion', 'Chat Completion', classified.message || `HTTP ${chatStatus} failed.`, {
          errorType: classified.code as ApiErrorType,
          providerMessage: classified.providerMessage,
          httpStatus: chatStatus,
          latencyMs: Date.now() - t0,
        })
      );
      steps.push(skip('usage_reported', 'Usage Reported', 'Skipped — chat failed.'));
      steps.push(skip('usage_audit', 'Usage Audit', 'Skipped — no usage data.'));
    }
  }

  // ── Step 6: usage_reported ───────────────────────────
  {
    if (chatUsage && chatUsage.total_tokens !== undefined) {
      steps.push(
        ok('usage_reported', 'Usage Reported', `usage: prompt=${chatUsage.prompt_tokens ?? '?'} completion=${chatUsage.completion_tokens ?? '?'} total=${chatUsage.total_tokens}`, {
          usage: chatUsage,
        })
      );
    } else if (chatStatus > 0) {
      steps.push(
        warn('usage_reported', 'Usage not reported', 'This provider did not return usage data. Token consumption cannot be audited from the response.', {
          errorType: 'USAGE_MISSING',
          httpStatus: chatStatus,
        })
      );
    } else {
      steps.push(skip('usage_reported', 'Usage Reported', 'Chat completion was not tested.'));
    }
  }

  // ── Step 7: usage_audit ───────────────────────────────
  {
    if (chatUsage) {
      const audit = auditUsage(chatUsage);
      if (audit.suspicious) {
        steps.push(
          warn('usage_audit', 'Usage Audit', audit.note || 'Token usage looks unusual.', {
            errorType: 'USAGE_ANOMALY_HIGH',
            usage: chatUsage,
          })
        );
      } else {
        steps.push(
          ok('usage_audit', 'Usage Audit', 'Token usage appears normal for this test.', {
            usage: chatUsage,
          })
        );
      }
    } else {
      steps.push(skip('usage_audit', 'Usage Audit', 'No usage data to audit.'));
    }
  }

  return buildReport(provider.name, maskedKey, activeModelId, startTime, steps);
}

// ─── Build report ─────────────────────────────────────────

function buildReport(
  providerName: string,
  maskedKey: string,
  activeModelId: string | undefined,
  startTime: number,
  steps: DiagnosisStepResult[]
): DiagnosisReport {
  const totalLatencyMs = Date.now() - startTime;
  const passedCount = steps.filter(
    (s) => s.status === 'success' || s.status === 'skipped'
  ).length;
  const overallStatus = overall(steps);

  // Determine usage summary status:
  // - skipped if chat_completion was skipped (no model selected)
  // - otherwise let auditUsage compute from the actual usage
  const chatStep = steps.find((s) => s.id === 'chat_completion');
  const chatSkipped = chatStep?.status === 'skipped';

  let usageSummary: DiagnosisUsageSummary;
  if (chatSkipped) {
    usageSummary = {
      status: 'skipped',
      hasUsage: false,
      suspicious: false,
      note: undefined,
    };
  } else {
    usageSummary = auditUsage(chatStep?.usage);
  }

  return {
    providerName,
    maskedKey,
    activeModelId,
    startedAt: new Date(startTime).toISOString(),
    totalLatencyMs,
    overallStatus,
    passedCount,
    totalCount: steps.length,
    steps,
    usageSummary,
  };
}
