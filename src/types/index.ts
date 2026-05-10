export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  recommended?: boolean;
  enabled?: boolean;
}

export interface ApiKey {
  id: string;
  providerId: string;
  key: string;
  name?: string;
  createdAt: number;
}

export interface ApiModel {
  id: string;
  name: string;
  providerId: string;
}

export interface ConnectivityTestResult {
  success: boolean;
  latency?: number;
  error?: string;
  timestamp: number;
}

export interface ExportTarget {
  type: 'claude' | 'openai' | 'generic';
  name: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
}

export interface ExtensionSettings {
  theme: 'light' | 'dark' | 'system';
  autoConnect: boolean;
  showKeyPrefix: boolean;
}
