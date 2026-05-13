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

// ─── Raw Quota (New API / One API) ────────────────────────

export interface RawQuotaBalance {
  userId: string;
  rawQuota: number;
  quotaPerUnit: number;
  usdBalance: number;
  usedQuota: number;
  requestCount: number;
  timestamp: number;
}

export interface RawQuotaTimeline {
  before?: RawQuotaBalance;
  afterImmediate?: RawQuotaBalance;
  after3s?: RawQuotaBalance;
  after10s?: RawQuotaBalance;
  delta3s?: number;
  delta10s?: number;
  readable: boolean;
  error?: string;
}

export type BillingJudgmentCode =
  | 'failed_request_not_charged'
  | 'precharge_refunded'
  | 'raw_quota_unavailable'
  | 'failed_request_charged'
  | 'empty_response_charged'
  | 'completed';

export type BillingJudgmentLevel = 'ok' | 'bad' | 'risk' | 'info';

export interface BillingJudgment {
  code: BillingJudgmentCode;
  level: BillingJudgmentLevel;
  title: string;
  titleZh: string;
  detail: string;
  detailZh: string;
}

// ─── Billing Anomaly Probes ────────────────────────────────

export type BalanceSnapshotSource = 'newapi' | 'manual' | 'unsupported' | 'unlimited';

export interface BalanceSnapshot {
  supported: boolean;
  source: BalanceSnapshotSource;
  granted?: number;
  used?: number;
  available?: number;
  unlimited?: boolean;
  precision?: number;
  raw?: unknown;
  error?: string;
}

export type BalanceTimelineStatus =
  | 'not_available'
  | 'available'
  | 'unlimited'
  | 'precision_limited'
  | 'precharge_refunded'
  | 'decreased'
  | 'incomplete';

export interface BalanceTimeline {
  before?: BalanceSnapshot;
  afterImmediate?: BalanceSnapshot;
  afterSettled?: BalanceSnapshot;
  beforeValue?: number;
  afterImmediateValue?: number;
  afterSettledValue?: number;
  deltaImmediate?: number;
  deltaSettled?: number;
  settlementDelayMs: number;
  source: 'newapi' | 'manual' | 'unsupported' | 'unlimited';
  status: BalanceTimelineStatus;
}

export interface OutputSignal {
  visibleText: string;
  visibleOutputLength: number;
  completionTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
  finishReason?: string;
  stopReason?: string;
  hasToolCall: boolean;
  hasImage: boolean;
  hasAudio: boolean;
  hasSearch: boolean;
  hasRefusal: boolean;
  hasContentFilter: boolean;
  hasErrorEvent: boolean;
  hasAnyEffectiveOutput: boolean;
}

export type BillingProbeKey = 'empty_reply_charge' | 'failed_request_charge';

export type BillingProbeResultStatus = 'not_tested' | 'skipped' | 'not_found' | 'needs_review' | 'signal_confirmed';

export interface BillingProbeResult {
  key: BillingProbeKey;
  title: string;
  status: BillingProbeResultStatus;
  confirmed: boolean;
  highRisk: boolean;

  httpStatus?: number;
  requestId?: string;
  endpoint?: string;
  model?: string;

  streamStatus?: 'done' | 'eof' | 'error' | 'aborted' | 'unknown';
  providerMessage?: string;

  outputSignal: OutputSignal;
  balanceTimeline?: BalanceTimeline;

  message: string;
  suggestion: string;

  // Legacy compatibility
  visibleOutputLength?: number;
  completionTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
  hasToolCall?: boolean;
  hasImage?: boolean;
  hasAudio?: boolean;
  hasSearch?: boolean;
  balanceSource?: 'newapi' | 'manual' | 'unavailable';
  beforeBalance?: number;
  afterBalance?: number;
  balanceDelta?: number;
}

export interface BillingAnomalyReport {
  enabled: boolean;
  balanceSnapshot?: BalanceSnapshot;
  emptyReplyProbe?: BillingProbeResult;
  failedRequestProbe?: BillingProbeResult;
}

export type BillingAnomalySummaryStatus =
  | 'not_enabled'
  | 'not_found'
  | 'needs_review'
  | 'signal_confirmed'
  | 'not_tested';

export interface BillingAnomalySummary {
  status: BillingAnomalySummaryStatus;
  title: string;
  titleZh: string;
  message: string;
  messageZh: string;
  riskTags: string[];
  severity: 'success' | 'warning' | 'error' | 'skipped';
}

// ─── Simplified Billing Diagnosis Report ───────────────────

export type DiagnosisProgressStep =
  | 'idle'
  | 'reading_before'
  | 'sending_request'
  | 'reading_after'
  | 'waiting_3s'
  | 'waiting_10s'
  | 'generating_report';

export interface DiagnosisProgress {
  step: DiagnosisProgressStep;
  message: string;
  messageZh: string;
  percent: number;
}

export interface BillingDiagnosisReport {
  providerName: string;
  maskedKey: string;
  activeModelId: string;
  baseUrl: string;
  startedAt: string;
  finishedAt: string;

  // Test results
  invalidModelTest?: BillingProbeResult;
  baselineTest?: BillingProbeResult;
  failedRequestTest?: BillingProbeResult;

  // Raw quota timeline
  rawQuotaTimeline?: RawQuotaTimeline;

  // Final judgment
  judgment: BillingJudgment;

  // Summary
  status: 'ok' | 'risk' | 'bad';
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
