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

import type { BalanceSnapshot, BillingProbeResult, BillingAnomalyReport } from '../types';

// Epsilon for floating point comparison
const EPSILON = 0.000001;

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

    return {
      supported: true,
      source: 'newapi',
      granted: typeof data['granted'] === 'number' ? (data['granted'] as number) : undefined,
      used: typeof data['used'] === 'number' ? (data['used'] as number) : undefined,
      available: typeof data['available'] === 'number' ? (data['available'] as number) : undefined,
      unlimited: data['unlimited'] === true,
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

  // Get balance snapshots
  const beforeSnapshot = await getNewApiTokenUsage(baseUrl, apiKey);
  report.balanceSnapshot = beforeSnapshot;

  // Run empty reply probe
  report.emptyReplyProbe = await runEmptyReplyProbe(baseUrl, apiKey, modelId, beforeSnapshot, manualBeforeBalance, manualAfterBalance);

  // Run failed request probe
  report.failedRequestProbe = await runFailedRequestProbe(baseUrl, apiKey, beforeSnapshot, manualBeforeBalance, manualAfterBalance);

  return report;
}

function createNotTestedProbe(key: 'empty_reply_charge' | 'failed_request_charge', title: string): BillingProbeResult {
  return {
    key,
    title,
    status: 'not_tested',
    confirmed: false,
    highRisk: false,
    visibleOutputLength: 0,
    hasToolCall: false,
    hasImage: false,
    hasAudio: false,
    hasSearch: false,
    message: '',
    suggestion: '',
  };
}

