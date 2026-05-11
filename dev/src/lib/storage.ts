import {
  Provider,
  ApiKey,
  ExtensionSettings,
  ConnectivityTestResult,
  ApiError,
  ApiErrorCode,
} from '../types';
import { DEFAULT_PROVIDER, DEFAULT_SETTINGS } from './defaults';

const STORAGE_KEYS = {
  PROVIDERS: 'providers',
  API_KEYS: 'apiKeys',
  ACTIVE_PROVIDER: 'activeProviderId',
  SETTINGS: 'settings',
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

export async function getProviders(): Promise<Provider[]> {
  const providers = await getFromStorage<Provider[]>(STORAGE_KEYS.PROVIDERS);
  if (!providers || providers.length === 0) {
    await saveProviders([DEFAULT_PROVIDER]);
    return [DEFAULT_PROVIDER];
  }
  return providers;
}

export async function saveProviders(providers: Provider[]): Promise<void> {
  await setToStorage(STORAGE_KEYS.PROVIDERS, providers);
}

export async function addProvider(provider: Provider): Promise<void> {
  const providers = await getProviders();
  providers.push(provider);
  await saveProviders(providers);
}

export async function updateProvider(
  id: string,
  updates: Partial<Provider>
): Promise<void> {
  const providers = await getProviders();
  const index = providers.findIndex((p) => p.id === id);
  if (index !== -1) {
    providers[index] = { ...providers[index], ...updates };
    await saveProviders(providers);
  }
}

export async function deleteProvider(id: string): Promise<void> {
  const providers = await getProviders();
  const filtered = providers.filter((p) => p.id !== id);
  await saveProviders(filtered);
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
  const filtered = keys.filter((k) => k.id !== id);
  await saveApiKeys(filtered);
}

export async function getActiveProvider(): Promise<Provider | null> {
  const activeId = await getFromStorage<string>(STORAGE_KEYS.ACTIVE_PROVIDER);
  if (!activeId) {
    return DEFAULT_PROVIDER;
  }
  const providers = await getProviders();
  return providers.find((p) => p.id === activeId) || DEFAULT_PROVIDER;
}

export async function setActiveProvider(id: string): Promise<void> {
  await setToStorage(STORAGE_KEYS.ACTIVE_PROVIDER, id);
}

export async function getActiveApiKey(providerId: string): Promise<ApiKey | null> {
  const keys = await getApiKeys();
  return keys.find((k) => k.providerId === providerId) || null;
}

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

export function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return '****';
  }
  const prefix = key.substring(0, 3);
  const suffix = key.substring(key.length - 4);
  return `${prefix}****${suffix}`;
}

// ─────────────────────────────────────────────────────────
// Error Classification
// ─────────────────────────────────────────────────────────

function classifyHttpError(status: number, bodyText: string): ApiError {
  let providerMessage: string | undefined;
  try {
    const parsed = JSON.parse(bodyText);
    providerMessage =
      parsed?.error?.message ||
      parsed?.message ||
      parsed?.detail ||
      parsed?.error ||
      undefined;
    if (typeof providerMessage === 'object') {
      providerMessage = JSON.stringify(providerMessage);
    }
  } catch {
    // Not JSON — store raw text snippet safely
    if (bodyText && bodyText.length > 0) {
      providerMessage = bodyText.slice(0, 200);
    }
  }

  switch (status) {
    case 401:
      return {
        code: 'HTTP_401',
        message: 'API key is invalid or missing.',
        providerMessage,
        httpStatus: status,
      };
    case 403:
      return {
        code: 'HTTP_403',
        message:
          'Permission denied — this API key does not have access to the selected model or model group.',
        providerMessage,
        httpStatus: status,
      };
    case 404:
      return {
        code: 'HTTP_404',
        message:
          'Endpoint not found — the base URL may be incorrect or this resource does not exist.',
        providerMessage,
        httpStatus: status,
      };
    case 429:
      return {
        code: 'HTTP_429',
        message: 'Rate limited or quota exceeded. Please wait and try again.',
        providerMessage,
        httpStatus: status,
      };
    default:
      if (status >= 500) {
        return {
          code: 'HTTP_5XX',
          message: `Server error (HTTP ${status}). The provider's server encountered an internal error.`,
          providerMessage,
          httpStatus: status,
        };
      }
      return {
        code: 'UNKNOWN_ERROR',
        message: `Request failed with HTTP ${status}.`,
        providerMessage,
        httpStatus: status,
      };
  }
}

function classifyNetworkError(cause: string | Error): ApiError {
  const msg = cause instanceof Error ? cause.message : cause;
  const lower = msg.toLowerCase();
  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('dns') ||
    lower.includes('erefused') ||
    lower.includes('timeout') ||
    lower.includes('net::')
  ) {
    return {
      code: 'NETWORK_ERROR',
      message: 'Network error — could not reach the API server. Check your connection or base URL.',
    };
  }
  if (lower.includes('cors') || lower.includes('access-control')) {
    return {
      code: 'NETWORK_ERROR',
      message: 'CORS error — the server blocked the request. The provider may not allow browser requests.',
    };
  }
  return {
    code: 'NETWORK_ERROR',
    message: `Network error: ${msg}`,
  };
}

function classifyNonJsonResponse(
  status: number,
  bodyText: string
): ApiError {
  const trimmed = bodyText.trim();
  if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
    return {
      code: 'NON_JSON_RESPONSE',
      message:
        'Server returned an HTML page instead of JSON. The base URL may be wrong or the endpoint is not supported.',
      httpStatus: status,
    };
  }
  return {
    code: 'NON_JSON_RESPONSE',
    message: 'Server returned a non-JSON response. The endpoint may not be supported.',
    httpStatus: status,
  };
}

