// ─── Active Config (MVP single-config model) ──────────────

export type ConfigSource = 'custom' | 'example' | 'newapi';

export type CostAuditCurrency = 'USD' | 'CNY' | 'points';

export interface CostAuditConfig {
  inputPricePerM?: number;
  outputPricePerM?: number;
  cachedInputPricePerM?: number;
  cacheWritePricePerM?: number;
  beforeBalance?: number;
  afterBalance?: number;
  currency?: CostAuditCurrency;
}

export interface ActiveConfig {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  modelId?: string;
  source?: ConfigSource;
  updatedAt: string;
  costAudit?: CostAuditConfig;
}

// ─── Provider / Key (legacy — kept for migration compatibility) ─

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  /** 'custom' = user-added, 'example' = pre-loaded demo provider */
  source?: 'custom' | 'example';
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
  | 'NETWORK_ERROR'
  | 'SSL_ERROR'
  | 'CORS_ERROR'
  | 'HOST_UNREACHABLE'
  | 'HTTP_400'
  | 'HTTP_401'
  | 'HTTP_402'
  | 'HTTP_403'
  | 'HTTP_404'
  | 'HTTP_408'
  | 'HTTP_429'
  | 'HTTP_5XX'
  | 'NON_JSON_RESPONSE'
  | 'HTML_RESPONSE'
  | 'CLOUDFLARE_BLOCK'
  | 'LOGIN_PAGE'
  | 'KEY_EMPTY'
  | 'KEY_EXPIRED'
  | 'KEY_DISABLED'
  | 'KEY_WRONG_HOST'
  | 'KEY_NO_BALANCE'
  | 'KEY_NO_PERMISSION'
  | 'KEY_IP_RESTRICTED'
  | 'KEY_CONCURRENCY_LIMITED'
  | 'MODEL_NOT_SELECTED'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_ALIAS_NOT_CONFIGURED'
  | 'MODEL_NOT_IN_GROUP'
  | 'GROUP_NO_MODEL'
  | 'CHANNEL_UNAVAILABLE'
  | 'MODEL_UNSUPPORTED'
  | 'MODELS_ENDPOINT_403'
  | 'USAGE_MISSING'
  | 'USAGE_ANOMALY_HIGH'
  | 'USAGE_ANOMALY_COMPLETION'
  | 'USAGE_DEDUCTION_SUSPECTED'
  | 'USAGE_BALANCE_MISMATCH'
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
  modelCount?: number;
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
  billingAnomaly?: BillingAnomalyReport;
}

export type TrustScoreCategoryKey = 'execution' | 'cost' | 'access' | 'compatibility' | 'speed' | 'capability';

export interface TrustScoreCategory {
  key: TrustScoreCategoryKey;
  label: string;
  labelZh: string;
  weight: number;
  score: number;
  status: DiagnosisStatus;
}

export interface TrustScore {
  score: number;
  confidence: 'high' | 'medium' | 'low';
  categories: TrustScoreCategory[];
  riskTags: string[];
}

export interface CostAuditResult {
  estimatedCost?: number;
  balanceDelta?: number;
  costRatio?: number;
  effectivePricePerM?: number;
  currency: CostAuditCurrency;
  status: 'ok' | 'review' | 'high-diff' | 'unavailable';
}

// ─── Billing Anomaly Probes ────────────────────────────────

export type BalanceSnapshotSource = 'newapi' | 'manual' | 'unsupported';

export interface BalanceSnapshot {
  supported: boolean;
  source: BalanceSnapshotSource;
  granted?: number;
  used?: number;
  available?: number;
  unlimited?: boolean;
  raw?: unknown;
  error?: string;
}

export type BillingProbeKey = 'empty_reply_charge' | 'failed_request_charge';

export type BillingProbeStatus = 'not_tested' | 'skipped' | 'not_found' | 'needs_review' | 'signal_confirmed';

export interface BillingProbeResult {
  key: BillingProbeKey;
  title: string;
  status: BillingProbeStatus;
  confirmed: boolean;
  highRisk: boolean;
  httpStatus?: number;
  requestId?: string;
  streamStatus?: 'done' | 'eof' | 'error' | 'aborted' | 'unknown';
  visibleOutputLength: number;
  completionTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
  hasToolCall: boolean;
  hasImage: boolean;
  hasAudio: boolean;
  hasSearch: boolean;
  balanceSource?: 'newapi' | 'manual' | 'unavailable';
  beforeBalance?: number;
  afterBalance?: number;
  balanceDelta?: number;
  message: string;
  suggestion: string;
}

export interface BillingAnomalyReport {
  enabled: boolean;
  balanceSnapshot?: BalanceSnapshot;
  emptyReplyProbe?: BillingProbeResult;
  failedRequestProbe?: BillingProbeResult;
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
  | 'HOST_PERMISSION_DENIED'
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