function createSkippedProbe(key: 'empty_reply_charge' | 'failed_request_charge', title: string, reason: string): BillingProbeResult {
  return {
    key,
    title,
    status: 'skipped',
    confirmed: false,
    highRisk: false,
    visibleOutputLength: 0,
    hasToolCall: false,
    hasImage: false,
    hasAudio: false,
    hasSearch: false,
    message: reason,
    suggestion: '',
  };
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
    return createSkippedProbe('empty_reply_charge', 'Empty Reply Charge', 'No model selected');
  }

  let afterSnapshot: BalanceSnapshot | null = null;
  let afterBalance: number | undefined;
  let beforeBalance: number | undefined;
  let balanceSource: 'newapi' | 'manual' | 'unavailable' = 'unavailable';

  // Determine before balance
  if (beforeSnapshot.supported && beforeSnapshot.available !== undefined && !beforeSnapshot.unlimited) {
    beforeBalance = beforeSnapshot.available;
    balanceSource = 'newapi';
  } else if (manualBeforeBalance !== undefined) {
    beforeBalance = manualBeforeBalance;
    balanceSource = 'manual';
  }

  const result: BillingProbeResult = {
    key: 'empty_reply_charge',
    title: 'Empty Reply Charge',
    status: 'skipped',
    confirmed: false,
    highRisk: false,
    visibleOutputLength: 0,
    hasToolCall: false,
    hasImage: false,
    hasAudio: false,
    hasSearch: false,
    message: '',
    suggestion: '',
    balanceSource,
    beforeBalance,
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

    // Get after balance
    afterSnapshot = await getNewApiTokenUsage(baseUrl, apiKey);
    if (afterSnapshot.supported && afterSnapshot.available !== undefined && !afterSnapshot.unlimited) {
      afterBalance = afterSnapshot.available;
    } else if (manualAfterBalance !== undefined) {
      afterBalance = manualAfterBalance;
      if (balanceSource === 'unavailable') balanceSource = 'manual';
    }

    result.afterBalance = afterBalance;
    if (beforeBalance !== undefined && afterBalance !== undefined) {
      result.balanceDelta = beforeBalance - afterBalance;
    }

    if (!response.ok) {
      result.status = 'needs_review';
      result.message = `HTTP ${response.status}`;
      result.suggestion = 'Request failed with non-200 status';
      return result;
    }

    // Read stream
    const text = await response.text();
    result.streamStatus = 'unknown';

    const streamData = parseSSEStream(text);
    let visibleOutputLength = 0;
    let completionTokens: number | undefined;
    let promptTokens: number | undefined;
    let totalTokens: number | undefined;
    let hasToolCall = false;
    let hasImage = false;
    let hasAudio = false;
    let hasSearch = false;

    for (const event of streamData) {
      if (event['error']) {
        result.status = 'needs_review';
        result.message = String(event['error']);
        result.suggestion = 'Stream returned error event';
        return result;
      }

      const choices = event['choices'];
      if (choices && Array.isArray(choices)) {
        for (const choice of choices) {
          const delta = choice['delta'];
          if (delta) {
            const content = delta['content'];
            if (typeof content === 'string' && content.length > 0) {
              visibleOutputLength += content.length;
            }

            const toolCalls = delta['tool_calls'];
            if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
              hasToolCall = true;
            }

            if (delta['audio']) hasAudio = true;
            if (delta['image_url']) hasImage = true;
            if (delta['search_results']) hasSearch = true;
          }

          const finishReason = choice['finish_reason'];
          if (finishReason === 'stop' || finishReason === 'eos') {
            result.streamStatus = 'done';
          }
        }
      }

      const usage = event['usage'];
      if (usage) {
        completionTokens = typeof usage['completion_tokens'] === 'number' ? (usage['completion_tokens'] as number) : undefined;
        promptTokens = typeof usage['prompt_tokens'] === 'number' ? (usage['prompt_tokens'] as number) : undefined;
        totalTokens = typeof usage['total_tokens'] === 'number' ? (usage['total_tokens'] as number) : undefined;
      }
    }

    result.visibleOutputLength = visibleOutputLength;
    result.completionTokens = completionTokens;
    result.promptTokens = promptTokens;
    result.totalTokens = totalTokens;
    result.hasToolCall = hasToolCall;
    result.hasImage = hasImage;
    result.hasAudio = hasAudio;
    result.hasSearch = hasSearch;

    // Check if empty reply risk
    const isEmptyReply = visibleOutputLength === 0 && !hasToolCall && !hasImage && !hasAudio && !hasSearch;
    const isZeroOrMissingCompletion = completionTokens === 0 || completionTokens === undefined;

    if (isEmptyReply && isZeroOrMissingCompletion) {
      // Empty reply risk confirmed
      if (result.balanceDelta !== undefined && result.balanceDelta > EPSILON) {
        result.status = 'signal_confirmed';
        result.confirmed = true;
        result.highRisk = true;
        result.message = 'Empty reply with balance decrease detected';
        result.suggestion = 'Balance decreased despite no visible output';
      } else if (beforeSnapshot.unlimited) {
        result.status = 'needs_review';
        result.message = 'Empty reply detected, balance is unlimited or not auditable';
        result.suggestion = 'Balance is unlimited or cannot be audited';
      } else if (balanceSource === 'unavailable') {
        result.status = 'needs_review';
        result.message = 'Empty reply detected, balance could not be confirmed';
        result.suggestion = 'Balance unavailable. Check provider logs.';
      } else if (result.balanceDelta === undefined || result.balanceDelta <= EPSILON) {
        result.status = 'needs_review';
        result.message = 'Empty reply detected, balance change below precision or no deduction';
        result.suggestion = 'Balance change may be below display precision. Check provider logs.';
      }
    } else {
      // Normal response with output
      result.status = 'not_found';
      result.message = 'No empty-reply billing signal found';
      result.suggestion = 'Response contains visible output';
    }

    if (result.streamStatus === 'unknown' && visibleOutputLength > 0) {
      result.streamStatus = 'eof';
    }

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
  let afterSnapshot: BalanceSnapshot | null = null;
  let afterBalance: number | undefined;
  let beforeBalance: number | undefined;
  let balanceSource: 'newapi' | 'manual' | 'unavailable' = 'unavailable';

  if (beforeSnapshot.supported && beforeSnapshot.available !== undefined && !beforeSnapshot.unlimited) {
    beforeBalance = beforeSnapshot.available;
    balanceSource = 'newapi';
  } else if (manualBeforeBalance !== undefined) {
    beforeBalance = manualBeforeBalance;
    balanceSource = 'manual';
  }

  const result: BillingProbeResult = {
    key: 'failed_request_charge',
    title: 'Failed Request Charge',
    status: 'skipped',
    confirmed: false,
    highRisk: false,
    visibleOutputLength: 0,
    hasToolCall: false,
    hasImage: false,
    hasAudio: false,
    hasSearch: false,
    message: '',
    suggestion: '',
    balanceSource,
    beforeBalance,
  };

  const invalidModel = `ai-api-doctor-invalid-model-${Date.now()}`;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: invalidModel,
        messages: [{ role: 'user', content: 'Reply exactly: 1' }],
        max_tokens: 5,
        temperature: 0,
        stream: false,
      }),
    });

    result.httpStatus = response.status;

    afterSnapshot = await getNewApiTokenUsage(baseUrl, apiKey);
    if (afterSnapshot.supported && afterSnapshot.available !== undefined && !afterSnapshot.unlimited) {
      afterBalance = afterSnapshot.available;
    } else if (manualAfterBalance !== undefined) {
      afterBalance = manualAfterBalance;
      if (balanceSource === 'unavailable') balanceSource = 'manual';
    }

    result.afterBalance = afterBalance;
    if (beforeBalance !== undefined && afterBalance !== undefined) {
      result.balanceDelta = beforeBalance - afterBalance;
    }

    const isFailedRequest = !response.ok;

    if (isFailedRequest) {
      if (result.balanceDelta !== undefined && result.balanceDelta > EPSILON) {
        result.status = 'signal_confirmed';
        result.confirmed = true;
        result.highRisk = true;
        result.message = 'Failed request with balance decrease detected';
        result.suggestion = 'Balance decreased despite request failure';
      } else if (beforeSnapshot.unlimited) {
        result.status = 'needs_review';
        result.message = 'Failed request detected, balance is unlimited or not auditable';
        result.suggestion = 'Balance is unlimited or cannot be audited';
      } else if (balanceSource === 'unavailable') {
        result.status = 'needs_review';
        result.message = 'Failed request detected, balance could not be confirmed';
        result.suggestion = 'Balance unavailable. Check provider logs.';
      } else {
        result.status = 'not_found';
        result.message = 'No failed-request billing signal found';
        result.suggestion = 'Request failed but no balance deduction';
      }
    } else {
      result.status = 'needs_review';
      result.message = 'Request unexpectedly succeeded with invalid model';
      result.suggestion = 'Unexpected success with invalid model';
    }

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
