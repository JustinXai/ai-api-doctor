/**
 * App.tsx — AI API Doctor MVP
 * Single-page popup with 4 tabs: Home, Models, Export, Help
 */

import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { toPng } from 'html-to-image';
import {
  Home,
  Boxes,
  Download,
  HelpCircle,
  Plus,
  ExternalLink,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Search,
  Copy,
  Globe,
} from 'lucide-react';
import {
  getActiveConfig,
  saveActiveConfig,
  updateActiveModelId,
  parseConnectionInput,
  runDiagnosis,
  fetchModels,
  copyToClipboard,
  getLanguage,
  setLanguage,
  runBillingAnomalyProbes,
} from '../../src/lib/storage';
import { t, resolveLanguage, Language } from '../../src/lib/i18n';
import type { ActiveConfig, DiagnosisReport, CostAuditConfig, CostAuditResult, BillingAnomalyReport, BillingProbeResult, BalanceSnapshot } from '../../src/types';

// ─── Language Context ──────────────────────────────────────

interface LangCtx {
  lang: 'zh-CN' | 'en-US';
  langSetting: Language;
  setLang: (l: Language) => void;
  t: (key: Parameters<typeof t>[1]) => string;
}

const LangContext = createContext<LangCtx>({
  lang: 'en-US',
  langSetting: 'auto',
  setLang: () => {},
  t: (key) => String(key),
});

function useLang() {
  return useContext(LangContext);
}

// ─── Type utilities ──────────────────────────────────────

type Page = 'home' | 'models' | 'export' | 'help';

