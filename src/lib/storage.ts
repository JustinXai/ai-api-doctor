/**
 * storage.ts
 *
 * AI API Doctor — MVP single-config storage layer.
 * Uses ActiveConfig as primary data model.
 * Legacy Provider/ApiKey functions kept for migration compatibility.
 */

import {
  Provider,
  ApiKey,
  ActiveConfig,
  ConfigSource,
  ExtensionSettings,
  ConnectivityTestResult,
  ApiError,
  ApiErrorCode,
  DiagnosisReport,
  DiagnosisStepResult,
  DiagnosisStatus,
  DiagnosisUsage,
  DiagnosisUsageSummary,
  ApiErrorType,
  BalanceSnapshot,
  BillingProbeResult,
  BillingAnomalyReport,
  BillingAnomalySummary,
  RawQuotaBalance,
  RawQuotaTimeline,
  BillingJudgment,
  BillingJudgmentLevel,
  BillingJudgmentCode,
  OutputSignal,
  BillingDiagnosisReport,
  DiagnosisProgress,
  DiagnosisProgressStep,
} from '../types';
import { DEFAULT_SETTINGS, EXAMPLE_PROVIDER } from './defaults';
import { ensureHostPermission } from './permissions';

// ─── Storage keys ────────────────────────────────────────────

const STORAGE_KEYS = {
  ACTIVE_CONFIG: 'activeConfig',
  PROVIDERS: 'providers',
  API_KEYS: 'apiKeys',
  ACTIVE_PROVIDER: 'activeProviderId',
  ACTIVE_MODEL: 'activeModelId',
  SETTINGS: 'settings',
  LANGUAGE: 'language',
} as const;

type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

async function getFromStorage<T>(key: StorageKey): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key] as T | null);
    });
  });
}

async function setToStorage<T>(key: StorageKey, value: T): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

// ─── ActiveConfig (MVP primary model) ─────────────────────

export async function getActiveConfig(): Promise<ActiveConfig | null> {
  const config = await getFromStorage<ActiveConfig>(STORAGE_KEYS.ACTIVE_CONFIG);
  return config || null;
}

export async function saveActiveConfig(config: ActiveConfig): Promise<void> {
  await setToStorage(STORAGE_KEYS.ACTIVE_CONFIG, config);
}

export async function updateActiveConfig(updates: Partial<ActiveConfig>): Promise<ActiveConfig> {
  const existing = await getActiveConfig();
  const updated: ActiveConfig = {
    providerName: updates.providerName ?? existing?.providerName ?? '',
    baseUrl: updates.baseUrl ?? existing?.baseUrl ?? '',
    apiKey: updates.apiKey ?? existing?.apiKey ?? '',
    modelId: updates.modelId ?? existing?.modelId ?? '',
    source: updates.source ?? existing?.source ?? 'custom',
    updatedAt: new Date().toISOString(),
  };
  await saveActiveConfig(updated);
  return updated;
}

export async function clearActiveConfig(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(STORAGE_KEYS.ACTIVE_CONFIG, resolve);
  });
}

export async function updateActiveModelId(modelId: string): Promise<void> {
  const existing = await getActiveConfig();
  if (existing) {
    await saveActiveConfig({ ...existing, modelId, updatedAt: new Date().toISOString() });
  }
}

// ─── Connection Input Parser ────────────────────────────────

interface ParseResult {
  baseUrl?: string;
  apiKey?: string;
  providerName?: string;
  source?: ConfigSource;
  hint?: string; // lightweight suggestion for the user
}

function tryParseNewApiJson(input: string): ParseResult | null {
  try {
    const obj = JSON.parse(input) as Record<string, unknown>;
    // Detect New API format
    const isNewApi =
      obj._type === 'newapi_channel_conn' ||
      (obj.key && (obj.url || obj.baseUrl || obj.base_url || obj.endpoint));

    if (!isNewApi) return null;

    // Find key — support multiple field names
    const rawKey = (obj.key ?? obj.apiKey ?? obj.api_key ?? obj.token) as string | undefined;
    if (!rawKey || typeof rawKey !== 'string') return null;

    // Find URL — support multiple field names
    const rawUrl = (obj.url ?? obj.baseUrl ?? obj.base_url ?? obj.endpoint) as string | undefined;
    if (!rawUrl || typeof rawUrl !== 'string') return null;

    const normalized = normalizeBaseUrl(rawUrl);
    const hint =
      rawUrl === normalized ? undefined : `This URL may be missing /v1. Suggested: ${normalized}. You can edit it manually.`;

    return {
      apiKey: rawKey.trim(),
      baseUrl: normalized,
      providerName: undefined, // user fills this
      source: 'newapi',
      hint,
    };
  } catch {
    return null;
  }
}

function tryParsePlainUrl(input: string): ParseResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;
  try {
    new URL(trimmed); // validate URL
    const normalized = normalizeBaseUrl(trimmed);
    const hint =
      trimmed === normalized
        ? undefined
        : `This URL may be missing /v1. Suggested: ${normalized}. You can edit it manually.`;
    return { baseUrl: normalized, hint };
  } catch {
    return null;
  }
}

function tryParsePlainKey(input: string): ParseResult | null {
  const trimmed = input.trim();
  // Match common API key prefixes
  if (/^(sk-|sk4-|ak-|og-|gsk_)/i.test(trimmed)) {
    return { apiKey: trimmed };
  }
  return null;
}

export interface ConnectionParseResult {
  success: boolean;
  baseUrl?: string;
  apiKey?: string;
  providerName?: string;
  hint?: string;
}

export function parseConnectionInput(input: string): ConnectionParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { success: false };

  // Try 1: New API JSON
  const jsonResult = tryParseNewApiJson(trimmed);
  if (jsonResult) {
    return { success: true, ...jsonResult };
  }

  // Try 2: Plain URL
  const urlResult = tryParsePlainUrl(trimmed);
  if (urlResult) {
    return { success: true, ...urlResult };
  }

  // Try 3: Plain API key
  const keyResult = tryParsePlainKey(trimmed);
  if (keyResult) {
    return { success: true, ...keyResult };
  }

  return { success: false };
}

// ─── Base URL normalization ────────────────────────────────

function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  url = url.replace(/\/+$/, ''); // Remove trailing slashes
  url = url.replace(/\/v1\/v1(\/|$)/, '/v1$1'); // Fix /v1/v1
  if (!url.endsWith('/v1')) {
    url = url + '/v1';
  }
  return url;
}

// ─── Legacy Provider / ApiKey functions ────────────────────
// Kept for migration compatibility — do NOT use in new MVP flow

export async function getProviders(): Promise<Provider[]> {
  const providers = await getFromStorage<Provider[]>(STORAGE_KEYS.PROVIDERS);
  return providers || [];
}

export async function saveProviders(providers: Provider[]): Promise<void> {
  await setToStorage(STORAGE_KEYS.PROVIDERS, providers);
}

export async function addProvider(provider: Provider): Promise<void> {
  const providers = await getProviders();
  providers.push(provider);
  await saveProviders(providers);
}

export async function addExampleProvider(): Promise<Provider> {
  const providers = await getProviders();
  const existing = providers.find((p) => p.id === EXAMPLE_PROVIDER.id);
  if (existing) return existing;
  await saveProviders([...providers, EXAMPLE_PROVIDER]);
  return EXAMPLE_PROVIDER;
}

export async function updateProvider(id: string, updates: Partial<Provider>): Promise<void> {
  const providers = await getProviders();
  const index = providers.findIndex((p) => p.id === id);
  if (index !== -1) {
    providers[index] = { ...providers[index], ...updates };
    await saveProviders(providers);
  }
}

export async function deleteProvider(id: string): Promise<void> {
  const providers = await getProviders();
  await saveProviders(providers.filter((p) => p.id !== id));
}

export async function getActiveProvider(): Promise<Provider | null> {
  const activeId = await getFromStorage<string>(STORAGE_KEYS.ACTIVE_PROVIDER);
  if (!activeId) return null;
  const providers = await getProviders();
  return providers.find((p) => p.id === activeId) || null;
}

export async function setActiveProvider(id: string): Promise<void> {
  await setToStorage(STORAGE_KEYS.ACTIVE_PROVIDER, id);
}

export async function getApiKeys(): Promise<ApiKey[]> {
  const keys = await getFromStorage<ApiKey[]>(STORAGE_KEYS.API_KEYS);
  return keys || [];
}

export async function saveApiKeys(keys: ApiKey[]): Promise<void> {
  await setToStorage(STORAGE_KEYS.API_KEYS, keys);
}

export async function addApiKey(key: ApiKey): Promise<void> {
  const keys = await getApiKeys();
  keys.push(key);
  await saveApiKeys(keys);
}

export async function deleteApiKey(id: string): Promise<void> {
  const keys = await getApiKeys();
  await saveApiKeys(keys.filter((k) => k.id !== id));
}

export async function getActiveApiKey(providerId: string): Promise<ApiKey | null> {
  const keys = await getApiKeys();
  return keys.find((k) => k.providerId === providerId) || null;
}

export async function getActiveModelId(): Promise<string> {
  const id = await getFromStorage<string>(STORAGE_KEYS.ACTIVE_MODEL);
  return id || '';
}

export async function setActiveModelId(modelId: string): Promise<void> {
  await setToStorage(STORAGE_KEYS.ACTIVE_MODEL, modelId);
}

export async function clearActiveModelId(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(STORAGE_KEYS.ACTIVE_MODEL, resolve);
  });
}

// ─── Settings ──────────────────────────────────────────────

export async function getSettings(): Promise<ExtensionSettings> {
  const settings = await getFromStorage<ExtensionSettings>(STORAGE_KEYS.SETTINGS);
  return settings || DEFAULT_SETTINGS;
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await setToStorage(STORAGE_KEYS.SETTINGS, settings);
}