function classifyModelsError(
  status: number,
  bodyText: string
): ApiError {
  if (status === 403) {
    return {
      code: 'MODEL_ACCESS_DENIED',
      message:
        'Permission denied when loading the model list. ' +
        'This provider may restrict access to the model listing endpoint. ' +
        'You can still manually enter a model ID and test chat completion.',
      httpStatus: status,
    };
  }
  if (status === 404) {
    return {
      code: 'MODELS_UNSUPPORTED',
      message:
        'Model listing endpoint not found (404). ' +
        'This provider may not support the /v1/models API. ' +
        'You can manually enter a model ID and test chat completion.',
      httpStatus: status,
    };
  }
  if (status === 401) {
    return classifyHttpError(401, bodyText);
  }
  const isHtml = bodyText.trim().startsWith('<') || bodyText.trim().startsWith('<!');
  if (isHtml) {
    return {
      code: 'NON_JSON_RESPONSE',
      message:
        'Server returned an HTML page. The /v1/models endpoint may not be supported by this provider.',
      httpStatus: status,
    };
  }
  return classifyHttpError(status, bodyText);
}

// ─────────────────────────────────────────────────────────
// fetchModels
// ─────────────────────────────────────────────────────────

export async function fetchModels(
  baseUrl: string,
  apiKey: string
): Promise<{ id: string; name: string }[]> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
  } catch (err) {
    throw classifyNetworkError(err as Error);
  }

  const rawText = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    throw classifyModelsError(response.status, rawText);
  }

  if (!contentType.includes('application/json')) {
    throw classifyNonJsonResponse(response.status, rawText);
  }

  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw {
      code: 'NON_JSON_RESPONSE',
      message:
        'Failed to parse the model response as JSON. The /v1/models endpoint may return non-standard data.',
      httpStatus: response.status,
    } as ApiError;
  }

  if (Array.isArray(data)) {
    return data.map((item) => {
      if (typeof item === 'string') return { id: item, name: item };
      return {
        id: (item as { id?: string }).id || String(item),
        name: (item as { id?: string }).id || String(item),
      };
    });
  }

  if (typeof data === 'object' && data !== null && 'data' in data) {
    const responseData = data as { data: unknown[] };
    if (!Array.isArray(responseData.data)) {
      throw {
        code: 'MODELS_UNSUPPORTED',
        message: 'Invalid model response format from the /v1/models endpoint.',
        httpStatus: response.status,
      } as ApiError;
    }
    return responseData.data.map((model) => {
      if (typeof model === 'string') return { id: model, name: model };
      return {
        id: (model as { id?: string }).id || String(model),
        name: (model as { id?: string }).id || String(model),
      };
    });
  }

  throw {
    code: 'MODELS_UNSUPPORTED',
    message: 'Unrecognized model response format. The /v1/models endpoint may not be fully supported.',
    httpStatus: response.status,
  } as ApiError;
}

// ─────────────────────────────────────────────────────────
// testConnectivity — model-aware
// ─────────────────────────────────────────────────────────

export async function testConnectivity(
  baseUrl: string,
  apiKey: string,
  modelId?: string
): Promise<ConnectivityTestResult> {
  const startTime = Date.now();

  // If modelId is provided, do a real chat/completions test
  if (modelId) {
    return testChatCompletion(baseUrl, apiKey, modelId, startTime);
  }

  // Otherwise try /v1/models as a lightweight probe
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
    return {
      success: false,
      error: classifyNetworkError(err as Error),
      timestamp: Date.now(),
    };
  }

  const latency = Date.now() - startTime;
  const rawText = await response.text();

  if (response.ok) {
    return {
      success: true,
      latency,
      timestamp: Date.now(),
    };
  }

  // Even if /v1/models fails, the provider may still be usable for chat
  const apiError = classifyHttpError(response.status, rawText);
  return {
    success: false,
    error: apiError,
    latency,
    timestamp: Date.now(),
  };
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
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });
  } catch (err) {
    return {
      success: false,
      error: classifyNetworkError(err as Error),
      timestamp: Date.now(),
      activeModelId: modelId,
    };
  }

  const latency = Date.now() - startTime;
  const rawText = await response.text();

  if (response.ok) {
    return {
      success: true,
      latency,
      timestamp: Date.now(),
      activeModelId: modelId,
    };
  }

  const apiError = classifyHttpError(response.status, rawText);
  return {
    success: false,
    error: apiError,
    latency,
    timestamp: Date.now(),
    activeModelId: modelId,
  };
}

// Active model ID — stored as a top-level key for quick access
export async function getActiveModelId(): Promise<string> {
  const id = await getFromStorage<string>('activeModelId');
  return id || '';
}

export async function setActiveModelId(modelId: string): Promise<void> {
  await setToStorage('activeModelId', modelId);
}

export async function clearActiveModelId(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove('activeModelId', resolve);
  });
}

// Language preference
export async function getLanguage(): Promise<'auto' | 'zh-CN' | 'en-US'> {
  const lang = await getFromStorage<string>('language');
  if (lang === 'zh-CN' || lang === 'en-US' || lang === 'auto') return lang;
  return 'auto';
}

export async function setLanguage(lang: 'auto' | 'zh-CN' | 'en-US'): Promise<void> {
  await setToStorage('language', lang);
}

// ─────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'COPY_TO_CLIPBOARD', text },
      (result) => {
        if (chrome.runtime.lastError) {
          navigator.clipboard.writeText(text).then(resolve).catch(reject);
        } else {
          resolve();
        }
      }
    );
  });
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function exportToJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
