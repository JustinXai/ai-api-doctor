import { Provider, ExtensionSettings } from '../types';

export const DEFAULT_PROVIDER: Provider = {
  id: 'link-ai-default',
  name: 'Link-AI',
  baseUrl: 'https://api1.link-ai.cc/v1',
  recommended: true,
  enabled: true,
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  theme: 'system',
  autoConnect: false,
  showKeyPrefix: true,
};

export const STORAGE_QUOTA_WARNING =
  'Chrome storage.local has a quota of approximately 10MB. Consider cleaning up unused API keys.';