export async function clearAllLocalData(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.clear(resolve);
  });
}

// ─── Language ──────────────────────────────────────────────

export async function getLanguage(): Promise<'auto' | 'zh-CN' | 'en-US'> {
  const lang = await getFromStorage<string>(STORAGE_KEYS.LANGUAGE);
  if (lang === 'zh-CN' || lang === 'en-US' || lang === 'auto') return lang;
  return 'auto';
}

export async function setLanguage(lang: 'auto' | 'zh-CN' | 'en-US'): Promise<void> {
  await setToStorage(STORAGE_KEYS.LANGUAGE, lang);
}

// ─── Clipboard ──────────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'COPY_TO_CLIPBOARD', text }, (result) => {
      if (chrome.runtime.lastError) {
        navigator.clipboard.writeText(text).then(resolve).catch(reject);
      } else {
        resolve();
      }
    });
  });
}

// ─── Utilities ──────────────────────────────────────────────

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  const prefix = key.substring(0, 3);
  const suffix = key.substring(key.length - 4);
  return `${prefix}****${suffix}`;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function exportToJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// ─── fetchModels (using baseUrl + apiKey directly) ──────────

export async function fetchModels(
  baseUrl: string,
  apiKey: string
): Promise<{ id: string; name: string }[]> {
  // Request host permission before making the request
  const perm = await ensureHostPermission(baseUrl);
  if (!perm.granted) {
    throw { code: 'HOST_PERMISSION_DENIED' as ApiErrorCode, message: 'The browser has not granted access to this API host. Run diagnosis again and allow access to continue.' };
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    throw classifyNetworkError(err as Error);
  }

  const rawText = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    throw classifyHttpError(response.status, rawText);
  }
  if (!contentType.includes('application/json')) {
    throw { code: 'NON_JSON_RESPONSE' as ApiErrorCode, message: 'Server returned non-JSON.' };
  }

  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw { code: 'NON_JSON_RESPONSE' as ApiErrorCode, message: 'Failed to parse model response.' };
  }

  if (Array.isArray(data)) {
    return data.map((item) => {
      if (typeof item === 'string') return { id: item, name: item };
      return { id: (item as { id?: string }).id || String(item), name: (item as { id?: string }).id || String(item) };
    });
  }

  if (typeof data === 'object' && data !== null && 'data' in data) {
    const d = data as { data: unknown[] };
    return d.data.map((item) => {
      if (typeof item === 'string') return { id: item, name: item };
      return { id: (item as { id?: string }).id || String(item), name: (item as { id?: string }).id || String(item) };
    });
  }

  throw { code: 'NON_JSON_RESPONSE' as ApiErrorCode, message: 'Unrecognized model response format.' };
}

// ─── Error classification ──────────────────────────────────

function classifyHttpError(status: number, bodyText: string): ApiError {
  let providerMessage: string | undefined;
  try {
    const parsed = JSON.parse(bodyText);
    providerMessage =
      parsed?.error?.message || parsed?.message || parsed?.detail || parsed?.error || undefined;
    if (typeof providerMessage === 'object') providerMessage = JSON.stringify(providerMessage);
  } catch {
    if (bodyText && bodyText.length > 0) providerMessage = bodyText.slice(0, 200);
  }

  switch (status) {
    case 401: return { code: 'HTTP_401', message: 'API key is invalid or missing.', providerMessage, httpStatus: status };
    case 403: return { code: 'HTTP_403', message: 'Permission denied.', providerMessage, httpStatus: status };
    case 404: return { code: 'HTTP_404', message: 'Endpoint not found.', providerMessage, httpStatus: status };
    case 429: return { code: 'HTTP_429', message: 'Rate limited.', providerMessage, httpStatus: status };
    default:
      if (status >= 500) return { code: 'HTTP_5XX', message: `Server error (HTTP ${status}).`, providerMessage, httpStatus: status };
      return { code: 'UNKNOWN_ERROR', message: `Request failed (HTTP ${status}).`, providerMessage, httpStatus: status };
  }
}

function classifyNetworkError(cause: string | Error): ApiError {
  const msg = cause instanceof Error ? cause.message : cause;
  const lower = msg.toLowerCase();
  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('dns') || lower.includes('erefused') || lower.includes('timeout') || lower.includes('net::')) {
    return { code: 'NETWORK_ERROR', message: 'Network error — could not reach the API server.' };
  }
  if (lower.includes('cors') || lower.includes('access-control')) {
    return { code: 'NETWORK_ERROR', message: 'CORS error — the server blocked the request.' };
  }
  return { code: 'NETWORK_ERROR', message: `Network error: ${msg}` };
}

// ─── testConnectivity (direct baseUrl + apiKey) ───────────

export async function testConnectivity(
  baseUrl: string,
  apiKey: string,
  modelId?: string
): Promise<ConnectivityTestResult> {
  const startTime = Date.now();
  if (modelId) return testChatCompletion(baseUrl, apiKey, modelId, startTime);
  return testModelsEndpoint(baseUrl, apiKey, startTime);
}

async function testModelsEndpoint(
  baseUrl: string,
  apiKey: string,
  startTime: number
): Promise<ConnectivityTestResult> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    return { success: false, error: classifyNetworkError(err as Error), timestamp: Date.now() };
  }
  const latency = Date.now() - startTime;
  const rawText = await response.text();
  if (response.ok) return { success: true, latency, timestamp: Date.now() };
  return { success: false, error: classifyHttpError(response.status, rawText), latency, timestamp: Date.now() };
}

async function testChatCompletion(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  startTime: number
): Promise<ConnectivityTestResult> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
    });
  } catch (err) {
    return { success: false, error: classifyNetworkError(err as Error), timestamp: Date.now(), activeModelId: modelId };
  }
  const latency = Date.now() - startTime;
  const rawText = await response.text();
  if (response.ok) return { success: true, latency, timestamp: Date.now(), activeModelId: modelId };
  return { success: false, error: classifyHttpError(response.status, rawText), latency, timestamp: Date.now(), activeModelId: modelId };
}

// ─── runDiagnosis (using ActiveConfig) ────────────────────