// ─── Error Boundary ────────────────────────────────────────

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="error-boundary">
          <div className="error-boundary-icon">⚠</div>
          <div className="error-boundary-title">Something went wrong.</div>
          <div className="error-boundary-hint">
            Please reopen the extension or copy the error for feedback.
          </div>
          {this.state.error && (
            <pre className="error-boundary-stack">{this.state.error.message}</pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Trust Score Calculator ───────────────────────────────

type TrustScoreCategoryKey = 'billing' | 'execution' | 'access' | 'compatibility' | 'speed' | 'capability';

interface TrustScoreCategoryNew {
  key: TrustScoreCategoryKey;
  label: string;
  labelZh: string;
  weight: number;
  score: number;
  status: 'success' | 'warning' | 'error' | 'skipped';
}

interface TrustScoreNew {
  score: number;
  confidence: 'high' | 'medium' | 'low';
  categories: TrustScoreCategoryNew[];
  riskTags: string[];
}

function calculateTrustScore(report: DiagnosisReport, lang: 'zh-CN' | 'en-US'): TrustScoreNew {
  const categories: TrustScoreCategoryNew[] = [];
  const riskTags: string[] = [];

  // Access score (weight 15)
  const baseUrlStep = report.steps[0];
  const keyStep = report.steps[1];
  const modelsStep = report.steps[2];
  const modelStep = report.steps[3];
  const chatStep = report.steps[4];

  let accessScore = 100;
  let accessStatus: 'success' | 'warning' | 'error' | 'skipped' = 'success';

  if (baseUrlStep?.status === 'error' || keyStep?.status === 'error' || chatStep?.status === 'error') {
    const errorStep = baseUrlStep?.status === 'error' ? baseUrlStep : keyStep?.status === 'error' ? keyStep : chatStep;
    const httpStatus = errorStep?.httpStatus;
    if (httpStatus === 401) {
      accessScore = 20;
      riskTags.push('HTTP_401');
    } else if (httpStatus === 403) {
      accessScore = 25;
      riskTags.push('HTTP_403');
    } else if (httpStatus === 404) {
      accessScore = 30;
      riskTags.push('HTTP_404');
    } else {
      accessScore = 40;
      riskTags.push('ACCESS_ERROR');
    }
    accessStatus = 'error';
  } else if (modelStep?.status === 'warning' || !report.activeModelId) {
    accessScore = 60;
    accessStatus = 'warning';
    riskTags.push('MODEL_NOT_SELECTED');
  } else if (chatStep?.status === 'success') {
    accessScore = 95;
    accessStatus = 'success';
  } else {
    accessScore = 70;
    accessStatus = 'warning';
  }

  categories.push({
    key: 'access',
    label: 'Access',
    labelZh: '访问权限',
    weight: 15,
    score: accessScore,
    status: accessStatus,
  });

  // Execution score (weight 25)
  let execScore = 50;
  let execStatus: 'success' | 'warning' | 'error' | 'skipped' = 'skipped';

  if (chatStep?.status === 'success') {
    execScore = 90;
    execStatus = 'success';
  } else if (chatStep?.status === 'warning') {
    execScore = 65;
    execStatus = 'warning';
    riskTags.push('CHAT_WARNING');
  } else if (chatStep?.status === 'error') {
    execScore = 20;
    execStatus = 'error';
    riskTags.push('CHAT_FAILED');
  } else if (chatStep?.status === 'skipped') {
    execScore = 50;
    execStatus = 'skipped';
    riskTags.push('CHAT_SKIPPED');
  }

  categories.push({
    key: 'execution',
    label: 'Execution',
    labelZh: '执行能力',
    weight: 25,
    score: execScore,
    status: execStatus,
  });

  // Billing score (weight 35) - includes usage + anomaly probes
  let billingScore = 80;
  let billingStatusType: 'success' | 'warning' | 'error' | 'skipped' = 'success';
  let hasConfirmedAnomaly = false;
  let hasNeedsReviewAnomaly = false;
  let billingProbeStatus: TrustScoreNew['billingStatus'] = 'not_tested';

  const emptyProbe = report.billingAnomaly?.emptyReplyProbe;
  const failedProbe = report.billingAnomaly?.failedRequestProbe;

  if (emptyProbe?.status === 'signal_confirmed' || failedProbe?.status === 'signal_confirmed') {
    billingScore = 0;
    billingStatusType = 'error';
    hasConfirmedAnomaly = true;
    billingProbeStatus = 'signal_confirmed';
    if (emptyProbe?.status === 'signal_confirmed') {
      riskTags.push('EMPTY_REPLY_CHARGE_CONFIRMED');
    }
    if (failedProbe?.status === 'signal_confirmed') {
      riskTags.push('FAILED_REQUEST_CHARGE_CONFIRMED');
    }
  } else if (emptyProbe?.status === 'needs_review' || failedProbe?.status === 'needs_review') {
    billingScore = 40;
    billingStatusType = 'warning';
    hasNeedsReviewAnomaly = true;
    billingProbeStatus = 'needs_review';
    if (emptyProbe?.status === 'needs_review') {
      riskTags.push('EMPTY_REPLY_CHARGE_REVIEW');
    }
    if (failedProbe?.status === 'needs_review') {
      riskTags.push('FAILED_REQUEST_CHARGE_REVIEW');
    }
    if (!report.billingAnomaly?.balanceSnapshot?.supported) {
      riskTags.push('BALANCE_UNAVAILABLE');
    }
  } else if (!report.usageSummary) {
    billingScore = 45;
    billingStatusType = 'skipped';
    billingProbeStatus = 'not_tested';
  } else if (report.usageSummary.status === 'available') {
    billingScore = 90;
    billingStatusType = 'success';
    billingProbeStatus = 'not_found';
    if (report.usageSummary.totalTokens && report.usageSummary.totalTokens > 50000) {
      billingScore = 75;
      billingStatusType = 'warning';
      riskTags.push('HIGH_TOKEN_USAGE');
    }
  } else if (report.usageSummary.status === 'missing') {
    billingScore = 55;
    billingStatusType = 'warning';
    billingProbeStatus = 'needs_review';
    riskTags.push('USAGE_NOT_REPORTED');
  } else if (report.usageSummary.status === 'anomaly') {
    billingScore = 35;
    billingStatusType = 'error';
    billingProbeStatus = 'needs_review';
    riskTags.push('USAGE_ANOMALY');
  }

  categories.push({
    key: 'billing',
    label: 'Billing',
    labelZh: '扣费核对',
    weight: 35,
    score: billingScore,
    status: billingStatusType,
  });

  // Compatibility score (weight 10)
  let compatScore = 70;
  let compatStatus: 'success' | 'warning' | 'error' | 'skipped' = 'warning';

  if (modelsStep?.status === 'success' && modelsStep?.modelCount) {
    compatScore = 80;
    compatStatus = 'success';
  } else if (modelsStep?.status === 'warning') {
    compatScore = 60;
    compatStatus = 'warning';
  } else if (modelsStep?.status === 'error') {
    compatScore = 30;
    compatStatus = 'error';
    riskTags.push('MODELS_ENDPOINT_ERROR');
  }

  categories.push({
    key: 'compatibility',
    label: 'Compatibility',
    labelZh: '兼容性',
    weight: 10,
    score: compatScore,
    status: compatStatus,
  });

  // Speed score (weight 10)
  let speedScore = 70;
  let speedStatus: 'success' | 'warning' | 'error' | 'skipped' = 'success';

  const latency = report.totalLatencyMs || 0;
  if (latency < 3000) {
    speedScore = 95;
    speedStatus = 'success';
  } else if (latency < 8000) {
    speedScore = 70;
    speedStatus = 'warning';
  } else if (latency < 20000) {
    speedScore = 45;
    speedStatus = 'warning';
    riskTags.push('SLOW_RESPONSE');
  } else {
    speedScore = 25;
    speedStatus = 'error';
    riskTags.push('VERY_SLOW');
  }

  categories.push({
    key: 'speed',
    label: 'Speed',
    labelZh: '响应速度',
    weight: 10,
    score: speedScore,
    status: speedStatus,
  });

  // Capability score (weight 5) - placeholder
  categories.push({
    key: 'capability',
    label: 'Capability',
    labelZh: '功能能力',
    weight: 5,
    score: 70,
    status: 'skipped',
  });

  // Calculate total weighted score
  let totalScore = Math.round(
    categories.reduce((sum, cat) => sum + cat.score * (cat.weight / 100), 0)
  );

  // If billing anomaly confirmed, max score is 60
  if (hasConfirmedAnomaly) {
    totalScore = Math.min(totalScore, 60);
  } else if (hasNeedsReviewAnomaly) {
    totalScore = Math.min(totalScore, 75);
  }

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  const skippedCount = categories.filter((c) => c.status === 'skipped').length;
  if (skippedCount <= 1) {
    confidence = 'high';
  } else if (skippedCount >= 3) {
    confidence = 'low';
  }
  if (hasConfirmedAnomaly && report.billingAnomaly?.balanceSnapshot?.supported) {
    confidence = 'high';
  } else if (hasConfirmedAnomaly && !report.billingAnomaly?.balanceSnapshot?.supported) {
    confidence = 'medium';
  }

  // Determine overall label and main issue based on billing status
  let overallLabel = '';
  let overallLabelZh = '';
  let mainIssue = '';
  let mainIssueZh = '';
  let suggestion = '';
  let suggestionZh = '';

  if (hasConfirmedAnomaly) {
    overallLabel = 'Billing signal confirmed';
    overallLabelZh = '扣费异常信号已确认';
    mainIssue = 'Billing anomaly signal confirmed';
    mainIssueZh = '扣费异常信号已确认';
    suggestion = 'This test found a reproducible signal: no effective output or failed request with balance decrease. Contact your provider to review logs or refund.';
    suggestionZh = '本次测试出现"无有效输出/请求失败 + 余额减少"的可复现信号。建议联系站长核对消费日志或退款。';
  } else if (hasNeedsReviewAnomaly) {
    overallLabel = 'Billing risk needs review';
    overallLabelZh = '扣费风险需复查';
    mainIssue = 'Billing result needs review';
    mainIssueZh = '扣费结果需复查';
    suggestion = 'This test found billing risk signals, but balance could not be confirmed. Check provider dashboard or logs.';
    suggestionZh = '本次测试发现扣费风险信号，但余额无法自动确认。请结合站点后台消费记录核对。';
  } else if (!report.billingAnomaly?.enabled) {
    overallLabel = 'Ready';
    overallLabelZh = '可用';
    mainIssue = 'Billing anomaly probes not enabled';
    mainIssueZh = '未开启扣费异常检测';
    suggestion = 'This test only ran basic API diagnosis. Enable billing anomaly probes to check empty-reply and failed-request billing risks.';
    suggestionZh = '本次仅完成基础调用诊断。开启扣费异常检测后，可以检查空回复扣费和失败请求扣费风险。';
  } else if (!report.activeModelId) {
    overallLabel = 'Needs review';
    overallLabelZh = '需要复查';
    mainIssue = 'Model not selected';
    mainIssueZh = '未选择模型';
    suggestion = 'No model selected. Chat completion cannot be verified. Enter a model ID and run diagnosis again.';
    suggestionZh = '未选择模型，无法验证真实 chat/completions 调用。请填写模型 ID 后重新诊断。';
  } else if (totalScore >= 85) {
    overallLabel = 'Ready';
    overallLabelZh = '可用';
    mainIssue = 'No billing anomaly signal found';
    mainIssueZh = '未发现扣费异常信号';
    suggestion = 'This test did not find empty-reply or failed-request billing signals.';
    suggestionZh = '本次测试未发现空回复扣费或失败请求扣费信号。';
  } else if (totalScore >= 70) {
    overallLabel = 'Needs review';
    overallLabelZh = '需要复查';
    mainIssue = 'Some issues need review';
    mainIssueZh = '部分项目需复查';
    suggestion = 'Some diagnostic items show warnings. Review the report for details.';
    suggestionZh = '部分诊断项显示警告。请查看报告详情。';
  } else if (totalScore >= 50) {
    overallLabel = 'Risk found';
    overallLabelZh = '存在风险';
    mainIssue = 'Execution issues found';
    mainIssueZh = '发现执行问题';
    suggestion = 'Several diagnostic items failed or showed warnings. Review the report.';
    suggestionZh = '多项诊断失败或显示警告。请查看报告。';
  } else {
    overallLabel = 'High risk';
    overallLabelZh = '高风险';
    mainIssue = 'Multiple critical issues';
    mainIssueZh = '存在多个严重问题';
    suggestion = 'Critical issues detected. Review the report for details.';
    suggestionZh = '检测到严重问题。请查看报告详情。';
  }

  return {
    score: totalScore,
    confidence,
    categories,
    riskTags: [...new Set(riskTags)],
    billingStatus: billingProbeStatus,
    overallLabel,
    overallLabelZh,
    mainIssue,
    mainIssueZh,
    suggestion,
    suggestionZh,
  };
}

// ─── Cost Audit Calculator ─────────────────────────────────

function calculateCostAudit(
  usage: DiagnosisReport['usageSummary'],
  config?: CostAuditConfig
): CostAuditResult {
  const result: CostAuditResult = {
    currency: config?.currency || 'USD',
    status: 'unavailable',
  };

  if (!config?.inputPricePerM && !config?.outputPricePerM) {
    return result;
  }

  if (!usage || !usage.hasUsage || usage.totalTokens === undefined) {
    result.status = 'unavailable';
    return result;
  }

  // Calculate estimated cost
  const inputCost = (usage.promptTokens || 0) / 1_000_000 * (config.inputPricePerM || 0);
  const outputCost = (usage.completionTokens || 0) / 1_000_000 * (config.outputPricePerM || 0);
  const cachedCost = (usage.cachedTokens || 0) / 1_000_000 * (config.cachedInputPricePerM || 0);
  result.estimatedCost = inputCost + outputCost + cachedCost;

  // Calculate balance delta if both balances provided
  if (config.beforeBalance !== undefined && config.afterBalance !== undefined) {
    result.balanceDelta = config.beforeBalance - config.afterBalance;
  }

  // Calculate cost ratio
  if (result.balanceDelta !== undefined && result.estimatedCost && result.estimatedCost > 0) {
    result.costRatio = result.balanceDelta / result.estimatedCost;
  }

  // Calculate effective price
  if (result.balanceDelta !== undefined && usage.totalTokens) {
    result.effectivePricePerM = (result.balanceDelta / usage.totalTokens) * 1_000_000;
  }

  // Determine status
  if (result.costRatio !== undefined) {
    if (result.costRatio <= 1.2) {
      result.status = 'ok';
    } else if (result.costRatio <= 2) {
      result.status = 'review';
    } else {
      result.status = 'high-diff';
    }
  } else {
    result.status = 'ok';
  }

  return result;
}

// ─── Report Card V2 — Dark Incident Scorecard ─────────────

function ReportCardV2({
  report,
  baseUrl,
  lang,
  trustScore,
  costAudit,
}: {
  report: DiagnosisReport;
  baseUrl: string;
  lang: 'zh-CN' | 'en-US';
  trustScore: ReturnType<typeof calculateTrustScore>;
  costAudit: ReturnType<typeof calculateCostAudit>;
}) {
  const { t } = useLang();

  // Determine overall status based on billing probe status
  const hasBillingAnomalyConfirmed = report.billingAnomaly?.emptyReplyProbe?.status === 'signal_confirmed' || report.billingAnomaly?.failedRequestProbe?.status === 'signal_confirmed';
  const hasBillingAnomalyReview = report.billingAnomaly?.emptyReplyProbe?.status === 'needs_review' || report.billingAnomaly?.failedRequestProbe?.status === 'needs_review';
  const hasError = report.steps.some((s) => s.status === 'error');
  const hasWarning = report.steps.some((s) => s.status === 'warning');

  let overallStatus: 'ready' | 'needs-attention' | 'failed' | 'high-risk';
  if (hasBillingAnomalyConfirmed || hasError) {
    overallStatus = 'failed';
  } else if (hasBillingAnomalyReview || (hasWarning && trustScore.score < 85)) {
    overallStatus = 'needs-attention';
  } else if (trustScore.score < 70) {
    overallStatus = 'high-risk';
  } else {
    overallStatus = 'ready';
  }

  // Status label and color from trustScore
  const statusConfig = {
    ready: {
      label: lang === 'zh-CN' ? '可用' : 'READY',
      className: 'status-ready',
    },
    'needs-attention': {
      label: lang === 'zh-CN' ? '需要复查' : 'NEEDS REVIEW',
      className: 'status-attention',
    },
    'high-risk': {
      label: lang === 'zh-CN' ? '存在风险' : 'RISK FOUND',
      className: 'status-high-risk',
    },
    failed: {
      label: lang === 'zh-CN' ? '异常信号已确认' : 'SIGNAL CONFIRMED',
      className: 'status-failed',
    },
  }[overallStatus];

  // Build weighted donut conic-gradient
  const buildWeightedDonut = () => {
    let currentDeg = 0;
    const segments: string[] = [];

    trustScore.categories.forEach((cat) => {
      const segmentDeg = (cat.weight / 100) * 360;
      const color = cat.status === 'success' ? '#22C55E'
        : cat.status === 'warning' ? '#F59E0B'
        : cat.status === 'error' ? '#EF4444'
        : '#64748B';
      segments.push(`${color} ${currentDeg}deg ${currentDeg + segmentDeg}deg`);
      currentDeg += segmentDeg;
    });

    return segments.join(', ') + `, rgba(148,163,184,0.15) ${currentDeg}deg 360deg`;
  };

  // Confidence label
  const confidenceLabel = lang === 'zh-CN'
    ? (trustScore.confidence === 'high' ? '高' : trustScore.confidence === 'medium' ? '中' : '低')
    : trustScore.confidence.charAt(0).toUpperCase() + trustScore.confidence.slice(1);

  // Main issue from trustScore
  const mainIssueLabel = lang === 'zh-CN' ? trustScore.mainIssueZh : trustScore.mainIssue;
  const topSuggestion = lang === 'zh-CN' ? trustScore.suggestionZh : trustScore.suggestion;

  // Find step-level main issue for HTTP status
  const firstError = report.steps.find((s) => s.status === 'error');
  const firstWarning = report.steps.find((s) => s.status === 'warning');
  const mainIssue = firstError || firstWarning;

  // Usage string
  const usageStr = (() => {
    if (!report.usageSummary) return lang === 'zh-CN' ? '未测试' : 'Not tested';
    if (report.usageSummary.status === 'available' || report.usageSummary.status === 'anomaly') {
      return `${report.usageSummary.totalTokens} tokens`;
    }
    if (report.usageSummary.status === 'missing') {
      return lang === 'zh-CN' ? '未返回' : 'Not reported';
    }
    return lang === 'zh-CN' ? '未测试' : 'Not tested';
  })();

  // Latency
  const latencyStr = report.totalLatencyMs ? `${report.totalLatencyMs}ms` : null;

  // Tokens per second
  const tokensPerSec = (() => {
    if (report.usageSummary?.status === 'available' && report.usageSummary.totalTokens && report.totalLatencyMs) {
      return ((report.usageSummary.totalTokens / report.totalLatencyMs) * 1000).toFixed(1);
    }
    return null;
  })();

  // Models count
  const modelsCount = (() => {
    const modelsStep = report.steps.find((s) => s.title.toLowerCase().includes('model'));
    if (modelsStep?.modelCount !== undefined) {
      return lang === 'zh-CN' ? `${modelsStep.modelCount} 个` : `${modelsStep.modelCount} found`;
    }
    return lang === 'zh-CN' ? '—' : '—';
  })();

  // Step definitions
  const stepNames = ['Base URL', 'Key', 'Models', 'Model', 'Chat', 'Usage', 'Audit'];
  const stepNameKeys = [
    'reportCardStepBaseUrl',
    'reportCardStepKey',
    'reportCardStepModels',
    'reportCardStepModel',
    'reportCardStepChat',
    'reportCardStepUsage',
    'reportCardStepAudit',
  ];

  // Get step status
  const getStepStatus = (index: number): 'success' | 'warning' | 'error' | 'skipped' => {
    const step = report.steps[index];
    if (!step) return 'skipped';
    if (step.status === 'error') return 'error';
    if (step.status === 'warning') return 'warning';
    if (step.status === 'skipped') return 'skipped';
    return 'success';
  };

  // Truncate base URL for display (but keep full in title)
  const displayBaseUrl = baseUrl.length > 40 ? baseUrl.slice(0, 37) + '...' : baseUrl;

  // Provider message (sanitized, no API key)
  const sanitizeMessage = (msg: string | undefined): string => {
    if (!msg) return '';
    return msg.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***').replace(/api-[a-zA-Z0-9]{20,}/g, 'api-***');
  };

  return (
    <div className="report-card-v2">
      {/* Header */}
      <div className="rc2-header">
        <div className="rc2-header-left">
          <div className="rc2-brand">AI API Doctor</div>
          <div className="rc2-subtitle">
            {lang === 'zh-CN' ? '本地 API 诊断' : 'Local API diagnosis'}
          </div>
        </div>
        <div className="rc2-header-right">
          {lang === 'zh-CN' ? 'API Key 已脱敏 · 本地报告' : 'Key masked · Local report'}
        </div>
      </div>

      {/* Status Hero with Trust Score */}
      <div className="rc2-hero">
        {/* Weighted Donut Ring */}
        <div className="rc2-donut-wrap">
          <div
            className="rc2-donut"
            style={{ background: buildWeightedDonut() }}
          >
            <div className="rc2-donut-inner">
              <div className="rc2-donut-center">
                <span className="rc2-donut-count">{trustScore.score} / 100</span>
                <span className="rc2-donut-label">
                  {lang === 'zh-CN' ? 'API 可信分' : 'Trust Score'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Score Details */}
        <div className="rc2-score-details">
          <div className={`rc2-status-badge ${statusConfig.className}`}>
            {statusConfig.label}
          </div>
          <div className="rc2-confidence">
            {lang === 'zh-CN' ? '置信度' : 'Confidence'}: <span className={`rc2-confidence-${trustScore.confidence}`}>{confidenceLabel}</span>
          </div>
          {/* Legend */}
          <div className="rc2-legend">
            {trustScore.categories.map((cat) => (
              <div key={cat.key} className={`rc2-legend-item rc2-legend-${cat.status}`}>
                <span className="rc2-legend-dot" />
                <span className="rc2-legend-label">
                  {lang === 'zh-CN' ? cat.labelZh : cat.label}
                </span>
                <span className="rc2-legend-weight">{cat.weight}%</span>
                <span className="rc2-legend-score">{cat.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Risk Tags */}
      {trustScore.riskTags.length > 0 && (
        <div className="rc2-risk-tags">
          {trustScore.riskTags.map((tag, i) => (
            <span key={i} className="rc2-risk-tag">{tag}</span>
          ))}
        </div>
      )}

      {/* Main Issue */}
      <div className="rc2-section">
        <div className="rc2-section-title">
          {lang === 'zh-CN' ? '主要问题' : 'Main Issue'}
        </div>
        <div className="rc2-main-issue">
          {mainIssueLabel}
        </div>
        {mainIssue?.httpStatus && (
          <div className="rc2-http-badge">
            HTTP {mainIssue.httpStatus}
          </div>
        )}
        {mainIssue?.providerMessage && (
          <div className="rc2-provider-msg">
            <code>{sanitizeMessage(mainIssue.providerMessage)}</code>
          </div>
        )}
      </div>

      {/* Suggestion */}
      <div className="rc2-section">
        <div className="rc2-section-title">
          {lang === 'zh-CN' ? '建议' : 'Suggestion'}
        </div>
        <div className="rc2-suggestion">
          {topSuggestion.replace(/\n/g, ' ')}
        </div>
      </div>

      {/* Metrics */}
      <div className="rc2-metrics">
        <div className="rc2-metric">
          <span className="rc2-metric-value">{latencyStr || '—'}</span>
          <span className="rc2-metric-label">
            {lang === 'zh-CN' ? '延迟' : 'Latency'}
          </span>
        </div>
        <div className="rc2-metric">
          <span className="rc2-metric-value">{usageStr}</span>
          <span className="rc2-metric-label">
            {lang === 'zh-CN' ? '用量' : 'Usage'}
          </span>
        </div>
        <div className="rc2-metric">
          <span className="rc2-metric-value">{tokensPerSec || '—'}</span>
          <span className="rc2-metric-label">
            {lang === 'zh-CN' ? 'Tokens/s' : 'Tokens/s'}
          </span>
        </div>
        <div className="rc2-metric">
          <span className="rc2-metric-value">{modelsCount}</span>
          <span className="rc2-metric-label">
            {lang === 'zh-CN' ? '模型数' : 'Models'}
          </span>
        </div>
      </div>

      {/* Checks Status Bar */}
      <div className="rc2-checks">
        {stepNameKeys.map((key, i) => {
          const status = getStepStatus(i);
          const dotClass = `rc2-dot rc2-dot-${status}`;
          const pillClass = `rc2-step-pill rc2-pill-${status}`;
          return (
            <div key={key} className={pillClass}>
              <span className={dotClass} />
              <span className="rc2-step-name">{t(key)}</span>
            </div>
          );
        })}
      </div>

      {/* Context */}
      <div className="rc2-context">
        <div className="rc2-context-row">
          <span className="rc2-context-label">Provider:</span>
          <span className="rc2-context-value">{report.providerName}</span>
        </div>
        <div className="rc2-context-row">
          <span className="rc2-context-label">Base URL:</span>
          <span className="rc2-context-value rc2-context-mono" title={baseUrl}>{displayBaseUrl}</span>
        </div>
        <div className="rc2-context-row">
          <span className="rc2-context-label">Model:</span>
          <span className="rc2-context-value rc2-context-mono">
            {report.activeModelId || (lang === 'zh-CN' ? '未选择' : 'Not selected')}
          </span>
        </div>
      </div>

      {/* Billing Evidence */}
      {costAudit.status !== 'unavailable' && (
        <div className="rc2-section">
          <div className="rc2-section-title">
            {lang === 'zh-CN' ? '扣费证据' : 'Billing Evidence'}
          </div>
          <div className="rc2-billing-grid">
            {costAudit.estimatedCost !== undefined && (
              <div className="rc2-billing-item">
                <span className="rc2-billing-label">
                  {lang === 'zh-CN' ? '估算成本' : 'Estimated Cost'}
                </span>
                <span className="rc2-billing-value">
                  ${costAudit.estimatedCost.toFixed(6)} {costAudit.currency}
                </span>
              </div>
            )}
            {costAudit.balanceDelta !== undefined && (
              <div className="rc2-billing-item">
                <span className="rc2-billing-label">
                  {lang === 'zh-CN' ? '余额差异' : 'Balance Delta'}
                </span>
                <span className="rc2-billing-value">
                  {costAudit.balanceDelta >= 0 ? '+' : ''}{costAudit.balanceDelta.toFixed(4)} {costAudit.currency}
                </span>
              </div>
            )}
            {costAudit.costRatio !== undefined && (
              <div className="rc2-billing-item">
                <span className="rc2-billing-label">
                  {lang === 'zh-CN' ? '成本比例' : 'Cost Ratio'}
                </span>
                <span className={`rc2-billing-value rc2-billing-ratio-${costAudit.status}`}>
                  {costAudit.costRatio.toFixed(2)}x
                </span>
              </div>
            )}
            {costAudit.effectivePricePerM !== undefined && (
              <div className="rc2-billing-item">
                <span className="rc2-billing-label">
                  {lang === 'zh-CN' ? '有效价格' : 'Effective Price'}/1M
                </span>
                <span className="rc2-billing-value">
                  ${costAudit.effectivePricePerM.toFixed(4)}
                </span>
              </div>
            )}
          </div>
          {costAudit.status !== 'ok' && (
            <div className={`rc2-billing-status rc2-billing-status-${costAudit.status}`}>
              {costAudit.status === 'review'
                ? (lang === 'zh-CN' ? '需要复查，请对比服务商后台账单或联系站长核对。' : 'Needs review. Compare with provider dashboard or contact support.')
                : (lang === 'zh-CN' ? '差异较高，请复查。' : 'High difference. Please review.')}
            </div>
          )}
        </div>
      )}

      {/* Billing Anomaly Probes */}
      {report.billingAnomaly?.enabled && (
        <div className="rc2-section">
          <div className="rc2-section-title">
            {lang === 'zh-CN' ? '扣费异常检测' : 'Billing Anomaly Probes'}
          </div>
          <div className="rc2-billing-probes-grid">
            {/* Empty Reply Charge */}
            <div className={`rc2-probe-card probe-${report.billingAnomaly.emptyReplyProbe?.status || 'skipped'}`}>
              <div className="rc2-probe-title">
                {lang === 'zh-CN' ? '空回复扣费' : 'Empty Reply'}
              </div>
              <div className="rc2-probe-status">
                {report.billingAnomaly.emptyReplyProbe?.status === 'signal_confirmed'
                  ? (lang === 'zh-CN' ? '异常信号已确认' : 'Signal confirmed')
                  : report.billingAnomaly.emptyReplyProbe?.status === 'needs_review'
                  ? (lang === 'zh-CN' ? '需复查' : 'Needs review')
                  : report.billingAnomaly.emptyReplyProbe?.status === 'not_found'
                  ? (lang === 'zh-CN' ? '未发现' : 'Not found')
                  : (lang === 'zh-CN' ? '未测试' : 'Not tested')}
              </div>
              {report.billingAnomaly.emptyReplyProbe?.visibleOutputLength !== undefined && (
                <div className="rc2-probe-detail">
                  {lang === 'zh-CN' ? '输出' : 'Output'}: {report.billingAnomaly.emptyReplyProbe.visibleOutputLength}
                </div>
              )}
              {report.billingAnomaly.emptyReplyProbe?.balanceDelta !== undefined && (
                <div className="rc2-probe-detail">
                  {lang === 'zh-CN' ? '余额差异' : 'Delta'}: {report.billingAnomaly.emptyReplyProbe.balanceDelta >= 0 ? '+' : ''}{report.billingAnomaly.emptyReplyProbe.balanceDelta.toFixed(4)}
                </div>
              )}
            </div>

            {/* Failed Request Charge */}
            <div className={`rc2-probe-card probe-${report.billingAnomaly.failedRequestProbe?.status || 'skipped'}`}>
              <div className="rc2-probe-title">
                {lang === 'zh-CN' ? '失败请求扣费' : 'Failed Request'}
              </div>
              <div className="rc2-probe-status">
                {report.billingAnomaly.failedRequestProbe?.status === 'signal_confirmed'
                  ? (lang === 'zh-CN' ? '异常信号已确认' : 'Signal confirmed')
                  : report.billingAnomaly.failedRequestProbe?.status === 'needs_review'
                  ? (lang === 'zh-CN' ? '需复查' : 'Needs review')
                  : report.billingAnomaly.failedRequestProbe?.status === 'not_found'
                  ? (lang === 'zh-CN' ? '未发现' : 'Not found')
                  : (lang === 'zh-CN' ? '未测试' : 'Not tested')}
              </div>
              {report.billingAnomaly.failedRequestProbe?.httpStatus && (
                <div className="rc2-probe-detail">
                  HTTP: {report.billingAnomaly.failedRequestProbe.httpStatus}
                </div>
              )}
              {report.billingAnomaly.failedRequestProbe?.balanceDelta !== undefined && (
                <div className="rc2-probe-detail">
                  {lang === 'zh-CN' ? '余额差异' : 'Delta'}: {report.billingAnomaly.failedRequestProbe.balanceDelta >= 0 ? '+' : ''}{report.billingAnomaly.failedRequestProbe.balanceDelta.toFixed(4)}
                </div>
              )}
            </div>

            {/* Balance Source */}
            <div className={`rc2-probe-card ${report.billingAnomaly.balanceSnapshot?.supported ? 'probe-success' : 'probe-skipped'}`}>
              <div className="rc2-probe-title">
                {lang === 'zh-CN' ? '余额来源' : 'Balance Source'}
              </div>
              <div className="rc2-probe-status">
                {report.billingAnomaly.balanceSnapshot?.supported
                  ? (report.billingAnomaly.balanceSnapshot.unlimited ? (lang === 'zh-CN' ? '无限余额' : 'Unlimited') : (lang === 'zh-CN' ? 'New API 自动' : 'New API'))
                  : report.billingAnomaly.balanceSnapshot?.source === 'manual'
                  ? (lang === 'zh-CN' ? '手动填写' : 'Manual')
                  : (lang === 'zh-CN' ? '不可读取' : 'Unavailable')}
              </div>
              {report.billingAnomaly.balanceSnapshot?.available !== undefined && (
                <div className="rc2-probe-detail">
                  {lang === 'zh-CN' ? '余额' : 'Balance'}: {report.billingAnomaly.balanceSnapshot.available.toFixed(4)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="rc2-footer">
        <span>{lang === 'zh-CN' ? '由 AI API Doctor 生成' : 'Generated by AI API Doctor'}</span>
        <span className="rc2-footer-url">aiapidoctor.com</span>
      </div>
    </div>
  );
}

// ─── Home Page ──────────────────────────────────────────

function HomePage() {
  const { lang, t } = useLang();
  const [config, setConfig] = useState<ActiveConfig>({
    providerName: '',
    baseUrl: '',
    apiKey: '',
    modelId: '',
    source: 'custom',
    updatedAt: '',
  });
  const [parseHint, setParseHint] = useState('');
  const [parseError, setParseError] = useState('');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'md' | 'issue' | 'text'>('idle');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [showGuide, setShowGuide] = useState(true);
  const [showExample, setShowExample] = useState(false);
  const [showCostAudit, setShowCostAudit] = useState(false);
  const [showCostAuditAdvanced, setShowCostAuditAdvanced] = useState(false);
  const [showBillingAnomaly, setShowBillingAnomaly] = useState(false);
  const [billingAnomalyEnabled, setBillingAnomalyEnabled] = useState(false);
  const [costAuditInput, setCostAuditInput] = useState({
    inputPricePerM: '',
    outputPricePerM: '',
    cachedInputPricePerM: '',
    cacheWritePricePerM: '',
    beforeBalance: '',
    afterBalance: '',
    currency: 'USD' as 'USD' | 'CNY' | 'points',
  });
  const reportCardRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getActiveConfig().then((c) => {
      if (c) {
        setConfig(c);
        if (c.costAudit) {
          setCostAuditInput({
            inputPricePerM: c.costAudit.inputPricePerM?.toString() || '',
            outputPricePerM: c.costAudit.outputPricePerM?.toString() || '',
            cachedInputPricePerM: c.costAudit.cachedInputPricePerM?.toString() || '',
            cacheWritePricePerM: c.costAudit.cacheWritePricePerM?.toString() || '',
            beforeBalance: c.costAudit.beforeBalance?.toString() || '',
            afterBalance: c.costAudit.afterBalance?.toString() || '',
            currency: c.costAudit.currency || 'USD',
          });
        }
      }
    });
  }, []);

  const handleParse = useCallback((value: string) => {
    if (!value.trim()) { setParseHint(''); setParseError(''); return; }
    const result = parseConnectionInput(value);
    if (result.success) {
      setConfig((prev) => ({
        ...prev,
        baseUrl: result.baseUrl ?? prev.baseUrl,
        apiKey: result.apiKey ?? prev.apiKey,
        source: result.source ?? prev.source,
      }));
      setParseHint(result.hint ? t('urlHintMissingV1').replace('{url}', result.hint) : t('parsedOk'));
      setParseError('');
    } else {
      setParseError(t('parseFailed'));
      setParseHint('');
    }
  }, [t]);

  const handleSave = useCallback(async () => {
    const costAudit: CostAuditConfig = {};
    if (costAuditInput.inputPricePerM) costAudit.inputPricePerM = parseFloat(costAuditInput.inputPricePerM);
    if (costAuditInput.outputPricePerM) costAudit.outputPricePerM = parseFloat(costAuditInput.outputPricePerM);
    if (costAuditInput.cachedInputPricePerM) costAudit.cachedInputPricePerM = parseFloat(costAuditInput.cachedInputPricePerM);
    if (costAuditInput.cacheWritePricePerM) costAudit.cacheWritePricePerM = parseFloat(costAuditInput.cacheWritePricePerM);
    if (costAuditInput.beforeBalance) costAudit.beforeBalance = parseFloat(costAuditInput.beforeBalance);
    if (costAuditInput.afterBalance) costAudit.afterBalance = parseFloat(costAuditInput.afterBalance);
    costAudit.currency = costAuditInput.currency;

    const next = { ...config, updatedAt: new Date().toISOString(), costAudit: Object.keys(costAudit).length > 0 ? costAudit : undefined };
    await saveActiveConfig(next);
    setConfig(next);
  }, [config, costAuditInput]);

  const handleRun = useCallback(async () => {
    if (!config.baseUrl || !config.apiKey) return;
    setRunning(true);
    setReport(null);
    try {
      const next = { ...config, updatedAt: new Date().toISOString() };
      await saveActiveConfig(next);
      const rep = await runDiagnosis(next);

      // Run billing anomaly probes if enabled
      if (billingAnomalyEnabled && next.baseUrl && next.apiKey) {
        try {
          const probesResult = await runBillingAnomalyProbes(
            next.baseUrl,
            next.apiKey,
            next.modelId || '',
            true,
            costAuditInput.beforeBalance ? parseFloat(costAuditInput.beforeBalance) : undefined,
            costAuditInput.afterBalance ? parseFloat(costAuditInput.afterBalance) : undefined
          );
          rep.billingAnomaly = probesResult;
        } catch (probeErr) {
          console.error('Billing anomaly probe error:', probeErr);
        }
      }

      setReport(rep);
      setConfig(next);

      // Scroll to report after diagnosis
      setTimeout(() => {
        if (reportCardRef.current) {
          reportCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (mainContentRef.current) {
          mainContentRef.current.scrollTop = 0;
        }
      }, 100);
    } catch (e) {
      console.error('Diagnosis error:', e);
    } finally {
      setRunning(false);
    }
  }, [config, billingAnomalyEnabled, costAuditInput]);

  const handleUseExample = useCallback(() => {
    setConfig({
      providerName: 'Link-AI',
      baseUrl: 'https://api1.link-ai.cc/v1',
      apiKey: '',
      modelId: '',
      source: 'example',
      updatedAt: new Date().toISOString(),
    });
    setParseHint('');
    setParseError('');
    setReport(null);
  }, []);

  const handleCopyMd = useCallback(async () => {
    if (!report) return;
    try {
      const lines: string[] = [];
      lines.push('# AI API Doctor Report');
      lines.push('');

      // Trust Score
      const trustScore = calculateTrustScore(report, lang);
      lines.push(`**API Trust Score:** ${trustScore.score} / 100`);
      lines.push(`**Confidence:** ${trustScore.confidence}`);
      lines.push('');
      lines.push('| Category | Weight | Score |');
      lines.push('|---|---|---|');
      trustScore.categories.forEach(cat => {
        lines.push(`| ${lang === 'zh-CN' ? cat.labelZh : cat.label} | ${cat.weight}% | ${cat.score} |`);
      });
      if (trustScore.riskTags.length > 0) {
        lines.push('');
        lines.push(`**Risk Tags:** ${trustScore.riskTags.join(', ')}`);
      }
      lines.push('');

      const statusLabel = report.overallStatus === 'success' ? 'Ready' : report.overallStatus === 'warning' ? 'Needs Attention' : 'Failed';
      lines.push(`**Status:** ${statusLabel}`);
      lines.push(`**Checks:** ${report.passedCount} / ${report.totalCount} passed`);
      lines.push('');
      lines.push(`| | |`);
      lines.push(`|---|---|---|`);
      lines.push(`| **Provider** | ${report.providerName} |`);
      lines.push(`| **Base URL** | ${config.baseUrl} |`);
      lines.push(`| **API Key** | \`${report.maskedKey}\` |`);
      if (report.activeModelId) lines.push(`| **Model** | \`${report.activeModelId}\` |`);
      lines.push('');

      const firstErr = report.steps.find((s) => s.status === 'error');
      const firstWrn = report.steps.find((s) => s.status === 'warning');
      const main = firstErr || firstWrn;
      if (main) {
        lines.push(`**Main Issue:**`);
        lines.push(`- ${main.title}`);
        if (main.httpStatus) lines.push(`- **HTTP Status:** ${main.httpStatus}`);
        if (main.providerMessage) lines.push(`- **Provider Message:** ${main.providerMessage}`);
        if (main.suggestion) lines.push(`- **Suggestion:** ${main.suggestion.replace(/\n/g, ' ')}`);
        lines.push('');
      }

      // Cost Audit
      const costAudit = calculateCostAudit(report.usageSummary, config.costAudit);
      if (costAudit.status !== 'unavailable') {
        lines.push('**Billing Evidence:**');
        if (costAudit.estimatedCost !== undefined) lines.push(`- **Estimated Cost:** $${costAudit.estimatedCost.toFixed(6)} ${costAudit.currency}`);
        if (costAudit.balanceDelta !== undefined) lines.push(`- **Balance Delta:** ${costAudit.balanceDelta >= 0 ? '+' : ''}${costAudit.balanceDelta.toFixed(4)} ${costAudit.currency}`);
        if (costAudit.costRatio !== undefined) lines.push(`- **Cost Ratio:** ${costAudit.costRatio.toFixed(2)}x`);
        if (costAudit.effectivePricePerM !== undefined) lines.push(`- **Effective Price / 1M:** $${costAudit.effectivePricePerM.toFixed(4)}`);
        lines.push('');
      }

      // Billing Anomaly Probes
      if (report.billingAnomaly?.enabled) {
        lines.push('**Billing Anomaly Probes:**');
        lines.push('');

        if (report.billingAnomaly.emptyReplyProbe) {
          lines.push('### Empty Reply Charge');
          lines.push(`- **Status:** ${report.billingAnomaly.emptyReplyProbe.status}`);
          if (report.billingAnomaly.emptyReplyProbe.httpStatus) lines.push(`- **HTTP Status:** ${report.billingAnomaly.emptyReplyProbe.httpStatus}`);
          lines.push(`- **Visible Output Length:** ${report.billingAnomaly.emptyReplyProbe.visibleOutputLength}`);
          if (report.billingAnomaly.emptyReplyProbe.completionTokens !== undefined) lines.push(`- **completion_tokens:** ${report.billingAnomaly.emptyReplyProbe.completionTokens}`);
          if (report.billingAnomaly.emptyReplyProbe.totalTokens !== undefined) lines.push(`- **total_tokens:** ${report.billingAnomaly.emptyReplyProbe.totalTokens}`);
          if (report.billingAnomaly.emptyReplyProbe.balanceDelta !== undefined) lines.push(`- **Balance Delta:** ${report.billingAnomaly.emptyReplyProbe.balanceDelta >= 0 ? '+' : ''}${report.billingAnomaly.emptyReplyProbe.balanceDelta.toFixed(4)}`);
          lines.push(`- **Result:** ${report.billingAnomaly.emptyReplyProbe.message}`);
          lines.push('');
        }

        if (report.billingAnomaly.failedRequestProbe) {
          lines.push('### Failed Request Charge');
          lines.push(`- **Status:** ${report.billingAnomaly.failedRequestProbe.status}`);
          if (report.billingAnomaly.failedRequestProbe.httpStatus) lines.push(`- **HTTP Status:** ${report.billingAnomaly.failedRequestProbe.httpStatus}`);
          if (report.billingAnomaly.failedRequestProbe.balanceDelta !== undefined) lines.push(`- **Balance Delta:** ${report.billingAnomaly.failedRequestProbe.balanceDelta >= 0 ? '+' : ''}${report.billingAnomaly.failedRequestProbe.balanceDelta.toFixed(4)}`);
          lines.push(`- **Result:** ${report.billingAnomaly.failedRequestProbe.message}`);
          lines.push('');
        }

        lines.push('*This report only shows reproducible signals and does not prove intentional overbilling.*');
        lines.push('');
      }

      if (report.usageSummary?.status === 'available' || report.usageSummary?.status === 'anomaly') {
        lines.push('**Usage:**');
        if (report.usageSummary.totalTokens !== undefined) lines.push(`- \`total_tokens: ${report.usageSummary.totalTokens}\``);
        if (report.usageSummary.promptTokens !== undefined) lines.push(`- \`prompt_tokens: ${report.usageSummary.promptTokens}\``);
        if (report.usageSummary.completionTokens !== undefined) lines.push(`- \`completion_tokens: ${report.usageSummary.completionTokens}\``);
        lines.push('');
      }
      lines.push('---');
      lines.push('*API Key is masked. No full key is included.*');
      lines.push('*Generated by AI API Doctor · aiapidoctor.com*');
      await copyToClipboard(lines.join('\n'));
      setCopyState('md');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch { setCopyState('idle'); }
  }, [report, config, lang]);

  const handleCopyIssue = useCallback(async () => {
    if (!report) return;
    try {
      const lines: string[] = [];
      if (lang === 'zh-CN') {
        lines.push('## API 诊断问题');
        lines.push('');
        lines.push('### 摘要');
        lines.push('AI API Doctor 发现了配置、权限或用量返回问题。');
        lines.push('');
        lines.push('### 环境');
        lines.push(`- 服务商：${report.providerName}`);
        lines.push(`- Base URL：${config.baseUrl}`);
        if (report.activeModelId) lines.push(`- 模型：${report.activeModelId}`);
        lines.push(`- 时间：${new Date(report.startedAt).toLocaleString('zh-CN')}`);
        lines.push('');
        lines.push('### 结果');
        lines.push(`- 状态：${report.overallStatus === 'success' ? '可用' : report.overallStatus === 'warning' ? '需要处理' : '失败'}`);
        lines.push(`- 通过项：${report.passedCount} / ${report.totalCount}`);
        lines.push('');
        const main = report.steps.find((s) => s.status === 'error') || report.steps.find((s) => s.status === 'warning');
        if (main) {
          lines.push('### 失败步骤');
          lines.push(`- 步骤：${main.title}`);
          if (main.httpStatus) lines.push(`- HTTP 状态码：${main.httpStatus}`);
          if (main.providerMessage) lines.push(`- 服务商返回：${main.providerMessage}`);
          if (main.suggestion) lines.push(`- 建议：${main.suggestion.replace(/\n/g, ' ')}`);
          lines.push('');
        }
        if (report.billingAnomaly?.enabled) {
          lines.push('### 扣费异常检测');
          if (report.billingAnomaly.emptyReplyProbe) {
            lines.push(`- 空回复扣费：${report.billingAnomaly.emptyReplyProbe.status}`);
            if (report.billingAnomaly.emptyReplyProbe.balanceDelta !== undefined) {
              lines.push(`  余额差异：${report.billingAnomaly.emptyReplyProbe.balanceDelta >= 0 ? '+' : ''}${report.billingAnomaly.emptyReplyProbe.balanceDelta.toFixed(4)}`);
            }
          }
          if (report.billingAnomaly.failedRequestProbe) {
            lines.push(`- 失败请求扣费：${report.billingAnomaly.failedRequestProbe.status}`);
            if (report.billingAnomaly.failedRequestProbe.balanceDelta !== undefined) {
              lines.push(`  余额差异：${report.billingAnomaly.failedRequestProbe.balanceDelta >= 0 ? '+' : ''}${report.billingAnomaly.failedRequestProbe.balanceDelta.toFixed(4)}`);
            }
          }
          lines.push('');
          lines.push('本报告只展示可复现信号，不证明服务商故意多扣费。');
          lines.push('');
        }
        lines.push('### 安全说明');
        lines.push('API Key 已脱敏，不包含完整 Key。');
      } else {
        lines.push('## API Diagnosis Issue');
        lines.push('');
        lines.push('### Summary');
        lines.push('AI API Doctor found a configuration, permission or usage reporting issue.');
        lines.push('');
        lines.push('### Environment');
        lines.push(`- Provider: ${report.providerName}`);
        lines.push(`- Base URL: ${config.baseUrl}`);
        if (report.activeModelId) lines.push(`- Model: ${report.activeModelId}`);
        lines.push(`- Time: ${new Date(report.startedAt).toLocaleString('en-US')}`);
        lines.push('');
        lines.push('### Result');
        lines.push(`- Status: ${report.overallStatus === 'success' ? 'Ready' : report.overallStatus === 'warning' ? 'Needs Attention' : 'Failed'}`);
        lines.push(`- Checks: ${report.passedCount} / ${report.totalCount} passed`);
        lines.push('');
        const main = report.steps.find((s) => s.status === 'error') || report.steps.find((s) => s.status === 'warning');
        if (main) {
          lines.push('### Failed Step');
          lines.push(`- Step: ${main.title}`);
          if (main.httpStatus) lines.push(`- HTTP Status: ${main.httpStatus}`);
          if (main.providerMessage) lines.push(`- Provider Message: ${main.providerMessage}`);
          if (main.suggestion) lines.push(`- Suggestion: ${main.suggestion.replace(/\n/g, ' ')}`);
          lines.push('');
        }
        if (report.billingAnomaly?.enabled) {
          lines.push('### Billing Anomaly Probes');
          if (report.billingAnomaly.emptyReplyProbe) {
            lines.push(`- Empty Reply Charge: ${report.billingAnomaly.emptyReplyProbe.status}`);
            if (report.billingAnomaly.emptyReplyProbe.balanceDelta !== undefined) {
              lines.push(`  Balance Delta: ${report.billingAnomaly.emptyReplyProbe.balanceDelta >= 0 ? '+' : ''}${report.billingAnomaly.emptyReplyProbe.balanceDelta.toFixed(4)}`);
            }
          }
          if (report.billingAnomaly.failedRequestProbe) {
            lines.push(`- Failed Request Charge: ${report.billingAnomaly.failedRequestProbe.status}`);
            if (report.billingAnomaly.failedRequestProbe.balanceDelta !== undefined) {
              lines.push(`  Balance Delta: ${report.billingAnomaly.failedRequestProbe.balanceDelta >= 0 ? '+' : ''}${report.billingAnomaly.failedRequestProbe.balanceDelta.toFixed(4)}`);
            }
          }
          lines.push('');
          lines.push('This report only shows reproducible signals and does not prove intentional overbilling.');
          lines.push('');
        }
        lines.push('### Safety');
        lines.push('The API Key is masked. No full key is included.');
      }
      lines.push('');
      lines.push('*Generated by AI API Doctor · aiapidoctor.com*');
      await copyToClipboard(lines.join('\n'));
      setCopyState('issue');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch { setCopyState('idle'); }
  }, [report, config, lang]);

  const handleCopyText = useCallback(async () => {
    if (!report) return;
    try {
      const statusLabel = report.overallStatus === 'success'
        ? (lang === 'zh-CN' ? '可用' : 'Ready')
        : report.overallStatus === 'warning'
        ? (lang === 'zh-CN' ? '需要处理' : 'Needs Attention')
        : (lang === 'zh-CN' ? '失败' : 'Failed');
      const firstErr = report.steps.find((s) => s.status === 'error');
      const firstWrn = report.steps.find((s) => s.status === 'warning');
      const main = firstErr || firstWrn;
      const lines: string[] = [];
      lines.push('AI API Doctor Report');
      lines.push(`Status: ${statusLabel}`);
      lines.push(`Checks: ${report.passedCount} / ${report.totalCount} passed`);
      lines.push(`Provider: ${report.providerName}`);
      lines.push(`Base URL: ${config.baseUrl}`);
      lines.push(`API Key: ${report.maskedKey}`);
      if (report.activeModelId) lines.push(`Model: ${report.activeModelId}`);
      if (main) {
        lines.push(`Main Issue: ${main.title}`);
        if (main.httpStatus) lines.push(`HTTP Status: ${main.httpStatus}`);
        if (main.providerMessage) lines.push(`Provider Message: ${main.providerMessage}`);
        if (main.suggestion) lines.push(`Suggestion: ${main.suggestion.replace(/\n/g, ' ')}`);
      }
      lines.push('Generated by AI API Doctor · aiapidoctor.com');
      await copyToClipboard(lines.join('\n'));
      setCopyState('text');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch { setCopyState('idle'); }
  }, [report, config, lang]);

  const handleSaveImage = useCallback(async () => {
    if (!reportCardRef.current) return;
    setSaveState('saving');

    const card = reportCardRef.current;

    // Add export-mode class for larger dimensions
    card.classList.add('export-mode');

    // Wait for layout to update
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      const dataUrl = await toPng(card, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#080B16',
        filter: (node) => {
          // Exclude the action buttons from the screenshot
          const el = node as HTMLElement;
          return !el.classList?.contains('report-actions');
        },
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `ai-api-doctor-report-${timestamp}.png`;
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.click();
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (err) {
      console.error('Save image error:', err);
      setSaveState('failed');
      setTimeout(() => setSaveState('idle'), 2000);
    } finally {
      // Remove export-mode class
      card.classList.remove('export-mode');
    }
  }, []);

  const canRun = !!config.baseUrl && !!config.apiKey;

  return (
    <div className="page home-page">
      {/* Config Form */}
      <div className="config-section">
        <div className="section-title">{t('apiConfiguration')}</div>

        {/* Paste Connection */}
        <div className="form-group">
          <div className="form-label-row">
            <span className="form-label">{t('pasteConnection')}</span>
          </div>
          <textarea
            className="form-textarea"
            placeholder={t('pasteConnectionPlaceholder')}
            rows={3}
            onChange={(e) => handleParse(e.target.value)}
          />
          {parseHint && <div className="parse-hint">{parseHint}</div>}
          {parseError && <div className="parse-error">{parseError}</div>}
          <div className="form-hint">{t('pasteConnectionHint')}</div>
        </div>

        {/* Provider Name */}
        <div className="form-group">
          <div className="form-label-row">
            <span className="form-label">{t('providerName')}</span>
            <span className="form-label-tag optional">{t('providerNameOptional')}</span>
          </div>
          <input
            type="text"
            className="form-input"
            placeholder={t('providerNamePlaceholder')}
            value={config.providerName}
            onChange={(e) => setConfig((p) => ({ ...p, providerName: e.target.value }))}
          />
        </div>

        {/* Base URL */}
        <div className="form-group">
          <div className="form-label-row">
            <span className="form-label">{t('baseUrl')}</span>
            <span className="form-label-tag required">{t('baseUrlRequired')}</span>
          </div>
          <input
            type="url"
            className="form-input"
            placeholder={t('baseUrlPlaceholder')}
            value={config.baseUrl}
            onChange={(e) => setConfig((p) => ({ ...p, baseUrl: e.target.value }))}
          />
        </div>

        {/* API Key */}
        <div className="form-group">
          <div className="form-label-row">
            <span className="form-label">{t('apiKey')}</span>
            <span className="form-label-tag required">{t('apiKeyRequired')}</span>
          </div>
          <input
            type="password"
            className="form-input"
            placeholder={t('apiKeyPlaceholder')}
            value={config.apiKey}
            onChange={(e) => setConfig((p) => ({ ...p, apiKey: e.target.value }))}
          />
        </div>

        {/* Model ID */}
        <div className="form-group">
          <div className="form-label-row">
            <span className="form-label">{t('modelId')}</span>
            {!config.modelId && <span className="form-label-tag recommended">{t('modelIdRecommended')}</span>}
          </div>
          <input
            type="text"
            className="form-input"
            placeholder={t('modelIdPlaceholder')}
            value={config.modelId}
            onChange={(e) => setConfig((p) => ({ ...p, modelId: e.target.value }))}
          />
        </div>

        {/* Action Buttons */}
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={handleSave}>
            {t('saveLocally')}
          </button>
          <button className="btn btn-primary" onClick={handleRun} disabled={running || !canRun}>
            {running ? (
              <><div className="btn-spinner" />{t('runningDiagnosis')}</>
            ) : t('runDiagnosis')}
          </button>
        </div>
      </div>

      {/* Cost Audit Section - Simplified */}
      <div className="cost-audit-section">
        <button
          className="cost-audit-toggle"
          onClick={() => setShowCostAudit(!showCostAudit)}
        >
          <span>{lang === 'zh-CN' ? '成本估算（可选）' : 'Cost Estimate (Optional)'}</span>
          {showCostAudit ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {showCostAudit && (
          <div className="cost-audit-body">
            <div className="cost-audit-hint">
              {lang === 'zh-CN'
                ? '填写站点显示的模型价格后，AI API Doctor 会根据 response.usage 估算本次请求成本。价格字段可选，不影响基础诊断。'
                : 'Enter the model prices shown by your provider. AI API Doctor estimates request cost from response.usage. Pricing is optional and does not block diagnosis.'}
            </div>
            <div className="cost-audit-grid cost-audit-grid-2">
              <div className="cost-audit-field">
                <label>{lang === 'zh-CN' ? '输入价格 / 1M tokens' : 'Input price / 1M tokens'}</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="0.50"
                  value={costAuditInput.inputPricePerM}
                  onChange={(e) => setCostAuditInput(prev => ({ ...prev, inputPricePerM: e.target.value }))}
                />
              </div>
              <div className="cost-audit-field">
                <label>{lang === 'zh-CN' ? '输出价格 / 1M tokens' : 'Output price / 1M tokens'}</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="1.50"
                  value={costAuditInput.outputPricePerM}
                  onChange={(e) => setCostAuditInput(prev => ({ ...prev, outputPricePerM: e.target.value }))}
                />
              </div>
            </div>

            {/* Advanced Settings */}
            <button
              className="cost-audit-advanced-toggle"
              onClick={() => setShowCostAuditAdvanced(!showCostAuditAdvanced)}
            >
              <span>{lang === 'zh-CN' ? '高级设置' : 'Advanced Settings'}</span>
              {showCostAuditAdvanced ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
            {showCostAuditAdvanced && (
              <div className="cost-audit-advanced-body">
                <div className="cost-audit-grid cost-audit-grid-2">
                  <div className="cost-audit-field">
                    <label>{lang === 'zh-CN' ? '缓存读取价格 / 1M tokens' : 'Cached input price / 1M tokens'}</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="0.10"
                      value={costAuditInput.cachedInputPricePerM}
                      onChange={(e) => setCostAuditInput(prev => ({ ...prev, cachedInputPricePerM: e.target.value }))}
                    />
                  </div>
                  <div className="cost-audit-field">
                    <label>{lang === 'zh-CN' ? '缓存写入价格 / 1M tokens' : 'Cache write price / 1M tokens'}</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="0.10"
                      value={costAuditInput.cacheWritePricePerM}
                      onChange={(e) => setCostAuditInput(prev => ({ ...prev, cacheWritePricePerM: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="cost-audit-grid cost-audit-grid-3">
                  <div className="cost-audit-field">
                    <label>{lang === 'zh-CN' ? '货币单位' : 'Currency'}</label>
                    <select
                      className="form-input"
                      value={costAuditInput.currency}
                      onChange={(e) => setCostAuditInput(prev => ({ ...prev, currency: e.target.value as 'USD' | 'CNY' | 'points' }))}
                    >
                      <option value="USD">USD</option>
                      <option value="CNY">CNY</option>
                      <option value="points">Points</option>
                    </select>
                  </div>
                  <div className="cost-audit-field">
                    <label>{lang === 'zh-CN' ? '手动诊断前余额' : 'Manual before balance'}</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="10.00"
                      value={costAuditInput.beforeBalance}
                      onChange={(e) => setCostAuditInput(prev => ({ ...prev, beforeBalance: e.target.value }))}
                    />
                  </div>
                  <div className="cost-audit-field">
                    <label>{lang === 'zh-CN' ? '手动诊断后余额' : 'Manual after balance'}</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="9.95"
                      value={costAuditInput.afterBalance}
                      onChange={(e) => setCostAuditInput(prev => ({ ...prev, afterBalance: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Billing Anomaly Probes Section */}
      <div className="cost-audit-section">
        <button
          className="cost-audit-toggle"
          onClick={() => setShowBillingAnomaly(!showBillingAnomaly)}
        >
          <span>{lang === 'zh-CN' ? '扣费异常检测' : 'Billing Anomaly Probes'}</span>
          {showBillingAnomaly ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {showBillingAnomaly && (
          <div className="cost-audit-body">
            <div className="cost-audit-hint">
              {lang === 'zh-CN'
                ? '开启后会发送 2 次低成本真实请求，用于检测空回复扣费和失败请求扣费风险。若站点支持 New API usage endpoint，将自动读取诊断前后余额。结果仅用于复查，不证明服务商故意多扣费。'
                : 'This sends 2 low-cost real requests to check empty-reply and failed-request billing risks. If the provider supports the New API usage endpoint, AI API Doctor will read balance snapshots automatically. Results are for review only and do not prove intentional overbilling.'}
            </div>
            <div className="cost-audit-toggle-row">
              <label className="cost-audit-switch-label">
                <input
                  type="checkbox"
                  checked={billingAnomalyEnabled}
                  onChange={(e) => setBillingAnomalyEnabled(e.target.checked)}
                />
                <span className="cost-audit-switch" />
                <span>
                  {lang === 'zh-CN' ? '检测空回复扣费和失败请求扣费' : 'Check empty-reply and failed-request billing'}
                </span>
              </label>
            </div>
            {billingAnomalyEnabled && !config.modelId && (
              <div className="cost-audit-warning">
                {lang === 'zh-CN'
                  ? '请先填写模型 ID，才能运行扣费异常检测'
                  : 'Enter a model ID to run billing anomaly probes.'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Example Provider */}
      <div className="example-strip">
        <div className="example-strip-text">
          <strong>{t('needExample')}</strong> {t('needExampleDesc')}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={handleUseExample}>
          {t('useExample')}
        </button>
      </div>
      <div className="example-footnote">{t('exampleProviderBy')}</div>

      {/* Report Card V2 */}
      {report && (() => {
        const trustScore = calculateTrustScore(report, lang);
        const costAudit = calculateCostAudit(report.usageSummary, config.costAudit);
        return (
          <>
            <div ref={reportCardRef}>
              <ReportCardV2
                report={report}
                baseUrl={config.baseUrl}
                lang={lang}
                trustScore={trustScore}
                costAudit={costAudit}
              />
            </div>

            {/* Action Buttons */}
            <div className="report-actions">
              <button
                className={`report-btn ${copyState === 'md' ? 'copied' : ''}`}
                onClick={handleCopyMd}
              >
                {copyState === 'md' ? t('copied') : t('copyMarkdown')}
              </button>
              <button
                className={`report-btn ${copyState === 'issue' ? 'copied' : ''}`}
                onClick={handleCopyIssue}
              >
                {copyState === 'issue' ? t('copied') : t('copyIssue')}
              </button>
              <button
                className={`report-btn ${copyState === 'text' ? 'copied' : ''}`}
                onClick={handleCopyText}
              >
                {copyState === 'text' ? t('copied') : t('copyResultText')}
              </button>
              <button
                className={`report-btn report-btn-save ${saveState === 'saving' ? 'saving' : saveState === 'saved' ? 'saved' : saveState === 'failed' ? 'failed' : ''}`}
                onClick={handleSaveImage}
                disabled={saveState === 'saving'}
              >
                {saveState === 'saving' ? t('savingImage') :
                 saveState === 'saved' ? t('imageSaved') :
                 saveState === 'failed' ? t('saveImageFailed') :
                 t('saveImage')}
              </button>
            </div>
          </>
        );
      })()}

      {/* Quick Guide */}
      <div className="guide-section">
        <button className="guide-toggle" onClick={() => setShowGuide((v) => !v)}>
          <span>{t('quickGuide')}</span>
          {showGuide ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {showGuide && (
          <div className="guide-body">
            <ol className="guide-list">
              <li>{t('guideStep1')}</li>
              <li>{t('guideStep2')}</li>
              <li>{t('guideStep3')}</li>
              <li>{t('guideStep4')}</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Models Page ──────────────────────────────────────────

function ModelsPage() {
  const { lang, t } = useLang();
  const [config, setConfig] = useState<ActiveConfig | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [manual, setManual] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    getActiveConfig().then((c) => {
      setConfig(c);
      if (c?.baseUrl && c?.apiKey) {
        fetchModels(c.baseUrl, c.apiKey)
          .then(setModels)
          .catch((e) => setError(e?.message || 'Failed to load models'))
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });
  }, []);

  const handleSelect = useCallback(async (id: string) => {
    await updateActiveModelId(id);
    setConfig((prev) => prev ? { ...prev, modelId: id } : prev);
  }, []);

  const handleManualSet = useCallback(async () => {
    const trimmed = manual.trim();
    if (!trimmed) return;
    await updateActiveModelId(trimmed);
    setConfig((prev) => prev ? { ...prev, modelId: trimmed } : prev);
    setManual('');
    setShowManual(false);
  }, [manual]);

  const handleCopyId = useCallback(async (id: string) => {
    await copyToClipboard(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  if (!config?.baseUrl || !config?.apiKey) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-state-icon"><Globe size={18} /></div>
          <span className="empty-state-title">{t('modelsNoConfigTitle')}</span>
          <span className="empty-state-hint">{t('modelsNoConfigDesc')}</span>
        </div>
      </div>
    );
  }

  const filtered = models.filter((m) =>
    !search || m.id.toLowerCase().includes(search.toLowerCase()) || m.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page">
      <div className="section-title">{t('models')}</div>

      {loading && (
        <div className="page-loading"><div className="spinner" /><span>{t('loading')}</span></div>
      )}

      {!loading && error && (
        <div className="error-alert">
          <div className="error-alert-head">
            <XCircle size={10} />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Manual */}
      <div className="manual-section">
        {showManual ? (
          <div className="add-form">
            <input
              type="text"
              className="form-input"
              placeholder={t('modelIdPlaceholder')}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleManualSet()}
            />
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleManualSet} disabled={!manual.trim()}>
                {t('setActive')}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowManual(false)}>
                {t('cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-secondary" onClick={() => setShowManual(true)}>
            <Plus size={11} /> {t('enterManually')}
          </button>
        )}
      </div>

      {/* Active model */}
      {config?.modelId && (
        <div className="active-model-badge">
          <CheckCircle size={11} />
          <span>{config.modelId}</span>
        </div>
      )}

      {/* Search */}
      {!loading && models.length > 0 && (
        <div className="search-wrap">
          <Search size={13} className="search-icon" />
          <input
            type="text"
            className="form-input search-input"
            placeholder={t('searchModels')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* List */}
      {!loading && filtered.length > 0 && (
        <div className="models-list">
          {filtered.map((m) => {
            const isActive = config?.modelId === m.id;
            return (
              <div
                key={m.id}
                className={`model-card ${isActive ? 'selected' : ''}`}
                onClick={() => handleSelect(m.id)}
              >
                <div className="model-card-info">
                  <div className="model-card-name">
                    {m.name || m.id}
                    {isActive && <span className="badge-active-sm"><CheckCircle size={8} /> {t('active')}</span>}
                  </div>
                  <div className="model-card-id">{m.id}</div>
                </div>
                <button
                  className={`btn-copy ${copiedId === m.id ? 'copied' : ''}`}
                  onClick={(e) => { e.stopPropagation(); handleCopyId(m.id); }}
                >
                  {copiedId === m.id ? <CheckCircle size={10} /> : <Copy size={10} />}
                  {copiedId === m.id ? t('copied') : t('copyResultText')}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!loading && models.length === 0 && !error && (
        <div className="empty-state">
          <span className="empty-state-title">{t('noModelsLoaded')}</span>
          <span className="empty-state-hint">{t('enterModelManuallyOrRetry')}</span>
        </div>
      )}
    </div>
  );
}

// ─── Export Page ──────────────────────────────────────────

function ExportPage() {
  const { lang, t } = useLang();
  const [config, setConfig] = useState<ActiveConfig | null>(null);
  const [format, setFormat] = useState<'cline' | 'continue' | 'openai' | 'curl' | 'env'>('cline');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getActiveConfig().then(setConfig);
  }, []);

  const generate = useCallback(() => {
    if (!config?.baseUrl || !config?.apiKey) return '';
    const key = config.apiKey;
    const url = config.baseUrl;
    const model = config.modelId || 'gpt-4o';
    switch (format) {
      case 'cline':
        return JSON.stringify({ name: config.providerName || 'Provider', apiKey: key, baseURL: url }, null, 2);
      case 'continue':
        return JSON.stringify({ title: config.providerName || 'Provider', model, apiKey: key, baseUrl: url }, null, 2);
      case 'openai':
        return `OPENAI_API_KEY=${key}\nOPENAI_API_BASE=${url}`;
      case 'curl':
        return `curl ${url}/chat/completions \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "${model}",\n    "messages": [{"role": "user", "content": "Hello"}]\n  }'`;
      case 'env':
        return `# ${config.providerName || 'Provider'}\nPROVIDER_NAME="${config.providerName || 'Provider'}"\nAPI_BASE_URL="${url}"\nAPI_KEY="${key}"\n${model ? `ACTIVE_MODEL="${model}"` : ''}`;
    }
  }, [config, format]);

  const handleCopy = useCallback(async () => {
    await copyToClipboard(generate());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generate]);

  if (!config?.baseUrl || !config?.apiKey) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-state-icon"><Globe size={18} /></div>
          <span className="empty-state-title">{t('noConfigExport')}</span>
        </div>
      </div>
    );
  }

  const FORMAT_LABELS = {
    cline: t('exportCline'),
    continue: t('exportContinue'),
    openai: t('exportOpenAI'),
    curl: t('exportCurl'),
    env: t('exportEnv'),
  } as const;

  return (
    <div className="page">
      <div className="section-title">{t('export')}</div>

      <div className="export-grid">
        {(Object.keys(FORMAT_LABELS) as Array<keyof typeof FORMAT_LABELS>).map((f) => (
          <button
            key={f}
            className={`export-btn ${format === f ? 'active' : ''}`}
            onClick={() => setFormat(f)}
          >
            {FORMAT_LABELS[f]}
          </button>
        ))}
      </div>

      <div className="export-preview">
        <pre className="export-data">{generate()}</pre>
      </div>

      <button className={`btn btn-primary ${copied ? 'btn-copied' : ''}`} onClick={handleCopy}>
        {copied ? <><CheckCircle2 size={12} />{t('copied')}</> : <><Copy size={12} />{t('copyResultText')}</>}
      </button>

      <div className="export-note">{t('exportNote')}</div>
    </div>
  );
}

// ─── Help Page ──────────────────────────────────────────

function HelpPage() {
  const { lang, t } = useLang();
  const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  const links = [
    { label: t('helpFaq'), desc: t('helpFaqDesc'), url: 'https://aiapidoctor.com/faq' },
    { label: t('modelGroupError'), desc: t('modelGroupErrorDesc'), url: 'https://aiapidoctor.com/errors/403-model-group' },
    { label: t('tokenUsageAudit'), desc: t('tokenUsageAuditDesc'), url: 'https://aiapidoctor.com/guides/token-usage-audit' },
  ];

  return (
    <div className="page">
      <div className="section-title">{t('help')}</div>

      {/* Quick Guide */}
      <div className="help-card">
        <div className="help-card-title">{t('quickGuideTitle')}</div>
        <ol className="guide-list">
          <li>{t('guideStep1')}</li>
          <li>{t('guideStep2')}</li>
          <li>{t('guideStep3')}</li>
          <li>{t('guideStep4')}</li>
        </ol>
      </div>

      {/* Links */}
      <div className="help-links">
        {links.map((l) => (
          <button key={l.url} className="help-link" onClick={() => open(l.url)}>
            <div className="help-link-text">
              <span className="help-link-label">{l.label}</span>
              <span className="help-link-desc">{l.desc}</span>
            </div>
            <ExternalLink size={12} />
          </button>
        ))}
      </div>

      {/* About */}
      <div className="help-card">
        <div className="help-card-title">{t('aboutTitle')}</div>
        <p className="help-about">{t('aboutDescription')}</p>
        <p className="help-about">{t('aboutDescription2')}</p>
      </div>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [langSetting, setLangSetting] = useState<Language>('auto');
  const [lang, setLang] = useState<'zh-CN' | 'en-US'>('en-US');

  useEffect(() => {
    getLanguage().then((l) => {
      setLangSetting(l);
      setLang(resolveLanguage(l));
    });
  }, []);

  const handleSetLang = useCallback(async (l: Language) => {
    setLangSetting(l);
    setLang(resolveLanguage(l));
    await setLanguage(l);
  }, []);

  const ctx: LangCtx = {
    lang,
    langSetting,
    setLang: handleSetLang,
    t: (key) => t(lang, key),
  };

  const navItems: { page: Page; labelKey: 'navHome' | 'navModels' | 'navExport' | 'navHelp'; icon: React.ReactNode }[] = [
    { page: 'home', labelKey: 'navHome', icon: <Home size={20} strokeWidth={1.75} /> },
    { page: 'models', labelKey: 'navModels', icon: <Boxes size={20} strokeWidth={1.75} /> },
    { page: 'export', labelKey: 'navExport', icon: <Download size={20} strokeWidth={1.75} /> },
    { page: 'help', labelKey: 'navHelp', icon: <HelpCircle size={20} strokeWidth={1.75} /> },
  ];

  return (
    <LangContext.Provider value={ctx}>
      <div className="app">
        <header className="app-header">
          <div className="header-brand">
            <div className="header-logo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
            </div>
            <div className="header-titles">
              <h1 className="header-title">{t(lang, 'appTitle')}</h1>
              <span className="header-subtitle">Local API diagnosis</span>
            </div>
          </div>
          <span className="header-badge">{t(lang, 'version')}</span>
        </header>

        <main className="main-content">
          <ErrorBoundary>
            {currentPage === 'home' && <HomePage />}
            {currentPage === 'models' && <ModelsPage />}
            {currentPage === 'export' && <ExportPage />}
            {currentPage === 'help' && <HelpPage />}
          </ErrorBoundary>
        </main>

        <nav className="page-nav">
          {navItems.map(({ page, labelKey, icon }) => (
            <button
              key={page}
              className={`nav-item ${currentPage === page ? 'active' : ''}`}
              onClick={() => setCurrentPage(page)}
            >
              <span className="nav-icon">{icon}</span>
              <span className="nav-label">{t(lang, labelKey)}</span>
            </button>
          ))}
        </nav>
      </div>
    </LangContext.Provider>
  );
};

export default App;
