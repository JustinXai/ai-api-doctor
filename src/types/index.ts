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

// ─── Diagnosis Types ───────────────────────────────────────

export type DiagnosisStatus = 'success' | 'warning' | 'error' | 'skipped';

export type DiagnosisStepId =
  | 'base_url_format'
  | 'key_present'
  | 'models_endpoint'
  | 'model_selected'
  | 'chat_completion'
  | 'usage_reported'
  | 'usage_audit';

export type ApiErrorType =
  // ── Network ──────────────────────────────────────────────
  | 'NETWORK_ERROR'           // fetch threw: DNS, timeout, CORS, no internet
  | 'SSL_ERROR'               // SSL certificate problem
  | 'CORS_ERROR'              // blocked by CORS / host permission
  | 'HOST_UNREACHABLE'        // domain not reachable
  // ── HTTP Status ─────────────────────────────────────────
  | 'HTTP_400'               // Bad request
  | 'HTTP_401'               // API key invalid or missing
  | 'HTTP_402'               // Payment required / balance insufficient
  | 'HTTP_403'               // Generic forbidden
  | 'HTTP_404'               // Endpoint not found (wrong URL)
  | 'HTTP_408'               // Request timeout
  | 'HTTP_429'               // Rate limited
  | 'HTTP_5XX'               // Server error
  // ── Response Type ────────────────────────────────────────
  | 'NON_JSON_RESPONSE'       // Server returned HTML / non-JSON
  | 'HTML_RESPONSE'            // Server returned HTML (maybe a login page / 404 page)
  | 'CLOUDFLARE_BLOCK'        // Cloudflare challenged the request
  | 'LOGIN_PAGE'              // Redirected to a login page
  // ── Key / Auth ─────────────────────────────────────────
  | 'KEY_EMPTY'               // No API key provided
  | 'KEY_EXPIRED'             // Key has expired
  | 'KEY_DISABLED'            // Key has been disabled
  | 'KEY_WRONG_HOST'          // Key belongs to a different site
  | 'KEY_NO_BALANCE'          // Key has no balance / quota exhausted
  | 'KEY_NO_PERMISSION'        // Key lacks group / model permission
  | 'KEY_IP_RESTRICTED'        // Key is restricted to specific IPs
  | 'KEY_CONCURRENCY_LIMITED'  // Key has hit concurrency limit
  // ── Model / Group ───────────────────────────────────────
  | 'MODEL_NOT_SELECTED'       // No model selected for diagnosis
  | 'MODEL_NOT_FOUND'          // Model ID not found on this provider
  | 'MODEL_ALIAS_NOT_CONFIGURED' // Model alias not set up
  | 'MODEL_NOT_IN_GROUP'       // Model not in this key's group
  | 'GROUP_NO_MODEL'           // Key's group doesn't include this model
  | 'CHANNEL_UNAVAILABLE'       // Model's bound channel is down
  | 'MODEL_UNSUPPORTED'         // /v1/models not supported (but chat may still work)
  | 'MODELS_ENDPOINT_403'      // /v1/models returns 403
  // ── Usage / Billing ─────────────────────────────────────
  | 'USAGE_MISSING'            // No usage data in response
  | 'USAGE_ANOMALY_HIGH'       // total_tokens unusually high
  | 'USAGE_ANOMALY_COMPLETION' // completion_tokens >> max_tokens
  | 'USAGE_DEDUCTION_SUSPECTED' // Request failed but may have been charged
  | 'USAGE_BALANCE_MISMATCH'   // Balance change doesn't match usage
  // ── Misc ────────────────────────────────────────────────
  | 'UNKNOWN_ERROR';

export interface DiagnosisUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
}

export interface DiagnosisStepResult {
  id: DiagnosisStepId;
  title: string;
  status: DiagnosisStatus;
  latencyMs?: number;
  httpStatus?: number;
  message: string;
  providerMessage?: string;
  suggestion?: string;
  errorType?: ApiErrorType;
  usage?: DiagnosisUsage;
}

export interface DiagnosisUsageSummary {
  status: 'skipped' | 'available' | 'missing' | 'anomaly';
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  hasUsage: boolean;
  suspicious: boolean;
  note?: string;
}

export interface DiagnosisReport {
  providerName: string;
  maskedKey: string;
  activeModelId?: string;
  startedAt: string;
  totalLatencyMs?: number;
  overallStatus: DiagnosisStatus;
  passedCount: number;
  totalCount: number;
  steps: DiagnosisStepResult[];
  usageSummary?: DiagnosisUsageSummary;
}

// ─── Legacy / Compatibility ────────────────────────────────

export type ApiErrorCode =
  | 'NETWORK_ERROR'
  | 'HTTP_401'
  | 'HTTP_403'
  | 'HTTP_404'
  | 'HTTP_429'
  | 'HTTP_5XX'
  | 'NON_JSON_RESPONSE'
  | 'MODELS_UNSUPPORTED'
  | 'MODEL_ACCESS_DENIED'
  | 'UNKNOWN_ERROR';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  providerMessage?: string;
  httpStatus?: number;
}

export interface ConnectivityTestResult {
  success: boolean;
  latency?: number;
  error?: ApiError;
  timestamp: number;
  activeModelId?: string;
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
  activeModelId?: string;
}