export async function runDiagnosis(config: ActiveConfig): Promise<DiagnosisReport> {
  const steps: DiagnosisStepResult[] = [];
  const startTime = Date.now();
  const maskedKey = maskApiKey(config.apiKey);
  const rawUrl = config.baseUrl;

  // Step 0: Request host permission for the base URL origin
  const perm = await ensureHostPermission(rawUrl);
  if (!perm.granted) {
    // Return a report with a permission error as first step
    steps.push({
      id: 'base_url_format',
      title: 'Host Permission',
      status: 'error',
      message: 'The browser has not granted access to this API host. Run diagnosis again and allow access to continue.',
      suggestion: 'Please grant permission when prompted and run diagnosis again.',
    });
    return buildReport(config.providerName, maskedKey, config.modelId, startTime, steps);
  }

  // Step 1: base_url_format
  {
    const normalized = normalizeBaseUrl(rawUrl);
    const issues: string[] = [];
    if (!rawUrl.startsWith('https://') && !rawUrl.startsWith('http://')) {
      issues.push('URL must start with http:// or https://');
    }
    if (rawUrl.startsWith('http://')) {
      issues.push('Using HTTP — credentials may be transmitted insecurely');
    }
    if (issues.length > 0) {
      steps.push({ id: 'base_url_format', title: 'Base URL Format', status: 'error', message: issues.join('. ') });
    } else {
      steps.push({ id: 'base_url_format', title: 'Base URL Format', status: 'success', message: 'Base URL looks correct.' });
    }
  }

  // Step 2: key_present
  {
    const keyVal = config.apiKey.trim();
    if (!keyVal) {
      steps.push({ id: 'key_present', title: 'API Key', status: 'error', message: 'No API key provided.' });
      return buildReport(config.providerName, maskedKey, config.modelId, startTime, steps);
    }
    steps.push({ id: 'key_present', title: 'API Key', status: 'success', message: 'API key is present.' });
  }

  // Step 3: models_endpoint
  const modelsUrl = normalizeBaseUrl(rawUrl) + '/models';
  let modelsOk = false;
  {
    const t0 = Date.now();
    let resp: Response | null = null;
    let caught: Error | undefined;
    let respText = '';
    let status = 0;
    try {
      resp = await fetch(modelsUrl, { method: 'GET', headers: { Authorization: `Bearer ${config.apiKey}` } });
      status = resp.status;
      respText = await resp.text();
    } catch (e) {
      caught = e as Error;
    }

    const classified = classifyApiError(resp, respText, caught);

    if (classified.code === 'HOST_UNREACHABLE' || classified.code === 'SSL_ERROR' || classified.code === 'CORS_ERROR') {
      steps.push({ id: 'models_endpoint', title: 'Models Endpoint', status: 'error', message: classified.message, latencyMs: Date.now() - t0 });
    } else if (classified.code === 'HTML_RESPONSE' || classified.code === 'CLOUDFLARE_BLOCK' || classified.code === 'LOGIN_PAGE') {
      steps.push({
        id: 'models_endpoint', title: 'Models Endpoint', status: 'error',
        message: classified.message, httpStatus: status, latencyMs: Date.now() - t0,
        suggestion: 'The URL may be a website instead of an API endpoint.',
      });
    } else if (classified.code === 'HTTP_401' || classified.code === 'KEY_EXPIRED' || classified.code === 'KEY_DISABLED') {
      steps.push({ id: 'models_endpoint', title: 'Models Endpoint', status: 'error', message: classified.message, httpStatus: status, latencyMs: Date.now() - t0, suggestion: 'Please check your API key.' });
    } else if (classified.code === 'HTTP_404') {
      steps.push({ id: 'models_endpoint', title: 'Models Endpoint', status: 'warning', message: classified.message, httpStatus: status, latencyMs: Date.now() - t0, suggestion: '/v1/models not found. Some relay providers do not support it.' });
    } else if (resp?.ok && respText) {
      try {
        const parsed = JSON.parse(respText);
        const hasData = Array.isArray(parsed) || (parsed?.data && Array.isArray((parsed as { data: unknown[] }).data));
        if (hasData) {
          modelsOk = true;
          const count = Array.isArray(parsed) ? parsed.length : ((parsed as { data: unknown[] }).data.length);
          steps.push({ id: 'models_endpoint', title: 'Models Endpoint', status: 'success', message: `Models list accessible (${count} models).`, httpStatus: status, latencyMs: Date.now() - t0, modelCount: count });
        } else {
          steps.push({ id: 'models_endpoint', title: 'Models Endpoint', status: 'warning', message: 'Unexpected response format.', httpStatus: status, latencyMs: Date.now() - t0 });
        }
      } catch {
        steps.push({ id: 'models_endpoint', title: 'Models Endpoint', status: 'warning', message: 'Could not parse response as JSON.', httpStatus: status, latencyMs: Date.now() - t0 });
      }
    } else {
      steps.push({ id: 'models_endpoint', title: 'Models Endpoint', status: 'warning', message: classified.message, httpStatus: status, latencyMs: Date.now() - t0 });
    }
  }

  // Step 4: model_selected
  {
    if (!config.modelId || !config.modelId.trim()) {
      steps.push({ id: 'model_selected', title: 'Model Selected', status: 'warning', message: 'No model selected.' });
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'skipped', message: 'Skipped — no model selected.' });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped — chat completion not tested.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped — no usage data.' });
      return buildReport(config.providerName, maskedKey, undefined, startTime, steps);
    }
    steps.push({ id: 'model_selected', title: 'Model Selected', status: 'success', message: `Using: ${config.modelId}` });
  }

  // Step 5: chat_completion
  const chatUrl = normalizeBaseUrl(rawUrl) + '/chat/completions';
  let chatUsage: DiagnosisUsage | undefined;
  {
    const t0 = Date.now();
    let resp: Response | null = null;
    let caught: Error | undefined;
    let respText = '';
    let status = 0;
    try {
      resp = await fetch(chatUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.modelId, messages: [{ role: 'user', content: 'Reply exactly: OK' }], max_tokens: 8, temperature: 0 }),
      });
      status = resp.status;
      respText = await resp.text();
      chatUsage = parseUsage(respText);
    } catch (e) {
      caught = e as Error;
    }

    const classified = classifyApiError(resp, respText, caught);

    if (caught || classified.code === 'HOST_UNREACHABLE' || classified.code === 'SSL_ERROR' || classified.code === 'CORS_ERROR') {
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'error', message: classified.message, httpStatus: status || undefined, latencyMs: Date.now() - t0 });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped — chat completion failed.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped — no usage data.' });
    } else if (classified.code === 'HTML_RESPONSE' || classified.code === 'CLOUDFLARE_BLOCK' || classified.code === 'LOGIN_PAGE') {
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'error', message: classified.message, httpStatus: status, latencyMs: Date.now() - t0, suggestion: 'The URL may be a website instead of an API endpoint.' });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped — chat completion failed.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped — no usage data.' });
    } else if (classified.code === 'HTTP_401' || classified.code === 'KEY_EXPIRED' || classified.code === 'KEY_DISABLED' || classified.code === 'KEY_WRONG_HOST') {
      const suggestion = classified.code === 'KEY_WRONG_HOST'
        ? 'This API key belongs to a different site.'
        : classified.code === 'KEY_EXPIRED' ? 'API key has expired.'
        : classified.code === 'KEY_DISABLED' ? 'API key has been disabled.'
        : 'Please check your API key.';
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'error', message: classified.message, providerMessage: classified.providerMessage, httpStatus: status, latencyMs: Date.now() - t0, suggestion });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped — chat completion failed.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped — no usage data.' });
    } else if (classified.code === 'KEY_NO_PERMISSION' || classified.code === 'HTTP_403') {
      const isGroup = /无权访问|分组|模型组|GPT官方|group|permission|forbidden/i.test(classified.providerMessage || '');
      const suggestion = isGroup
        ? 'Please check: 1. Key is in the correct group. 2. The group includes the current model. 3. The model has an active channel. 4. The channel supports the model.'
        : classified.providerMessage || 'Permission denied.';
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'error', message: classified.message, providerMessage: classified.providerMessage, httpStatus: status, latencyMs: Date.now() - t0, suggestion });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped — permission denied.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped — no usage data.' });
    } else if (classified.code === 'KEY_IP_RESTRICTED') {
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'error', message: classified.message, providerMessage: classified.providerMessage, httpStatus: status, latencyMs: Date.now() - t0, suggestion: 'Your API key is restricted to specific IPs.' });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped.' });
    } else if (classified.code === 'KEY_NO_BALANCE') {
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'error', message: classified.message, providerMessage: classified.providerMessage, httpStatus: status, latencyMs: Date.now() - t0, suggestion: 'Insufficient balance.' });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped.' });
    } else if (classified.code === 'KEY_CONCURRENCY_LIMITED') {
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'error', message: classified.message, providerMessage: classified.providerMessage, httpStatus: status, latencyMs: Date.now() - t0, suggestion: 'Concurrency limit reached.' });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped.' });
    } else if (classified.code === 'MODEL_NOT_FOUND') {
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'error', message: classified.message, providerMessage: classified.providerMessage, httpStatus: status, latencyMs: Date.now() - t0, suggestion: 'Model not found. Check: 1. Spelling. 2. Model is in key group. 3. Channel is online.' });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped.' });
    } else if (classified.code === 'CHANNEL_UNAVAILABLE') {
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'error', message: classified.message, providerMessage: classified.providerMessage, httpStatus: status, latencyMs: Date.now() - t0, suggestion: 'Channel unavailable.' });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped.' });
    } else if (classified.code === 'HTTP_404') {
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'error', message: classified.message, providerMessage: classified.providerMessage, httpStatus: status, latencyMs: Date.now() - t0, suggestion: 'Endpoint not found.' });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped.' });
    } else if (classified.code === 'HTTP_429') {
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'warning', message: classified.message, providerMessage: classified.providerMessage, httpStatus: status, latencyMs: Date.now() - t0, suggestion: 'Rate limited.' });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped.' });
    } else if (classified.code === 'HTTP_5XX') {
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'warning', message: classified.message, providerMessage: classified.providerMessage, httpStatus: status, latencyMs: Date.now() - t0, suggestion: 'Server error.' });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped.' });
    } else if (resp?.ok) {
      const latency = Date.now() - t0;
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'success', message: `Chat works (${latency}ms).`, httpStatus: status, latencyMs: latency, usage: chatUsage });
    } else {
      steps.push({ id: 'chat_completion', title: 'Chat Completion', status: 'error', message: classified.message || `HTTP ${status} failed.`, providerMessage: classified.providerMessage, httpStatus: status, latencyMs: Date.now() - t0 });
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'skipped', message: 'Skipped.' });
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'Skipped.' });
    }
  }

  // Step 6: usage_reported
  {
    if (chatUsage && chatUsage.total_tokens !== undefined) {
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'success', message: `usage: prompt=${chatUsage.prompt_tokens ?? '?'} completion=${chatUsage.completion_tokens ?? '?'} total=${chatUsage.total_tokens}`, usage: chatUsage });
    } else {
      steps.push({ id: 'usage_reported', title: 'Usage Reported', status: 'warning', message: 'No usage data in response.' });
    }
  }

  // Step 7: usage_audit
  {
    if (chatUsage) {
      const audit = auditUsage(chatUsage);
      if (audit.suspicious) {
        steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'warning', message: audit.note || 'Token usage looks unusual.', usage: chatUsage });
      } else {
        steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'success', message: 'Token usage appears normal.', usage: chatUsage });
      }
    } else {
      steps.push({ id: 'usage_audit', title: 'Usage Audit', status: 'skipped', message: 'No usage data to audit.' });
    }
  }

  return buildReport(config.providerName, maskedKey, config.modelId, startTime, steps);
}

// ─── Diagnosis helpers ─────────────────────────────────────

