import { Provider, ApiKey, ExtensionSettings, ConnectivityTestResult } from '../types';
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

export async function testConnectivity(
  baseUrl: string,
  apiKey: string
): Promise<ConnectivityTestResult> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const latency = Date.now() - startTime;

    if (response.ok) {
      return {
        success: true,
        latency,
        timestamp: Date.now(),
      };
    } else {
      const errorText = await response.text().catch(() => 'Unknown error');
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText.substring(0, 100)}`,
        timestamp: Date.now(),
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
      timestamp: Date.now(),
    };
  }
}

export async function fetchModels(
  baseUrl: string,
  apiKey: string
): Promise<{ id: string; name: string }[]> {
  const response = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const rawText = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    throw new Error(`Failed to fetch models: HTTP ${response.status}`);
  }

  if (!contentType.includes('application/json')) {
    const isHtml = rawText.trim().startsWith('<');
    if (isHtml) {
      throw new Error(
        'The server returned an HTML page instead of OpenAI-compatible model JSON. ' +
        'This provider may not support the /v1/models endpoint.'
      );
    }
    throw new Error(
      'This provider did not return JSON from /v1/models. It may not support model listing.'
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(
      'Failed to parse model response as JSON. This provider may not support model listing.'
    );
  }

  // Handle array response (some proxies return arrays directly)
  if (Array.isArray(data)) {
    return data.map((item) => {
      if (typeof item === 'string') {
        return { id: item, name: item };
      }
      return { id: (item as { id: string }).id, name: (item as { id: string }).id };
    });
  }

  // Handle standard OpenAI response: { object: "list", data: [...] }
  if (typeof data === 'object' && data !== null && 'data' in data) {
    const responseData = data as { data: unknown[] };
    if (!Array.isArray(responseData.data)) {
      throw new Error(
        'Invalid model response format. This provider may not support model listing.'
      );
    }
    return responseData.data.map((model) => {
      if (typeof model === 'string') {
        return { id: model, name: model };
      }
      const modelObj = model as { id: string };
      return { id: modelObj.id, name: modelObj.id };
    });
  }

  throw new Error(
    'Invalid model response format. This provider may not support model listing.'
  );
}

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