function classifyApiError(
  resp: Response | null,
  respText: string,
  caught: Error | undefined
): { code: string; message: string; providerMessage?: string } {
  if (caught) {
    const msg = caught.message.toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('dns') || msg.includes('erefused') || msg.includes('timeout') || msg.includes('net::')) {
      return { code: 'HOST_UNREACHABLE', message: 'Network error — could not reach the API server.' };
    }
    if (msg.includes('cors') || msg.includes('access-control')) {
      return { code: 'CORS_ERROR', message: 'CORS error — the server blocked the request.' };
    }
    return { code: 'NETWORK_ERROR', message: `Network error: ${caught.message}` };
  }

  const status = resp?.status || 0;
  let providerMessage: string | undefined;
  try {
    const parsed = JSON.parse(respText);
    providerMessage = parsed?.error?.message || parsed?.message || parsed?.detail || parsed?.error || undefined;
    if (typeof providerMessage === 'object') providerMessage = JSON.stringify(providerMessage);
  } catch {
    if (respText && respText.length > 0) providerMessage = respText.slice(0, 200);
  }

  const trimmed = respText.trim();
  if (status === 0 || !resp) return { code: 'HOST_UNREACHABLE', message: 'Could not connect to the server.' };
  if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
    if (trimmed.includes('cloudflare') || trimmed.includes('Cloudflare')) {
      return { code: 'CLOUDFLARE_BLOCK', message: 'Cloudflare blocked the request.', providerMessage };
    }
    if (trimmed.includes('login') || trimmed.includes('signin')) {
      return { code: 'LOGIN_PAGE', message: 'Server returned a login page instead of JSON.', providerMessage };
    }
    return { code: 'HTML_RESPONSE', message: 'Server returned HTML instead of JSON.', providerMessage };
  }
  if (status === 401) return { code: 'HTTP_401', message: 'API key is invalid or missing.', providerMessage };
  if (status === 403) {
    const isGroup = /无权访问|分组|模型组|GPT官方|group|permission|forbidden/i.test(providerMessage || '');
    return { code: isGroup ? 'KEY_NO_PERMISSION' : 'HTTP_403', message: 'Permission denied.', providerMessage };
  }
  if (status === 404) return { code: 'HTTP_404', message: 'Endpoint not found.', providerMessage };
  if (status === 429) return { code: 'HTTP_429', message: 'Rate limited.', providerMessage };
  if (status >= 500) return { code: 'HTTP_5XX', message: `Server error (HTTP ${status}).`, providerMessage };
  return { code: 'UNKNOWN_ERROR', message: `Request failed (HTTP ${status}).`, providerMessage };
}

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
    if (typeof json['total_tokens'] === 'number') {
      return {
        total_tokens: json['total_tokens'] as number,
        prompt_tokens: typeof json['prompt_tokens'] === 'number' ? (json['prompt_tokens'] as number) : undefined,
        completion_tokens: typeof json['completion_tokens'] === 'number' ? (json['completion_tokens'] as number) : undefined,
      };
    }
  } catch { /* not JSON */ }
  return undefined;
}

function auditUsage(u: DiagnosisUsage): { suspicious: boolean; note?: string } {
  const { prompt_tokens = 0, completion_tokens = 0, total_tokens = 0 } = u;
  const anomalies: string[] = [];
  if (total_tokens > 500) anomalies.push(`total_tokens (${total_tokens}) unusually high`);
  if (completion_tokens > 50) anomalies.push(`completion_tokens (${completion_tokens}) very high`);
  if (prompt_tokens < 3 && total_tokens > 10) anomalies.push(`prompt_tokens (${prompt_tokens}) too low`);
  if (anomalies.length > 0) {
    return { suspicious: true, note: `Token usage looks unusual: ${anomalies.join('. ')}.` };
  }
  return { suspicious: false };
}

function buildReport(
  providerName: string,
  maskedKey: string,
  modelId: string | undefined,
  startTime: number,
  steps: DiagnosisStepResult[]
): DiagnosisReport {
  const passedCount = steps.filter((s) => s.status === 'success' || s.status === 'skipped').length;
  const overallStatus: DiagnosisStatus =
    steps.some((s) => s.status === 'error') ? 'error' :
    steps.some((s) => s.status === 'warning') ? 'warning' : 'success';

  const chatStep = steps.find((s) => s.id === 'chat_completion');
  let usageSummary: DiagnosisUsageSummary;
  if (chatStep?.status === 'skipped') {
    usageSummary = { status: 'skipped', hasUsage: false, suspicious: false };
  } else {
    const u = chatStep?.usage;
    if (u) {
      const audit = auditUsage(u);
      usageSummary = {
        status: audit.suspicious ? 'anomaly' : 'available',
        promptTokens: u.prompt_tokens,
        completionTokens: u.completion_tokens,
        totalTokens: u.total_tokens,
        reasoningTokens: u.reasoning_tokens,
        cachedTokens: u.cached_tokens,
        hasUsage: true,
        suspicious: audit.suspicious,
        note: audit.note,
      };
    } else {
      usageSummary = { status: 'missing', hasUsage: false, suspicious: false, note: 'No usage data.' };
    }
  }

  return {
    providerName: providerName || 'Provider',
    maskedKey,
    activeModelId: modelId,
    startedAt: new Date(startTime).toISOString(),
    totalLatencyMs: Date.now() - startTime,
    overallStatus,
    passedCount,
    totalCount: steps.length,
    steps,
    usageSummary,
  };
}

// ─── Billing Anomaly Probes ─────────────────────────────────

import type {
  BalanceSnapshot,
  BalanceTimeline,
  BillingProbeResult,
  BillingAnomalyReport,
  OutputSignal,
  BillingProbeResultStatus,
  BillingAnomalySummary,
} from '../types';

// Epsilon for floating point comparison
const BALANCE_EPSILON = 0.000001;
const SETTLEMENT_DELAY_MS = 1500;

export async function getNewApiTokenUsage(
  baseUrl: string,
  apiKey: string
): Promise<BalanceSnapshot> {
  try {
    const url = new URL(baseUrl);
    const origin = url.origin;
    const usageUrl = `${origin}/api/usage/token`;

    const response = await fetch(usageUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return {
        supported: false,
        source: 'unsupported',
        error: `HTTP ${response.status}`,
      };
    }

    const text = await response.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        supported: false,
        source: 'unsupported',
        error: 'Non-JSON response',
      };
    }

    const unlimited = data['unlimited'] === true;
    let source: BalanceSnapshot['source'] = 'newapi';
    if (unlimited) source = 'unlimited';

    // Try to determine precision from decimal places
    const available = data['available'];
    let precision: number | undefined;
    if (typeof available === 'number') {
      const str = available.toString();
      const dotIndex = str.indexOf('.');
      if (dotIndex >= 0) {
        precision = str.length - dotIndex - 1;
      }
    }

    return {
      supported: true,
      source,
      granted: typeof data['granted'] === 'number' ? (data['granted'] as number) : undefined,
      used: typeof data['used'] === 'number' ? (data['used'] as number) : undefined,
      available: typeof data['available'] === 'number' ? (data['available'] as number) : undefined,
      unlimited,
      precision,
      raw: data,
    };
  } catch (err) {
    return {
      supported: false,
      source: 'unsupported',
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export function summarizeBillingAnomaly(
  report: BillingAnomalyReport,
  hasModelId: boolean
): BillingAnomalySummary {
  if (!report.enabled) {
    return {
      status: 'not_enabled',
      title: 'Billing anomaly probes not enabled',
      titleZh: '未开启扣费异常检测',
      message: 'This test only ran basic API diagnosis. Enable billing anomaly probes to check empty-reply and failed-request billing risks.',
      messageZh: '本次仅完成基础调用诊断。开启扣费异常检测后，可检查空回复扣费和失败请求扣费风险。',
      riskTags: [],
      severity: 'skipped',
    };
  }

  if (!hasModelId) {
    return {
      status: 'not_tested',
      title: 'Billing anomaly probes not run',
      titleZh: '扣费异常检测未运行',
      message: 'Enter a model ID to run billing anomaly probes.',
      messageZh: '请填写模型 ID 后重新诊断。',
      riskTags: [],
      severity: 'skipped',
    };
  }

  const emptyProbe = report.emptyReplyProbe;
  const failedProbe = report.failedRequestProbe;

  // Check for signal_confirmed
  if (emptyProbe?.status === 'signal_confirmed' || failedProbe?.status === 'signal_confirmed') {
    const riskTags: string[] = [];
    if (emptyProbe?.status === 'signal_confirmed') riskTags.push('EMPTY_REPLY_CHARGE_CONFIRMED');
    if (failedProbe?.status === 'signal_confirmed') riskTags.push('FAILED_REQUEST_CHARGE_CONFIRMED');

    return {
      status: 'signal_confirmed',
      title: 'Billing anomaly signal confirmed',
      titleZh: '扣费异常信号已确认',
      message: 'This test found a reproducible signal: no effective output or failed request with settled balance decrease.',
      messageZh: '本次测试出现"无有效输出/请求失败 + 结算后余额减少"的可复现信号。',
      riskTags,
      severity: 'error',
    };
  }

  // Check for needs_review
  if (emptyProbe?.status === 'needs_review' || failedProbe?.status === 'needs_review') {
    const riskTags: string[] = [];
    if (emptyProbe?.status === 'needs_review') riskTags.push('EMPTY_REPLY_CHARGE_REVIEW');
    if (failedProbe?.status === 'needs_review') riskTags.push('FAILED_REQUEST_CHARGE_REVIEW');
    if (!report.balanceSnapshot?.supported) riskTags.push('BALANCE_UNAVAILABLE');

    return {
      status: 'needs_review',
      title: 'Billing risk needs review',
      titleZh: '扣费风险需复查',
      message: 'This test found billing risk signals, but balance or output reasons could not be fully confirmed.',
      messageZh: '本次测试发现扣费风险信号，但余额或输出原因无法完全确认。',
      riskTags,
      severity: 'warning',
    };
  }

  // Both probes are not_found
  if (
    (emptyProbe?.status === 'not_found' || !emptyProbe) &&
    (failedProbe?.status === 'not_found' || !failedProbe)
  ) {
    return {
      status: 'not_found',
      title: 'No billing anomaly signal found',
      titleZh: '未发现扣费异常信号',
      message: 'This test did not find empty-reply or failed-request billing signals.',
      messageZh: '本次测试未发现空回复扣费或失败请求扣费信号。',
      riskTags: [],
      severity: 'success',
    };
  }

  // Default case
  return {
    status: 'not_tested',
    title: 'Billing anomaly probes incomplete',
    titleZh: '扣费异常检测未完成',
    message: 'Billing anomaly probes did not complete.',
    messageZh: '扣费异常检测未能完成。',
    riskTags: [],
    severity: 'skipped',
  };
}

export async function runBillingAnomalyProbes(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  enabled: boolean,
  manualBeforeBalance?: number,
  manualAfterBalance?: number
): Promise<BillingAnomalyReport> {
  const report: BillingAnomalyReport = { enabled };

  if (!enabled) {
    report.emptyReplyProbe = createNotTestedProbe('empty_reply_charge', 'Empty Reply Charge');
    report.failedRequestProbe = createNotTestedProbe('failed_request_charge', 'Failed Request Charge');
    return report;
  }

  // Get balance snapshots before probes
  const beforeSnapshot = await getNewApiTokenUsage(baseUrl, apiKey);
  report.balanceSnapshot = beforeSnapshot;

  // Run empty reply probe
  try {
    report.emptyReplyProbe = await runEmptyReplyProbe(baseUrl, apiKey, modelId, beforeSnapshot, manualBeforeBalance, manualAfterBalance);
  } catch {
    report.emptyReplyProbe = createFailedProbe('empty_reply_charge', 'Empty Reply Charge', 'Probe failed');
  }

  // Run failed request probe
  try {
    report.failedRequestProbe = await runFailedRequestProbe(baseUrl, apiKey, beforeSnapshot, manualBeforeBalance, manualAfterBalance);
  } catch {
    report.failedRequestProbe = createFailedProbe('failed_request_charge', 'Failed Request Charge', 'Probe failed');
  }

  return report;
}

function createNotTestedProbe(key: 'empty_reply_charge' | 'failed_request_charge', title: string): BillingProbeResult {
  return {
    key,
    title,
    status: 'not_tested',
    confirmed: false,
    highRisk: false,
    outputSignal: createEmptyOutputSignal(),
    message: '',
    suggestion: '',
  };
}

function createFailedProbe(key: 'empty_reply_charge' | 'failed_request_charge', title: string, errorMsg: string): BillingProbeResult {
  return {
    key,
    title,
    status: 'needs_review',
    confirmed: false,
    highRisk: true,
    outputSignal: createEmptyOutputSignal(),
    message: errorMsg,
    suggestion: 'Probe failed to complete. Check provider logs.',
  };
}

function createEmptyOutputSignal(): OutputSignal {
  return {
    visibleText: '',
    visibleOutputLength: 0,
    completionTokens: undefined,
    promptTokens: undefined,
    totalTokens: undefined,
    finishReason: undefined,
    stopReason: undefined,
    hasToolCall: false,
    hasImage: false,
    hasAudio: false,
    hasSearch: false,
    hasRefusal: false,
    hasContentFilter: false,
    hasErrorEvent: false,
    hasAnyEffectiveOutput: false,
  };
}

function parseOutputSignal(event: Record<string, unknown>): OutputSignal {
  const signal: OutputSignal = {
    visibleText: '',
    visibleOutputLength: 0,
    completionTokens: undefined,
    promptTokens: undefined,
    totalTokens: undefined,
    finishReason: undefined,
    stopReason: undefined,
    hasToolCall: false,
    hasImage: false,
    hasAudio: false,
    hasSearch: false,
    hasRefusal: false,
    hasContentFilter: false,
    hasErrorEvent: !!event['error'],
    hasAnyEffectiveOutput: false,
  };

  // Parse content from delta or message
  const choices = event['choices'] as Array<Record<string, unknown>> | undefined;
  if (choices && Array.isArray(choices)) {
    for (const choice of choices) {
      // Check delta
      const delta = choice['delta'] as Record<string, unknown> | undefined;
      if (delta) {
        const content = delta['content'];
        if (typeof content === 'string') {
          signal.visibleText += content;
          signal.visibleOutputLength += content.length;
        }
        if (delta['tool_calls']) signal.hasToolCall = true;
        if (delta['audio']) signal.hasAudio = true;
        if (delta['image_url']) signal.hasImage = true;
        if (delta['search_results'] || delta['web_search']) signal.hasSearch = true;
        if (delta['refusal']) signal.hasRefusal = true;
      }

      // Check message (for non-streaming)
      const message = choice['message'] as Record<string, unknown> | undefined;
      if (message) {
        const content = message['content'];
        if (typeof content === 'string') {
          signal.visibleText += content;
          signal.visibleOutputLength += content.length;
        }
        if (message['tool_calls']) signal.hasToolCall = true;
      }

      // Check output_text (some providers use this)
      const outputText = choice['output_text'];
      if (typeof outputText === 'string') {
        signal.visibleText += outputText;
        signal.visibleOutputLength += outputText.length;
      }

      // Check finish_reason
      const finishReason = choice['finish_reason'];
      if (typeof finishReason === 'string') {
        signal.finishReason = finishReason;
        if (finishReason === 'tool_calls') signal.hasToolCall = true;
      }

      // Check stop_reason
      const stopReason = choice['stop_reason'];
      if (typeof stopReason === 'string') {
        signal.stopReason = stopReason;
      }

      // Check content_filter
      const contentFilter = choice['content_filter'];
      if (contentFilter) signal.hasContentFilter = true;
    }
  }

  // Parse usage
  const usage = event['usage'] as Record<string, unknown> | undefined;
  if (usage) {
    signal.completionTokens = typeof usage['completion_tokens'] === 'number' ? usage['completion_tokens'] as number : undefined;
    signal.promptTokens = typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] as number : undefined;
    signal.totalTokens = typeof usage['total_tokens'] === 'number' ? usage['total_tokens'] as number : undefined;
  }

  // Determine if has any effective output
  signal.hasAnyEffectiveOutput =
    signal.visibleOutputLength > 0 ||
    signal.hasToolCall ||
    signal.hasImage ||
    signal.hasAudio ||
    signal.hasSearch ||
    signal.hasRefusal ||
    signal.finishReason === 'tool_calls' ||
    signal.stopReason === 'tool_use';

  return signal;
}

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readBalanceTimeline(
  baseUrl: string,
  apiKey: string,
  beforeSnapshot: BalanceSnapshot,
  manualBeforeBalance?: number,
  manualAfterBalance?: number
): Promise<BalanceTimeline> {
  const timeline: BalanceTimeline = {
    settlementDelayMs: SETTLEMENT_DELAY_MS,
    source: 'unsupported',
    status: 'not_available',
  };

  // Determine source and before value
  if (beforeSnapshot.supported && beforeSnapshot.available !== undefined && !beforeSnapshot.unlimited) {
    timeline.before = beforeSnapshot;
    timeline.beforeValue = beforeSnapshot.available;
    timeline.source = 'newapi';
  } else if (manualBeforeBalance !== undefined) {
    timeline.before = { supported: true, source: 'manual', available: manualBeforeBalance };
    timeline.beforeValue = manualBeforeBalance;
    timeline.source = 'manual';
  }

  // Read immediate after balance
  try {
    const afterImmediateSnapshot = await getNewApiTokenUsage(baseUrl, apiKey);
    timeline.afterImmediate = afterImmediateSnapshot;
    if (afterImmediateSnapshot.supported && afterImmediateSnapshot.available !== undefined && !afterImmediateSnapshot.unlimited) {
      timeline.afterImmediateValue = afterImmediateSnapshot.available;
    }
  } catch {
    // Ignore
  }

  // Manual after balance overrides
  if (manualAfterBalance !== undefined) {
    timeline.afterImmediate = { supported: true, source: 'manual', available: manualAfterBalance };
    timeline.afterImmediateValue = manualAfterBalance;
  }

  // Calculate immediate delta
  if (timeline.beforeValue !== undefined && timeline.afterImmediateValue !== undefined) {
    timeline.deltaImmediate = timeline.beforeValue - timeline.afterImmediateValue;
  }

  // Wait for settlement
  await wait(SETTLEMENT_DELAY_MS);

  // Read settled balance
  try {
    const afterSettledSnapshot = await getNewApiTokenUsage(baseUrl, apiKey);
    timeline.afterSettled = afterSettledSnapshot;
    if (afterSettledSnapshot.supported && afterSettledSnapshot.available !== undefined && !afterSettledSnapshot.unlimited) {
      timeline.afterSettledValue = afterSettledSnapshot.available;
    }
  } catch {
    // Ignore
  }

  // Calculate settled delta
  if (timeline.beforeValue !== undefined && timeline.afterSettledValue !== undefined) {
    timeline.deltaSettled = timeline.beforeValue - timeline.afterSettledValue;
  }

  // Determine status
  if (timeline.source === 'unlimited' || beforeSnapshot.unlimited) {
    timeline.status = 'unlimited';
  } else if (timeline.beforeValue === undefined || timeline.afterSettledValue === undefined) {
    if (timeline.beforeValue !== undefined && timeline.afterImmediateValue !== undefined) {
      timeline.status = 'incomplete';
    } else {
      timeline.status = 'not_available';
    }
  } else if (timeline.deltaSettled !== undefined && timeline.deltaSettled > BALANCE_EPSILON) {
    timeline.status = 'decreased';
  } else if (timeline.deltaImmediate !== undefined && timeline.deltaImmediate > BALANCE_EPSILON && timeline.deltaSettled !== undefined && timeline.deltaSettled <= BALANCE_EPSILON) {
    timeline.status = 'precharge_refunded';
  } else if (timeline.deltaSettled !== undefined && timeline.deltaSettled <= BALANCE_EPSILON && timeline.deltaImmediate !== undefined && timeline.deltaImmediate > BALANCE_EPSILON) {
    timeline.status = 'precharge_refunded';
  } else if (beforeSnapshot.precision !== undefined && beforeSnapshot.precision <= 2 && timeline.deltaSettled !== undefined && timeline.deltaSettled <= 0.01) {
    timeline.status = 'precision_limited';
  } else {
    timeline.status = 'available';
  }

  return timeline;
}

async function runEmptyReplyProbe(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  beforeSnapshot: BalanceSnapshot,
  manualBeforeBalance?: number,
  manualAfterBalance?: number
): Promise<BillingProbeResult> {
  if (!modelId) {
    return createNotTestedProbe('empty_reply_charge', 'Empty Reply Charge');
  }

  const result: BillingProbeResult = {
    key: 'empty_reply_charge',
    title: 'Empty Reply Charge',
    status: 'not_tested',
    confirmed: false,
    highRisk: false,
    outputSignal: createEmptyOutputSignal(),
    endpoint: `${baseUrl}/chat/completions`,
    model: modelId,
    message: '',
    suggestion: '',
  };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: '只回复一个字：1' }],
        max_tokens: 5,
        temperature: 0,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    result.httpStatus = response.status;
    result.requestId = response.headers.get('x-request-id') || undefined;

    // Read stream
    const text = await response.text();
    result.streamStatus = 'unknown';

    // Parse SSE stream and aggregate output
    const streamData = parseSSEStream(text);
    let aggregatedSignal = createEmptyOutputSignal();

    for (const event of streamData) {
      if (event['error']) {
        result.outputSignal.hasErrorEvent = true;
      }

      const signal = parseOutputSignal(event);
      // Aggregate text
      aggregatedSignal.visibleText += signal.visibleText;
      aggregatedSignal.visibleOutputLength += signal.visibleOutputLength;
      // Aggregate other signals (OR)
      aggregatedSignal.hasToolCall = aggregatedSignal.hasToolCall || signal.hasToolCall;
      aggregatedSignal.hasImage = aggregatedSignal.hasImage || signal.hasImage;
      aggregatedSignal.hasAudio = aggregatedSignal.hasAudio || signal.hasAudio;
      aggregatedSignal.hasSearch = aggregatedSignal.hasSearch || signal.hasSearch;
      aggregatedSignal.hasRefusal = aggregatedSignal.hasRefusal || signal.hasRefusal;
      aggregatedSignal.hasContentFilter = aggregatedSignal.hasContentFilter || signal.hasContentFilter;
      aggregatedSignal.hasErrorEvent = aggregatedSignal.hasErrorEvent || signal.hasErrorEvent;
      aggregatedSignal.hasAnyEffectiveOutput = aggregatedSignal.hasAnyEffectiveOutput || signal.hasAnyEffectiveOutput;
      // Use latest usage
      if (signal.completionTokens !== undefined) aggregatedSignal.completionTokens = signal.completionTokens;
      if (signal.promptTokens !== undefined) aggregatedSignal.promptTokens = signal.promptTokens;
      if (signal.totalTokens !== undefined) aggregatedSignal.totalTokens = signal.totalTokens;
      if (signal.finishReason) aggregatedSignal.finishReason = signal.finishReason;
      if (signal.stopReason) aggregatedSignal.stopReason = signal.stopReason;

      // Check stream end
      const choices = event['choices'] as Array<Record<string, unknown>> | undefined;
      if (choices) {
        for (const choice of choices) {
          const fr = choice['finish_reason'];
          if (fr === 'stop' || fr === 'eos') {
            result.streamStatus = 'done';
          }
        }
      }
    }

    result.outputSignal = aggregatedSignal;

    if (!response.ok) {
      result.status = 'needs_review';
      result.message = `HTTP ${response.status}`;
      result.suggestion = 'Request failed with non-200 status';
      return result;
    }

    if (result.streamStatus === 'unknown' && aggregatedSignal.visibleOutputLength > 0) {
      result.streamStatus = 'eof';
    }

    // Read balance timeline
    const timeline = await readBalanceTimeline(baseUrl, apiKey, beforeSnapshot, manualBeforeBalance, manualAfterBalance);
    result.balanceTimeline = timeline;

    // Determine result based on output and balance
    const isEmptyReply =
      aggregatedSignal.visibleOutputLength === 0 &&
      !aggregatedSignal.hasToolCall &&
      !aggregatedSignal.hasImage &&
      !aggregatedSignal.hasAudio &&
      !aggregatedSignal.hasSearch &&
      !aggregatedSignal.hasRefusal &&
      !aggregatedSignal.hasContentFilter &&
      (aggregatedSignal.completionTokens === 0 || aggregatedSignal.completionTokens === undefined);

    if (!isEmptyReply) {
      result.status = 'not_found';
      result.message = 'No empty-reply billing signal found';
      result.suggestion = 'Response contains visible output';
      return result;
    }

    // Empty reply detected, check balance
    if (timeline.status === 'precharge_refunded') {
      result.status = 'not_found';
      result.message = 'Precharge was refunded. No final billing anomaly signal found.';
      result.suggestion = 'Balance returned to before level after settlement.';
      return result;
    }

    if (timeline.status === 'unlimited' || beforeSnapshot.unlimited) {
      result.status = 'needs_review';
      result.message = 'Empty reply detected, balance is unlimited or not auditable';
      result.suggestion = 'Balance is unlimited. Cannot audit billing.';
      return result;
    }

    if (timeline.status === 'not_available' || timeline.status === 'incomplete') {
      result.status = 'needs_review';
      result.message = 'Empty reply detected, balance could not be confirmed';
      result.suggestion = 'Balance unavailable. Check provider logs.';
      return result;
    }

    if (timeline.status === 'precision_limited') {
      result.status = 'needs_review';
      result.message = 'Empty reply detected, balance change below display precision';
      result.suggestion = 'Balance change may be below display precision. Check provider logs.';
      return result;
    }

    if (timeline.deltaSettled !== undefined && timeline.deltaSettled > BALANCE_EPSILON) {
      result.status = 'signal_confirmed';
      result.confirmed = true;
      result.highRisk = true;
      result.message = 'Empty reply with settled balance decrease detected';
      result.suggestion = 'Balance decreased despite no visible output';
      return result;
    }

    // Default to not_found
    result.status = 'not_found';
    result.message = 'Empty reply detected but no final balance decrease';
    result.suggestion = 'No confirmed billing anomaly.';
    return result;

  } catch (err) {
    result.status = 'needs_review';
    result.message = err instanceof Error ? err.message : 'Unknown error';
    result.suggestion = 'Probe failed to complete';
  }

  return result;
}

async function runFailedRequestProbe(
  baseUrl: string,
  apiKey: string,
  beforeSnapshot: BalanceSnapshot,
  manualBeforeBalance?: number,
  manualAfterBalance?: number
): Promise<BillingProbeResult> {
  const result: BillingProbeResult = {
    key: 'failed_request_charge',
    title: 'Failed Request Charge',
    status: 'not_tested',
    confirmed: false,
    highRisk: false,
    outputSignal: createEmptyOutputSignal(),
    endpoint: `${baseUrl}/chat/completions`,
    model: `ai-api-doctor-invalid-model-${Date.now()}`,
    message: '',
    suggestion: '',
  };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: result.model,
        messages: [{ role: 'user', content: 'Reply exactly: 1' }],
        max_tokens: 5,
        temperature: 0,
        stream: false,
      }),
    });

    result.httpStatus = response.status;
    result.requestId = response.headers.get('x-request-id') || undefined;

    // Try to read response
    let responseText = '';
    try {
      responseText = await response.text();
      const json = JSON.parse(responseText);
      if (json?.error) {
        result.providerMessage = typeof json.error === 'string' ? json.error : JSON.stringify(json.error);
      }
      // Parse output
      if (json) {
        const signal = parseOutputSignal(json);
        result.outputSignal = signal;
      }
    } catch {
      // Non-JSON or empty
    }

    // Check if request failed
    const isFailedRequest =
      !response.ok ||
      responseText.includes('error') ||
      responseText.includes('not found') ||
      responseText.includes('invalid') ||
      responseText.includes('model not found') ||
      responseText.includes('no available channel') ||
      responseText.includes('no available model') ||
      responseText.includes('permission denied') ||
      responseText.includes('group denied') ||
      responseText.includes('unauthorized') ||
      responseText.includes('insufficient quota') ||
      responseText.includes('resource_exhausted');

    if (!isFailedRequest) {
      result.status = 'needs_review';
      result.message = 'Request unexpectedly succeeded with invalid model';
      result.suggestion = 'Unexpected success with invalid model';
      return result;
    }

    // Read balance timeline
    const timeline = await readBalanceTimeline(baseUrl, apiKey, beforeSnapshot, manualBeforeBalance, manualAfterBalance);
    result.balanceTimeline = timeline;

    if (timeline.status === 'precharge_refunded') {
      result.status = 'not_found';
      result.message = 'Precharge was refunded. No final billing anomaly signal found.';
      result.suggestion = 'Balance returned to before level after settlement.';
      return result;
    }

    if (timeline.status === 'unlimited' || beforeSnapshot.unlimited) {
      result.status = 'needs_review';
      result.message = 'Failed request detected, balance is unlimited or not auditable';
      result.suggestion = 'Balance is unlimited. Cannot audit billing.';
      return result;
    }

    if (timeline.status === 'not_available' || timeline.status === 'incomplete') {
      result.status = 'needs_review';
      result.message = 'Failed request detected, balance could not be confirmed';
      result.suggestion = 'Balance unavailable. Check provider logs.';
      return result;
    }

    if (timeline.deltaSettled !== undefined && timeline.deltaSettled > BALANCE_EPSILON) {
      result.status = 'signal_confirmed';
      result.confirmed = true;
      result.highRisk = true;
      result.message = 'Failed request with settled balance decrease detected';
      result.suggestion = 'Balance decreased despite request failure';
      return result;
    }

    // Default to not_found
    result.status = 'not_found';
    result.message = 'Request failed but no final balance decrease';
    result.suggestion = 'No confirmed billing anomaly.';
    return result;

  } catch (err) {
    result.status = 'needs_review';
    result.message = err instanceof Error ? err.message : 'Unknown error';
    result.suggestion = 'Probe failed to complete';
  }

  return result;
}

function parseSSEStream(text: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  const lines = text.split('\n');

  let currentEvent: Record<string, unknown> = {};

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        events.push(currentEvent);
        currentEvent = {};
        continue;
      }
      try {
        const parsed = JSON.parse(data);
        events.push(parsed);
      } catch {
        // Skip invalid JSON
      }
    } else if (line.startsWith('event: ')) {
      const eventName = line.slice(7).trim();
      currentEvent = { _event: eventName };
    } else if (line.trim() === '') {
      if (Object.keys(currentEvent).length > 0) {
        events.push(currentEvent);
        currentEvent = {};
      }
    }
  }

  return events;
}

// ─── New API / One API Raw Quota Functions ──────────────────

const QUOTA_EPSILON = 0.5; // Small epsilon for raw quota comparison
const MONEY_EPSILON = 0.000001; // For USD comparison
const SETTLEMENT_DELAY_3S = 3000; // 3 seconds settlement delay
const SETTLEMENT_DELAY_10S = 10000; // 10 seconds settlement delay

/**
 * Read userId from localStorage using injected script
 */
async function readUserIdFromPage(tabId: number): Promise<string | null> {
  try {
    // First try messaging the content script
    const response = await browser.tabs.sendMessage(tabId, { type: 'GET_NEWAPI_RAW_BALANCE' });
    if (response?.success && response?.data?.userId) {
      return response.data.userId;
    }
    if (response?.error === 'USER_NOT_FOUND') {
      return null; // User really not found, not a connection issue
    }
  } catch {
    // Content script not available, try executeScript
  }

  // Fallback: try to execute script directly
  try {
    // Dynamic import of the content script logic
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          const userStr = localStorage.getItem('user') || '{}';
          const user = JSON.parse(userStr);
          return { userId: String(user.id || '') };
        } catch {
          return { userId: '' };
        }
      },
    });
    if (results && results[0]?.result?.userId) {
      return results[0].result.userId;
    }
  } catch {
    // executeScript also failed
  }

  return null;
}

/**
 * Request raw quota balance from content script with fallback
 */
export async function requestRawQuotaFromTab(tabId: number): Promise<RawQuotaBalance | null> {
  // Try messaging content script first
  try {
    const response = await browser.tabs.sendMessage(tabId, { type: 'GET_NEWAPI_RAW_BALANCE' });
    if (response?.success && response?.data) {
      return response.data as RawQuotaBalance;
    }
    // If content script exists but returned error, propagate
    if (response?.error) {
      return null;
    }
  } catch {
    // Content script not available, fall through to executeScript
  }

  // Fallback: use scripting.executeScript
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        try {
          // Get userId
          const userStr = localStorage.getItem('user') || '{}';
          const user = JSON.parse(userStr);
          const userId = String(user.id || '');

          if (!userId) {
            return { error: 'USER_NOT_FOUND' };
          }

          const headers = {
            'accept': 'application/json, text/plain, */*',
            'cache-control': 'no-store',
            'new-api-user': userId,
          };

          const [statusRes, selfRes] = await Promise.all([
            fetch('/api/status', { method: 'GET', credentials: 'include', headers }),
            fetch('/api/user/self', { method: 'GET', credentials: 'include', headers }),
          ]);

          if (!statusRes.ok || !selfRes.ok) {
            return { error: 'API_REQUEST_FAILED' };
          }

          const statusData = await statusRes.json();
          const selfData = await selfRes.json();

          if (!statusData?.success || !selfData?.success) {
            return { error: 'API_RETURNED_ERROR' };
          }

          const quotaPerUnit = Number(statusData.data?.quota_per_unit || 500000);
          const rawQuota = Number(selfData.data?.quota);

          if (!Number.isFinite(rawQuota)) {
            return { error: 'QUOTA_FIELD_MISSING' };
          }

          return {
            userId,
            rawQuota,
            quotaPerUnit,
            usdBalance: rawQuota / quotaPerUnit,
            usedQuota: Number(selfData.data?.used_quota || 0),
            requestCount: Number(selfData.data?.request_count || 0),
            timestamp: Date.now(),
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    });

    if (results && results[0]?.result) {
      const result = results[0].result;
      if ('error' in result) {
        return null;
      }
      return result as RawQuotaBalance;
    }
  } catch {
    // Both methods failed
  }

  return null;
}

/**
 * Create an empty raw quota timeline
 */
export function createEmptyRawQuotaTimeline(error?: string): RawQuotaTimeline {
  return {
    before: undefined,
    afterImmediate: undefined,
    after3s: undefined,
    after10s: undefined,
    delta3s: undefined,
    delta10s: undefined,
    readable: false,
    error,
  };
}

/**
 * Read raw quota timeline with multiple settlement checks
 */
export async function readRawQuotaTimeline(
  baseUrl: string,
  apiKey: string,
  tabId: number,
  options: { requestStartTime?: number } = {}
): Promise<RawQuotaTimeline> {
  const result = createEmptyRawQuotaTimeline();

  // Read initial balance
  const beforeBalance = await requestRawQuotaFromTab(tabId);
  if (!beforeBalance) {
    result.error = 'USER_NOT_LOGGED_IN';
    return result;
  }
  result.before = beforeBalance;
  result.readable = true;

  // Perform the test request
  const invalidModel = `ai-api-doctor-invalid-${Date.now()}`;
  let requestEndTime = Date.now();

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: invalidModel,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
        stream: false,
      }),
    });

    requestEndTime = Date.now();
    result.afterImmediate = await requestRawQuotaFromTab(tabId);

    // Wait 3 seconds from request end
    await new Promise(resolve => setTimeout(resolve, SETTLEMENT_DELAY_3S));
    result.after3s = await requestRawQuotaFromTab(tabId);

    // Wait additional 7 seconds (total 10s from request end)
    await new Promise(resolve => setTimeout(resolve, SETTLEMENT_DELAY_10S - SETTLEMENT_DELAY_3S));
    result.after10s = await requestRawQuotaFromTab(tabId);

    // Calculate deltas
    if (result.after3s) {
      result.delta3s = result.before.rawQuota - result.after3s.rawQuota;
    }
    if (result.after10s) {
      result.delta10s = result.before.rawQuota - result.after10s.rawQuota;
    }

  } catch (error) {
    // Even if request fails, try to read balance
    result.afterImmediate = await requestRawQuotaFromTab(tabId);
  }

  return result;
}

/**
 * Judge billing result based on raw quota timeline and response info
 */
export function judgeBilling(
  timeline: RawQuotaTimeline,
  responseInfo: {
    httpStatus: number;
    error?: boolean;
    visibleText?: string;
    completionTokens?: number;
    hasToolCall?: boolean;
    hasImage?: boolean;
    hasAudio?: boolean;
    hasSearch?: boolean;
  }
): BillingJudgment {
  const { delta3s, delta10s, before } = timeline;

  const failed = responseInfo.httpStatus >= 400 || responseInfo.error;

  const noEffectiveOutput =
    !(responseInfo.visibleText?.trim()) &&
    Number(responseInfo.completionTokens || 0) === 0 &&
    !responseInfo.hasToolCall &&
    !responseInfo.hasImage &&
    !responseInfo.hasAudio &&
    !responseInfo.hasSearch;

  // Check if quota is readable
  if (!timeline.readable || before === undefined) {
    return {
      code: 'raw_quota_unavailable',
      level: 'risk',
      title: 'Balance unreadable',
      titleZh: '无法读取原始余额',
      detail: 'Cannot read raw quota. Low-precision detection only.',
      detailZh: '无法读取原始余额，只能进行低精度判断。',
    };
  }

  // Normal: precharge was refunded
  if (delta3s !== undefined && delta3s > QUOTA_EPSILON && delta10s !== undefined && Math.abs(delta10s) <= QUOTA_EPSILON) {
    const delta3Display = delta3s > 0 ? `+${delta3s}` : String(delta3s);
    return {
      code: 'precharge_refunded',
      level: 'ok',
      title: 'Precharge refunded',
      titleZh: '预扣已返还',
      detail: `Precharged ${delta3Display} quota, but refunded within 10 seconds.`,
      detailZh: `请求后曾预扣 ${delta3Display} quota，但 10 秒内已返还。`,
    };
  }

  // Bad: failed request with final deduction
  if (failed && noEffectiveOutput && delta10s !== undefined && delta10s > QUOTA_EPSILON) {
    const usdDelta = before ? (delta10s / before.quotaPerUnit).toFixed(6) : '0';
    return {
      code: 'failed_request_charged',
      level: 'bad',
      title: 'Failed request billing anomaly',
      titleZh: '失败请求扣费异常',
      detail: `Request failed with no effective output, but final deduction ${delta10s} quota (~$${usdDelta}).`,
      detailZh: `请求失败且无有效输出，但最终减少 ${delta10s} quota，约 $${usdDelta}。`,
    };
  }

  // Bad: empty reply with final deduction
  if (!failed && noEffectiveOutput && delta10s !== undefined && delta10s > QUOTA_EPSILON) {
    const usdDelta = before ? (delta10s / before.quotaPerUnit).toFixed(6) : '0';
    return {
      code: 'empty_response_charged',
      level: 'bad',
      title: 'Empty reply billing anomaly',
      titleZh: '空回复扣费异常',
      detail: `No effective output, but final deduction ${delta10s} quota (~$${usdDelta}).`,
      detailZh: `请求无有效输出，但最终减少 ${delta10s} quota，约 $${usdDelta}。`,
    };
  }

  // OK: failed request without deduction
  if (failed && delta10s !== undefined && Math.abs(delta10s) <= QUOTA_EPSILON) {
    return {
      code: 'failed_request_not_charged',
      level: 'ok',
      title: 'Failed request not charged',
      titleZh: '失败请求未扣费',
      detail: 'Request failed, but raw quota unchanged.',
      detailZh: '请求失败，但原始额度未减少。',
    };
  }

  // OK: normal request
  if (!failed && !noEffectiveOutput) {
    const deltaDisplay = delta10s !== undefined ? (delta10s >= 0 ? `+${delta10s}` : String(delta10s)) : '0';
    const usdDelta = before && delta10s !== undefined ? (delta10s / before.quotaPerUnit).toFixed(6) : '0';
    return {
      code: 'completed',
      level: 'ok',
      title: 'Detection completed',
      titleZh: '检测完成',
      detail: `Final change ${deltaDisplay} quota (~$${usdDelta}).`,
      detailZh: `最终额度变化 ${deltaDisplay} quota，约 $${usdDelta}。`,
    };
  }

  // Info: default case
  const deltaDisplay = delta10s !== undefined ? (delta10s >= 0 ? `+${delta10s}` : String(delta10s)) : '0';
  const usdDelta = before && delta10s !== undefined ? (delta10s / before.quotaPerUnit).toFixed(6) : '0';
  return {
    code: 'completed',
    level: 'info',
    title: 'Detection complete',
    titleZh: '检测完成',
    detail: `Final change ${deltaDisplay} quota (~$${usdDelta}).`,
    detailZh: `最终额度变化 ${deltaDisplay} quota，约 $${usdDelta}。`,
  };
}

/**
 * Get diagnosis progress message
 */
export function getDiagnosisProgressMessage(step: DiagnosisProgressStep): { message: string; messageZh: string; percent: number } {
  const messages: Record<DiagnosisProgressStep, { message: string; messageZh: string; percent: number }> = {
    idle: { message: 'Ready', messageZh: '准备就绪', percent: 0 },
    reading_before: { message: 'Reading balance before test...', messageZh: '读取检测前额度...', percent: 10 },
    sending_request: { message: 'Sending test request...', messageZh: '发送测试请求...', percent: 30 },
    reading_after: { message: 'Reading balance after request...', messageZh: '读取请求后额度...', percent: 50 },
    waiting_3s: { message: 'Waiting 3 seconds...', messageZh: '等待 3 秒...', percent: 60 },
    waiting_10s: { message: 'Waiting 10 seconds...', messageZh: '等待 10 秒...', percent: 80 },
    generating_report: { message: 'Generating report...', messageZh: '生成报告...', percent: 95 },
  };
  return messages[step];
}

/**
 * Run simplified billing diagnosis for New API / One API
 */
export async function runBillingDiagnosis(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  tabId: number,
  onProgress?: (progress: DiagnosisProgress) => void
): Promise<BillingDiagnosisReport> {
  const startTime = new Date().toISOString();

  const report: BillingDiagnosisReport = {
    providerName: 'New API',
    maskedKey: maskApiKey(apiKey),
    activeModelId: modelId,
    baseUrl,
    startedAt: startTime,
    finishedAt: startTime,
    judgment: {
      code: 'completed',
      level: 'info',
      title: 'Detection incomplete',
      titleZh: '检测未完成',
      detail: 'Diagnosis did not complete.',
      detailZh: '诊断未能完成。',
    },
    status: 'ok',
  };

  try {
    // Step 1: Read initial balance
    onProgress?.({ step: 'reading_before', ...getDiagnosisProgressMessage('reading_before') });
    const beforeBalance = await requestRawQuotaFromTab(tabId);
    if (!beforeBalance) {
      report.rawQuotaTimeline = createEmptyRawQuotaTimeline('USER_NOT_LOGGED_IN');
      report.judgment = {
        code: 'raw_quota_unavailable',
        level: 'risk',
        title: 'Balance unreadable',
        titleZh: '无法读取原始余额',
        detail: 'User not logged in to New API console. Cannot read raw quota.',
        detailZh: '未登录 New API 控制台，无法读取原始余额。',
      };
      report.status = 'risk';
      report.finishedAt = new Date().toISOString();
      return report;
    }

    report.rawQuotaTimeline = {
      before: beforeBalance,
      readable: true,
      settlementDelayMs: SETTLEMENT_DELAY_10S,
      status: 'available',
    };

    // Step 2: Send test request
    onProgress?.({ step: 'sending_request', ...getDiagnosisProgressMessage('sending_request') });
    const invalidModel = `ai-api-doctor-invalid-${Date.now()}`;
    let invalidResponse: Response;
    let invalidResponseText = '';
    let invalidResponseInfo = {
      httpStatus: 0,
      error: false,
      visibleText: '',
      completionTokens: 0,
      hasToolCall: false,
      hasImage: false,
      hasAudio: false,
      hasSearch: false,
    };

    try {
      invalidResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: invalidModel,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 5,
          stream: false,
        }),
      });

      invalidResponseInfo.httpStatus = invalidResponse.status;
      invalidResponseText = await invalidResponse.text();

      // Parse response
      try {
        const data = JSON.parse(invalidResponseText);
        invalidResponseInfo.visibleText = data.choices?.[0]?.message?.content || '';
        invalidResponseInfo.completionTokens = data.usage?.completion_tokens || 0;
        invalidResponseInfo.hasToolCall = !!(data.choices?.[0]?.message?.tool_calls);
        invalidResponseInfo.hasImage = !!(data.choices?.[0]?.message?.image_url);
        invalidResponseInfo.error = !!data.error;
      } catch {
        invalidResponseInfo.error = true;
      }
    } catch (err) {
      invalidResponseInfo.error = true;
    }

    // Read immediate balance after invalid model request
    onProgress?.({ step: 'reading_after', ...getDiagnosisProgressMessage('reading_after') });
    report.rawQuotaTimeline.afterImmediate = await requestRawQuotaFromTab(tabId);

    // Step 3: Wait 3 seconds and read balance
    onProgress?.({ step: 'waiting_3s', ...getDiagnosisProgressMessage('waiting_3s') });
    await new Promise(resolve => setTimeout(resolve, SETTLEMENT_DELAY_3S));
    report.rawQuotaTimeline.after3s = await requestRawQuotaFromTab(tabId);
    if (report.rawQuotaTimeline.after3s && report.rawQuotaTimeline.before) {
      report.rawQuotaTimeline.delta3s = report.rawQuotaTimeline.before.rawQuota - report.rawQuotaTimeline.after3s.rawQuota;
    }

    // Step 4: Wait 7 more seconds (total 10s)
    onProgress?.({ step: 'waiting_10s', ...getDiagnosisProgressMessage('waiting_10s') });
    await new Promise(resolve => setTimeout(resolve, SETTLEMENT_DELAY_10S - SETTLEMENT_DELAY_3S));
    report.rawQuotaTimeline.after10s = await requestRawQuotaFromTab(tabId);
    if (report.rawQuotaTimeline.after10s && report.rawQuotaTimeline.before) {
      report.rawQuotaTimeline.delta10s = report.rawQuotaTimeline.before.rawQuota - report.rawQuotaTimeline.after10s.rawQuota;
    }

    // Generate report
    onProgress?.({ step: 'generating_report', ...getDiagnosisProgressMessage('generating_report') });

    // Store invalid model test result
    report.invalidModelTest = {
      key: 'invalid_model_charge',
      title: 'Invalid Model Test',
      status: invalidResponseInfo.httpStatus >= 400 ? 'not_found' : 'needs_review',
      confirmed: false,
      highRisk: false,
      httpStatus: invalidResponseInfo.httpStatus,
      outputSignal: createEmptyOutputSignal(),
      message: `HTTP ${invalidResponseInfo.httpStatus}: Invalid model test completed`,
      suggestion: '',
    };

    // Step 5: Baseline test with valid model
    let baselineResponse: Response;
    let baselineResponseInfo = {
      httpStatus: 0,
      error: false,
      visibleText: '',
      completionTokens: 0,
      totalTokens: 0,
      hasToolCall: false,
      hasImage: false,
      hasAudio: false,
      hasSearch: false,
    };

    try {
      baselineResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: '只回复一个字：1' }],
          max_tokens: 5,
          temperature: 0,
          stream: false,
        }),
      });

      baselineResponseInfo.httpStatus = baselineResponse.status;
      const responseText = await baselineResponse.text();

      try {
        const data = JSON.parse(responseText);
        baselineResponseInfo.visibleText = data.choices?.[0]?.message?.content || '';
        baselineResponseInfo.completionTokens = data.usage?.completion_tokens || 0;
        baselineResponseInfo.totalTokens = data.usage?.total_tokens || 0;
        baselineResponseInfo.hasToolCall = !!(data.choices?.[0]?.message?.tool_calls);
        baselineResponseInfo.hasImage = !!(data.choices?.[0]?.message?.image_url);
        baselineResponseInfo.error = !!data.error;
      } catch {
        baselineResponseInfo.error = true;
      }
    } catch (err) {
      baselineResponseInfo.error = true;
    }

    report.baselineTest = {
      key: 'baseline_test',
      title: 'Baseline Test',
      status: baselineResponseInfo.httpStatus === 200 && !baselineResponseInfo.error ? 'not_found' : 'needs_review',
      confirmed: false,
      highRisk: false,
      httpStatus: baselineResponseInfo.httpStatus,
      outputSignal: createEmptyOutputSignal(),
      message: `HTTP ${baselineResponseInfo.httpStatus}: Baseline test completed`,
      suggestion: '',
    };

    // Final judgment based on invalid model test result
    report.judgment = judgeBilling(report.rawQuotaTimeline, invalidResponseInfo);
    report.status = report.judgment.level === 'bad' ? 'bad' : report.judgment.level === 'risk' ? 'risk' : 'ok';

  } catch (err) {
    report.judgment = {
      level: 'risk',
      title: 'Detection error',
      titleZh: '检测出错',
      detail: err instanceof Error ? err.message : 'Unknown error',
      detailZh: err instanceof Error ? err.message : '未知错误',
    };
    report.status = 'risk';
  }

  report.finishedAt = new Date().toISOString();
  return report;
}

