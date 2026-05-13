/**
 * App.tsx — AI API Doctor MVP
 * Single-page popup with 4 tabs: Home, Models, Export, Help
 */

import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
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
  Trash2,
  AlertTriangle,
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
  summarizeBillingAnomaly,
  runBillingDiagnosis,
  saveBillingReport,
  clearAllLocalData,
} from '../../src/lib/storage';
import { t, resolveLanguage, Language } from '../../src/lib/i18n';
import type { ActiveConfig, DiagnosisReport, CostAuditConfig, CostAuditResult, BillingAnomalyReport, BillingProbeResult, BalanceSnapshot, BillingAnomalySummary, BillingDiagnosisReport, DiagnosisProgress } from '../../src/types';

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
  billingSummary: BillingAnomalySummary;
  overallLabel: string;
  overallLabelZh: string;
  mainIssue: string;
  mainIssueZh: string;
  suggestion: string;
  suggestionZh: string;
}

function calculateTrustScore(report: DiagnosisReport): TrustScoreNew {
  const categories: TrustScoreCategoryNew[] = [];
  const riskTags: string[] = [];

  // Use summarizeBillingAnomaly for billing summary
  const billingSummary = summarizeBillingAnomaly(report.billingAnomaly || { enabled: false }, !!report.activeModelId);

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

  // Billing score (weight 35) - uses summarizeBillingAnomaly result
  let billingScore = 80;
  let billingStatusType: 'success' | 'warning' | 'error' | 'skipped' = 'success';

  if (billingSummary.status === 'signal_confirmed') {
    billingScore = 0;
    billingStatusType = 'error';
  } else if (billingSummary.status === 'needs_review') {
    billingScore = 40;
    billingStatusType = 'warning';
  } else if (billingSummary.status === 'not_found') {
    billingScore = 90;
    billingStatusType = 'success';
  } else if (!report.usageSummary) {
    billingScore = 45;
    billingStatusType = 'skipped';
  } else if (report.usageSummary.status === 'available') {
    billingScore = 90;
    billingStatusType = 'success';
    if (report.usageSummary.totalTokens && report.usageSummary.totalTokens > 50000) {
      billingScore = 75;
      billingStatusType = 'warning';
      riskTags.push('HIGH_TOKEN_USAGE');
    }
  } else if (report.usageSummary.status === 'missing') {
    billingScore = 55;
    billingStatusType = 'warning';
  } else if (report.usageSummary.status === 'anomaly') {
    billingScore = 35;
    billingStatusType = 'error';
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
  if (billingSummary.status === 'signal_confirmed') {
    totalScore = Math.min(totalScore, 60);
  } else if (billingSummary.status === 'needs_review') {
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
  if (billingSummary.status === 'signal_confirmed' && report.billingAnomaly?.balanceSnapshot?.supported) {
    confidence = 'high';
  } else if (billingSummary.status === 'signal_confirmed' && !report.billingAnomaly?.balanceSnapshot?.supported) {
    confidence = 'medium';
  }

  return {
    score: totalScore,
    confidence,
    categories,
    riskTags: [...new Set([...riskTags, ...billingSummary.riskTags])],
    billingSummary,
    overallLabel: billingSummary.title,
    overallLabelZh: billingSummary.titleZh,
    mainIssue: billingSummary.title,
    mainIssueZh: billingSummary.titleZh,
    suggestion: billingSummary.message,
    suggestionZh: billingSummary.messageZh,
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

// ─── Simplified Billing Report ───────────────────────────────

interface BillingReportCardProps {
  report: BillingDiagnosisReport;
  lang: 'zh-CN' | 'en-US';
}

function BillingReportCard({ report, lang }: BillingReportCardProps) {
  const { t } = useLang();
  const timeline = report.rawQuotaTimeline;
  const judgment = report.judgment;

  // Status config based on judgment code
  const getStatusConfig = () => {
    switch (judgment.code) {
      case 'failed_request_not_charged':
      case 'precharge_refunded':
        return {
          label: lang === 'zh-CN' ? '正常' : 'OK',
          color: '#22C55E',
          bgColor: 'rgba(34, 197, 94, 0.15)',
        };
      case 'raw_quota_unavailable':
        return {
          label: lang === 'zh-CN' ? '风险' : 'RISK',
          color: '#F59E0B',
          bgColor: 'rgba(245, 158, 11, 0.15)',
        };
      case 'failed_request_charged':
      case 'empty_response_charged':
        return {
          label: lang === 'zh-CN' ? '异常' : 'ANOMALY',
          color: '#EF4444',
          bgColor: 'rgba(239, 68, 68, 0.15)',
        };
      default:
        return {
          label: lang === 'zh-CN' ? '完成' : 'DONE',
          color: '#2563EB',
          bgColor: 'rgba(37, 99, 235, 0.15)',
        };
    }
  };

  const statusConfig = getStatusConfig();
  const delta10 = timeline?.delta10s;
  const deltaColor = delta10 === undefined ? 'var(--muted)' : delta10 === 0 ? '#22C55E' : (judgment.code === 'failed_request_charged' || judgment.code === 'empty_response_charged') ? '#EF4444' : '#22C55E';
  const deltaDisplay = delta10 === undefined ? '—' : `${delta10 >= 0 ? '+' : ''}${delta10}`;

  return (
    <div className="billing-report-card">
      {/* Header */}
      <div className="billing-report-header">
        <div className="billing-report-title">
          {lang === 'zh-CN' ? '扣费检测结果' : 'Billing Detection Result'}
        </div>
        <div className="billing-report-status" style={{ backgroundColor: statusConfig.bgColor, color: statusConfig.color }}>
          {statusConfig.label}
        </div>
      </div>

      {/* Main Judgment - Large and clear */}
      <div className="billing-judgment">
        <div className="billing-judgment-title" style={{ color: statusConfig.color }}>
          {lang === 'zh-CN' ? judgment.titleZh : judgment.title}
        </div>
      </div>

      {/* Raw Quota Evidence Chain - Simplified */}
      {timeline?.readable && (
        <div className="billing-evidence-chain">
          <div className="billing-evidence-flow">
            <div className="billing-evidence-node">
              <div className="billing-evidence-label">{lang === 'zh-CN' ? '检测前' : 'Before'}</div>
              <div className="billing-evidence-value">{timeline.before?.rawQuota.toLocaleString() ?? '—'}</div>
            </div>
            <div className="billing-evidence-arrow">→</div>
            <div className="billing-evidence-node">
              <div className="billing-evidence-label">HTTP</div>
              <div className="billing-evidence-value" style={{ color: report.invalidModelTest?.httpStatus && report.invalidModelTest.httpStatus >= 400 ? '#EF4444' : '#22C55E' }}>
                {report.invalidModelTest?.httpStatus || '?'}
              </div>
            </div>
            <div className="billing-evidence-arrow">→</div>
            <div className="billing-evidence-node">
              <div className="billing-evidence-label">{lang === 'zh-CN' ? '10 秒后' : 'After 10s'}</div>
              <div className="billing-evidence-value">{timeline.after10s?.rawQuota.toLocaleString() ?? '—'}</div>
            </div>
          </div>
          {delta10 !== undefined && (
            <div className="billing-evidence-delta" style={{ color: deltaColor }}>
              {lang === 'zh-CN' ? '最终变化' : 'Final Delta'}: {deltaDisplay}
            </div>
          )}
        </div>
      )}

      {/* Safety Note */}
      <div className="billing-safety-note">
        {lang === 'zh-CN'
          ? 'API Key 已脱敏。本报告只展示本次测试中的可复现信号，不证明服务商故意多扣费。'
          : 'API Key is masked. This report only shows reproducible signals and does not prove intentional overbilling.'}
      </div>
    </div>
  );
}

// ─── Billing Report Poster (Export Only) ───────────────────

interface BillingReportPosterProps {
  report: BillingDiagnosisReport;
  lang: 'zh-CN' | 'en-US';
}

function BillingReportPoster({ report, lang }: BillingReportPosterProps) {
  const timeline = report.rawQuotaTimeline;
  const judgment = report.judgment;

  // Hard-coded colors for export stability
  const colors = {
    bg: '#F8FAFC',
    cardBg: '#FFFFFF',
    border: '#E5E7EB',
    text: '#0F172A',
    muted: '#475569',
    green: '#16A34A',
    orange: '#F59E0B',
    red: '#DC2626',
    blue: '#2563EB',
  };

  // Status config based on judgment code
  const getStatusConfig = () => {
    switch (judgment.code) {
      case 'failed_request_not_charged':
      case 'precharge_refunded':
        return {
          label: lang === 'zh-CN' ? '正常' : 'OK',
          labelColor: colors.green,
          bgColor: '#DCFCE7',
          icon: '✓',
          title: lang === 'zh-CN' ? judgment.titleZh : judgment.title,
          subtitle: lang === 'zh-CN' ? judgment.detailZh : judgment.detail,
        };
      case 'raw_quota_unavailable':
        return {
          label: lang === 'zh-CN' ? '风险' : 'RISK',
          labelColor: colors.orange,
          bgColor: '#FEF3C7',
          icon: '⚠',
          title: lang === 'zh-CN' ? judgment.titleZh : judgment.title,
          subtitle: lang === 'zh-CN' ? judgment.detailZh : judgment.detail,
        };
      case 'failed_request_charged':
      case 'empty_response_charged':
        return {
          label: lang === 'zh-CN' ? '异常' : 'ANOMALY',
          labelColor: colors.red,
          bgColor: '#FEE2E2',
          icon: '✕',
          title: lang === 'zh-CN' ? judgment.titleZh : judgment.title,
          subtitle: lang === 'zh-CN' ? judgment.detailZh : judgment.detail,
        };
      default:
        return {
          label: lang === 'zh-CN' ? '完成' : 'DONE',
          labelColor: colors.blue,
          bgColor: '#DBEAFE',
          icon: 'ℹ',
          title: lang === 'zh-CN' ? judgment.titleZh : judgment.title,
          subtitle: lang === 'zh-CN' ? judgment.detailZh : judgment.detail,
        };
    }
  };

  const statusConfig = getStatusConfig();
  const delta10 = timeline?.delta10s;
  const deltaColor = delta10 === undefined ? colors.muted : delta10 === 0 ? colors.green : judgment.code === 'failed_request_charged' || judgment.code === 'empty_response_charged' ? colors.red : colors.green;
  const deltaDisplay = delta10 === undefined ? '—' : `${delta10 >= 0 ? '+' : ''}${delta10}`;
  const usdDisplay = timeline?.before && delta10 !== undefined ? `$${(delta10 / timeline.before.quotaPerUnit).toFixed(6)}` : '—';

  const origin = (() => {
    try { return new URL(report.baseUrl).origin; } catch { return report.baseUrl; }
  })();

  return (
    <div
      style={{
        width: '1080px',
        minHeight: '1350px',
        background: colors.bg,
        color: colors.text,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '64px',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '48px' }}>
        <div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: colors.text }}>AI API Doctor</div>
          <div style={{ fontSize: '18px', color: colors.muted }}>{lang === 'zh-CN' ? '扣费异常检测报告' : 'Billing Anomaly Report'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '14px', color: colors.muted }}>{lang === 'zh-CN' ? 'API Key 已脱敏' : 'API Key Masked'}</div>
          <div style={{ fontSize: '14px', color: colors.muted }}>{lang === 'zh-CN' ? '本地检测' : 'Local Report'}</div>
        </div>
      </div>

      {/* Verdict Hero */}
      <div
        style={{
          background: statusConfig.bgColor,
          borderRadius: '36px',
          padding: '48px',
          marginBottom: '32px',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background Circle */}
        <div
          style={{
            position: 'absolute',
            top: '-60px',
            right: '-60px',
            width: '200px',
            height: '200px',
            borderRadius: '50%',
            background: statusConfig.labelColor,
            opacity: 0.15,
          }}
        />
        <div
          style={{
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            background: statusConfig.labelColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
            fontSize: '48px',
            color: '#FFFFFF',
            fontWeight: 700,
          }}
        >
          {statusConfig.icon}
        </div>
        <div
          style={{
            fontSize: '72px',
            fontWeight: 800,
            color: statusConfig.labelColor,
            lineHeight: 1,
            marginBottom: '16px',
          }}
        >
          {statusConfig.label}
        </div>
        <div style={{ fontSize: '48px', fontWeight: 700, color: colors.text, marginBottom: '12px' }}>
          {statusConfig.title}
        </div>
        <div style={{ fontSize: '20px', color: colors.muted, maxWidth: '700px', margin: '0 auto' }}>
          {statusConfig.subtitle}
        </div>
      </div>

      {/* Raw Quota Evidence Chain */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontSize: '16px', fontWeight: 600, color: colors.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '20px' }}>
          {lang === 'zh-CN' ? '原始额度证据链' : 'Raw Quota Evidence Chain'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '24px' }}>
          {/* Before */}
          <div style={{ flex: 1, background: colors.cardBg, border: `2px solid ${colors.border}`, borderRadius: '24px', padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: '14px', color: colors.muted, marginBottom: '8px' }}>{lang === 'zh-CN' ? '检测前' : 'Before'}</div>
            <div style={{ fontSize: '36px', fontWeight: 700, color: colors.text }}>{timeline?.before?.rawQuota.toLocaleString() ?? '—'}</div>
          </div>

          {/* Arrow 1 */}
          <div style={{ fontSize: '32px', color: colors.muted }}>→</div>

          {/* Test Request */}
          <div style={{ flex: 1, background: colors.cardBg, border: `2px solid ${colors.border}`, borderRadius: '24px', padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: '14px', color: colors.muted, marginBottom: '8px' }}>{lang === 'zh-CN' ? '测试请求' : 'Test Request'}</div>
            <div style={{ fontSize: '36px', fontWeight: 700, color: report.invalidModelTest?.httpStatus && report.invalidModelTest.httpStatus >= 400 ? colors.red : colors.green }}>
              {report.invalidModelTest?.httpStatus ? `HTTP ${report.invalidModelTest.httpStatus}` : '—'}
            </div>
            <div style={{ fontSize: '14px', color: colors.muted, marginTop: '8px' }}>OpenAI Chat</div>
          </div>

          {/* Arrow 2 */}
          <div style={{ fontSize: '32px', color: colors.muted }}>→</div>

          {/* After 10s */}
          <div style={{ flex: 1, background: colors.cardBg, border: `2px solid ${colors.border}`, borderRadius: '24px', padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: '14px', color: colors.muted, marginBottom: '8px' }}>{lang === 'zh-CN' ? '10 秒后' : 'After 10s'}</div>
            <div style={{ fontSize: '36px', fontWeight: 700, color: colors.text }}>{timeline?.after10s?.rawQuota.toLocaleString() ?? '—'}</div>
          </div>
        </div>

        {/* Delta Summary */}
        <div style={{ background: colors.cardBg, border: `2px solid ${colors.border}`, borderRadius: '24px', padding: '32px', textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: 600, color: colors.muted, marginBottom: '12px' }}>{lang === 'zh-CN' ? '最终变化' : 'Final Delta'}</div>
          <div style={{ fontSize: '64px', fontWeight: 800, color: deltaColor, marginBottom: '8px' }}>{deltaDisplay}</div>
          <div style={{ fontSize: '24px', color: colors.muted }}>{lang === 'zh-CN' ? '约合金额' : '≈ USD'}: {usdDisplay}</div>
        </div>
      </div>

      {/* Mini Evidence Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
        <div style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: '16px', padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '8px' }}>HTTP {lang === 'zh-CN' ? '状态' : 'Status'}</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: report.invalidModelTest?.httpStatus && report.invalidModelTest.httpStatus >= 400 ? colors.red : colors.green }}>
            {report.invalidModelTest?.httpStatus || '—'}
          </div>
        </div>
        <div style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: '16px', padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '8px' }}>{lang === 'zh-CN' ? '有效输出' : 'Effective Output'}</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: colors.text }}>
            {report.baselineTest?.outputSignal?.hasAnyEffectiveOutput ? (lang === 'zh-CN' ? '有' : 'Yes') : (lang === 'zh-CN' ? '无' : 'No')}
          </div>
        </div>
        <div style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: '16px', padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '8px' }}>completion_tokens</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: colors.text }}>
            {report.baselineTest?.outputSignal?.completionTokens ?? '—'}
          </div>
        </div>
        <div style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: '16px', padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '8px' }}>total_tokens</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: colors.text }}>
            {report.baselineTest?.outputSignal?.totalTokens ?? '—'}
          </div>
        </div>
      </div>

      {/* Context Info */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '32px' }}>
        <div style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: '16px', padding: '20px' }}>
          <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '4px' }}>Base URL</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text, wordBreak: 'break-all' }}>{report.baseUrl}</div>
        </div>
        <div style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: '16px', padding: '20px' }}>
          <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '4px' }}>{lang === 'zh-CN' ? '模型' : 'Model'}</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text }}>{report.activeModelId || '—'}</div>
        </div>
        <div style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: '16px', padding: '20px' }}>
          <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '4px' }}>{lang === 'zh-CN' ? '接口' : 'Interface'}</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text }}>OpenAI Chat</div>
        </div>
        <div style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: '16px', padding: '20px' }}>
          <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '4px' }}>{lang === 'zh-CN' ? '时间' : 'Time'}</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text }}>{new Date(report.startedAt).toLocaleString()}</div>
        </div>
      </div>

      {/* Safety Note */}
      <div style={{ background: '#F1F5F9', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px' }}>
        <div style={{ fontSize: '14px', color: colors.muted, lineHeight: 1.6 }}>
          {lang === 'zh-CN'
            ? 'API Key 已脱敏。本报告只展示本次测试中的可复现信号，不证明服务商故意多扣费。'
            : 'API Key is masked. This report only shows reproducible signals from this test and does not prove intentional overbilling.'}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '16px', borderTop: `1px solid ${colors.border}` }}>
        <div style={{ fontSize: '14px', color: colors.muted }}>
          {lang === 'zh-CN' ? '由 AI API Doctor 生成' : 'Generated by AI API Doctor'}
        </div>
        <div style={{ fontSize: '14px', color: colors.muted, fontFamily: 'monospace' }}>aiapidoctor.com</div>
      </div>
    </div>
  );
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

      {/* Export Mode Evidence Section - Only visible in export-mode */}
      <div className="rc2-export-evidence">
        <div className="rc2-export-title">
          {lang === 'zh-CN' ? '详细证据 / Detailed Evidence' : 'Detailed Evidence'}
        </div>
        <div className="rc2-export-grid">
          <div className="rc2-export-item">
            <span className="rc2-export-label">{lang === 'zh-CN' ? 'Provider' : 'Provider'}</span>
            <span className="rc2-export-value">{report.providerName}</span>
          </div>
          <div className="rc2-export-item">
            <span className="rc2-export-label">Base URL</span>
            <span className="rc2-export-value">{baseUrl}</span>
          </div>
          <div className="rc2-export-item">
            <span className="rc2-export-label">Model</span>
            <span className="rc2-export-value">{report.activeModelId || 'Not selected'}</span>
          </div>
          <div className="rc2-export-item">
            <span className="rc2-export-label">{lang === 'zh-CN' ? '时间' : 'Time'}</span>
            <span className="rc2-export-value">{new Date(report.startedAt).toLocaleString()}</span>
          </div>
        </div>

        {report.billingAnomaly?.emptyReplyProbe && (
          <>
            <div className="rc2-export-subtitle">
              {lang === 'zh-CN' ? '空回复扣费 / Empty Reply Charge' : 'Empty Reply Charge'}
            </div>
            <div className="rc2-export-grid">
              <div className="rc2-export-item">
                <span className="rc2-export-label">HTTP</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.httpStatus || 'N/A'}</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">Request ID</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.requestId || 'N/A'}</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">{lang === 'zh-CN' ? '可见输出' : 'Visible Output'}</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.outputSignal?.visibleText?.length ?? 0} chars</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">completion_tokens</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.outputSignal?.completionTokens ?? 'N/A'}</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">total_tokens</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.outputSignal?.totalTokens ?? 'N/A'}</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">hasToolCall</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.outputSignal?.hasToolCall ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </>
        )}

        {report.billingAnomaly?.failedRequestProbe && (
          <>
            <div className="rc2-export-subtitle">
              {lang === 'zh-CN' ? '失败请求扣费 / Failed Request Charge' : 'Failed Request Charge'}
            </div>
            <div className="rc2-export-grid">
              <div className="rc2-export-item">
                <span className="rc2-export-label">HTTP</span>
                <span className="rc2-export-value">{report.billingAnomaly.failedRequestProbe.httpStatus || 'N/A'}</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">Request ID</span>
                <span className="rc2-export-value">{report.billingAnomaly.failedRequestProbe.requestId || 'N/A'}</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">Provider Message</span>
                <span className="rc2-export-value">{report.billingAnomaly.failedRequestProbe.providerMessage || 'N/A'}</span>
              </div>
            </div>
          </>
        )}

        {report.billingAnomaly?.emptyReplyProbe?.balanceTimeline && (
          <>
            <div className="rc2-export-subtitle">
              {lang === 'zh-CN' ? '余额时间线 / Balance Timeline' : 'Balance Timeline'}
            </div>
            <div className="rc2-export-grid">
              <div className="rc2-export-item">
                <span className="rc2-export-label">{lang === 'zh-CN' ? '余额来源' : 'Source'}</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.balanceTimeline.source || 'N/A'}</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">{lang === 'zh-CN' ? '诊断前余额' : 'Before'}</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.balanceTimeline.before?.available?.toFixed(6) ?? 'N/A'}</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">{lang === 'zh-CN' ? '即时余额' : 'After Immediate'}</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.balanceTimeline.afterImmediate?.available?.toFixed(6) ?? 'N/A'}</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">{lang === 'zh-CN' ? '结算后余额' : 'After Settled'}</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.balanceTimeline.afterSettled?.available?.toFixed(6) ?? 'N/A'}</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">{lang === 'zh-CN' ? '即时差异' : 'Delta Immediate'}</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.balanceTimeline.deltaImmediate?.toFixed(6) ?? 'N/A'}</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">{lang === 'zh-CN' ? '结算差异' : 'Delta Settled'}</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.balanceTimeline.deltaSettled?.toFixed(6) ?? 'N/A'}</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">{lang === 'zh-CN' ? '状态' : 'Status'}</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.balanceTimeline.status || 'N/A'}</span>
              </div>
              <div className="rc2-export-item">
                <span className="rc2-export-label">settlementDelay</span>
                <span className="rc2-export-value">{report.billingAnomaly.emptyReplyProbe.balanceTimeline.settlementDelayMs || 'N/A'}ms</span>
              </div>
            </div>
          </>
        )}
      </div>

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

  // Page domain fill state
  const [pageDomainState, setPageDomainState] = useState<{
    status: 'idle' | 'filled';
    origin?: string;
    baseUrl?: string;
    hostname?: string;
    tabId?: number;
    message?: string;
  }>({ status: 'idle' });

  // Console verification state
  const [consoleVerifyState, setConsoleVerifyState] = useState<{
    status: 'idle' | 'checking' | 'verified' | 'not_newapi' | 'not_logged_in' | 'permission_denied' | 'status_timeout' | 'self_timeout' | 'error';
    origin?: string;
    tabId?: number;
    errorCode?: string;
    message?: string;
  }>({ status: 'idle' });

  // Raw quota state
  const [rawQuotaState, setRawQuotaState] = useState<{
    status: 'idle' | 'available' | 'unavailable';
    errorCode?: string;
    message?: string;
  }>({ status: 'idle' });

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DiagnosisProgress | null>(null);
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [billingReport, setBillingReport] = useState<BillingDiagnosisReport | null>(null);
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'md' | 'issue' | 'text' | 'provider'>('idle');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'generating' | 'saved' | 'failed'>('idle');
  const [saveToast, setSaveToast] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showExample, setShowExample] = useState(false);
  const [showCostAudit, setShowCostAudit] = useState(false);
  const [showCostAuditAdvanced, setShowCostAuditAdvanced] = useState(false);
  const [showBillingAnomaly, setShowBillingAnomaly] = useState(false);
  const [billingAnomalyEnabled, setBillingAnomalyEnabled] = useState(false);
  const [includeBaselineTest, setIncludeBaselineTest] = useState(false); // Baseline test off by default
  const [costAuditInput, setCostAuditInput] = useState({
    inputPricePerM: '',
    outputPricePerM: '',
    cachedInputPricePerM: '',
    cacheWritePriceM: '',
    beforeBalance: '',
    afterBalance: '',
    currency: 'USD' as 'USD' | 'CNY' | 'points',
  });
  const reportCardRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  // Track unsaved config changes for Models page hint
  const configDirtyRef = useRef(false);

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
    if (!value.trim()) return;
    const result = parseConnectionInput(value);
    if (result.success) {
      setConfig((prev) => ({
        ...prev,
        baseUrl: result.baseUrl ?? prev.baseUrl,
        apiKey: result.apiKey ?? prev.apiKey,
        source: result.source ?? prev.source,
      }));
      configDirtyRef.current = true;
      localStorage.setItem('aiapidoctor-config-dirty', '1');
    }
  }, []);

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
    configDirtyRef.current = false;
    localStorage.removeItem('aiapidoctor-config-dirty');
    // Notify models page that config was saved
    window.dispatchEvent(new CustomEvent('aiapidoctor-config-saved'));
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 3000);
  }, [config, costAuditInput]);

  const handleRun = useCallback(async () => {
    if (!config.baseUrl || !config.apiKey) return;
    setRunning(true);
    setReport(null);
    setBillingReport(null);
    setProgress(null);

    try {
      const next = { ...config, updatedAt: new Date().toISOString() };
      await saveActiveConfig(next);
      configDirtyRef.current = false;
      localStorage.removeItem('aiapidoctor-config-dirty');
      window.dispatchEvent(new CustomEvent('aiapidoctor-config-saved'));

      // Use saved consoleTabId if available, otherwise fallback to current tab
      let tabIdToUse = pageDomainState.tabId;
      if (!tabIdToUse) {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          throw new Error('Cannot get current tab');
        }
        tabIdToUse = tab.id;
      }

      // Run simplified billing diagnosis with progress callback
      const billingRep = await runBillingDiagnosis(
        next.baseUrl,
        next.apiKey,
        next.modelId || 'gpt-4o-mini',
        tabIdToUse,
        {
          onProgress: (prog) => setProgress(prog),
          includeBaseline: includeBaselineTest,
        }
      );

      // Save report to storage and get reportId
      const reportId = await saveBillingReport(billingRep);

      // Clear consoleVerifyState error after successful diagnosis
      setConsoleVerifyState((prev) => {
        if (prev.status === 'error' || prev.status === 'permission_denied' || prev.status === 'status_timeout' || prev.status === 'self_timeout') {
          // If raw quota was readable, show verified; otherwise show unverified
          if (billingRep.rawQuotaTimeline?.readable) {
            return {
              status: 'verified',
              origin: prev.origin,
              tabId: prev.tabId,
              message: lang === 'zh-CN' ? t('consoleVerifyVerifiedWithQuota') : t('consoleVerifyVerifiedWithQuotaZh'),
            };
          } else {
            return {
              status: 'idle',
              message: lang === 'zh-CN' ? t('consoleVerifyNoQuotaBasicDone') : t('consoleVerifyNoQuotaBasicDoneZh'),
            };
          }
        }
        return prev;
      });

      setBillingReport(billingRep);
      setCurrentReportId(reportId);
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
      setProgress(null);
    }
  }, [config, includeBaselineTest, pageDomainState.tabId]);

  // Auto-detect and verify New API / One API from active tab using content script
  const handleDetectSite = useCallback(async () => {
    // Reset states first
    setConsoleVerifyState({ status: 'idle' });
    setRawQuotaState({ status: 'idle' });

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab?.url) {
        setConsoleVerifyState({
          status: 'error',
          message: lang === 'zh-CN' ? '未验证。说明：未验证为 New API / One API 控制台，仅影响 raw quota 精确读取。' : 'Unverified. Only affects precise raw quota reading.',
        });
        return;
      }

      // Try to parse URL
      let origin: string;
      let hostname: string;
      let baseUrl: string;

      try {
        const url = new URL(tab.url);
        if (!url.protocol.startsWith('http')) {
          setConsoleVerifyState({
            status: 'error',
            message: lang === 'zh-CN' ? '未验证。请打开 New API / One API 控制台或 API 站点页面。' : 'Unverified. Please open New API / One API console or API site page.',
          });
          return;
        }
        origin = url.origin;
        hostname = url.hostname;
        baseUrl = `${origin}/v1`;
      } catch {
        setConsoleVerifyState({
          status: 'error',
          message: lang === 'zh-CN' ? '无法解析当前页面 URL，请打开网页后重试。' : 'Cannot parse current page URL. Please open a webpage and try again.',
        });
        return;
      }

      // Immediately fill domain - this happens BEFORE verification
      setConfig(prev => ({
        ...prev,
        baseUrl,
        providerName: prev.providerName || hostname,
      }));
      configDirtyRef.current = true;
      localStorage.setItem('aiapidoctor-config-dirty', '1');

      setPageDomainState({
        status: 'filled',
        origin,
        baseUrl,
        hostname,
        tabId: tab.id,
        message: lang === 'zh-CN' ? '已填入当前页面域名' : 'Domain filled from current page',
      });

      // Start async verification - use consoleOrigin, NOT baseUrl
      setConsoleVerifyState({
        status: 'checking',
        origin,
        tabId: tab.id,
        message: lang === 'zh-CN' ? '正在验证控制台...' : 'Verifying console...',
      });

      // Run verification separately to avoid catching it in URL parsing try-catch
      try {
        const result = await verifyNewApiSite(tab.id, origin);

        if (result.isNewApi) {
          if (result.quota !== undefined) {
            // Full verification success
            setConsoleVerifyState({
              status: 'verified',
              origin,
              tabId: tab.id,
              message: lang === 'zh-CN' ? '✓ 已验证控制台，可读取 raw quota' : '✓ Verified console, can read raw quota',
            });
            setRawQuotaState({ status: 'available' });
          } else {
            // New API but no quota field
            setConsoleVerifyState({
              status: 'verified',
              origin,
              tabId: tab.id,
              errorCode: 'QUOTA_FIELD_MISSING',
              message: lang === 'zh-CN' ? '✓ 已验证控制台，但未返回 quota 字段' : '✓ Console verified, but quota field not returned',
            });
            setRawQuotaState({ status: 'unavailable', errorCode: 'QUOTA_FIELD_MISSING' });
          }
        } else if (result.error === 'USER_NOT_FOUND') {
          setConsoleVerifyState({
            status: 'not_logged_in',
            origin,
            tabId: tab.id,
            errorCode: 'USER_NOT_FOUND',
            message: lang === 'zh-CN' ? '当前页面像 New API / One API，但未找到登录用户。请登录控制台后重试。' : 'Site looks like New API / One API, but no logged-in user found. Please sign in to the console and try again.',
          });
          setRawQuotaState({ status: 'unavailable', errorCode: 'USER_NOT_FOUND' });
        } else if (result.error === 'PERMISSION_DENIED') {
          setConsoleVerifyState({
            status: 'permission_denied',
            origin,
            tabId: tab.id,
            errorCode: 'PERMISSION_DENIED',
            message: lang === 'zh-CN' ? '浏览器未授权访问当前站点，请允许插件访问该域名。' : 'Browser not authorized to access this site. Please allow the extension to access this domain.',
          });
        } else if (result.error === 'CONTENT_SCRIPT_TIMEOUT' || result.error === 'CONTENT_SCRIPT_FAILED') {
          setConsoleVerifyState({
            status: 'status_timeout',
            origin,
            tabId: tab.id,
            errorCode: 'STATUS_TIMEOUT',
            message: lang === 'zh-CN' ? '无法读取 /api/status，可能是站点无响应或浏览器未授权。' : 'Cannot read /api/status. The site may be unresponsive or browser not authorized.',
          });
        } else if (result.error === 'SELF_TIMEOUT') {
          setConsoleVerifyState({
            status: 'self_timeout',
            origin,
            tabId: tab.id,
            errorCode: 'SELF_TIMEOUT',
            message: lang === 'zh-CN' ? '无法读取 /api/user/self，可能是登录状态失效或接口无响应。' : 'Cannot read /api/user/self. Login may have expired or the API is unresponsive.',
          });
        } else {
          // NOT_NEW_API or other error
          setConsoleVerifyState({
            status: 'not_newapi',
            origin,
            tabId: tab.id,
            errorCode: result.error,
            message: lang === 'zh-CN' ? '已填入当前页面域名，但未验证为 New API / One API 控制台。可继续手动修改 Base URL；raw quota 精确检测可能不可用。' : 'Domain filled but not verified as New API / One API. You can manually modify Base URL; raw quota detection may not be available.',
          });
          setRawQuotaState({ status: 'unavailable', errorCode: result.error });
        }
      } catch (verifyError) {
        // Verification failed - but PageDomainState stays as 'filled'
        setConsoleVerifyState({
          status: 'error',
          origin,
          tabId: tab.id,
          message: lang === 'zh-CN' ? '未验证。说明：未验证为 New API / One API 控制台，仅影响 raw quota 精确读取。' : 'Unverified. Only affects precise raw quota reading.',
        });
      }
    } catch (e) {
      setConsoleVerifyState({
        status: 'error',
        message: lang === 'zh-CN' ? '未验证。说明：未验证为 New API / One API 控制台，仅影响 raw quota 精确读取。' : 'Unverified. Only affects precise raw quota reading.',
      });
    }
  }, [lang]);

  const handleUseExample = useCallback(() => {
    setConfig({
      providerName: 'Link-AI',
      baseUrl: 'https://api1.link-ai.cc/v1',
      apiKey: '',
      modelId: '',
      source: 'example',
      updatedAt: new Date().toISOString(),
    });
    setReport(null);
  }, []);

  // DEV helper: Generate mock reports for testing
  const handleMockReport = useCallback((type: 'not_found' | 'needs_review' | 'signal_confirmed') => {
    const mockReport: DiagnosisReport = {
      providerName: 'Mock Provider',
      baseUrl: 'https://mock.example.com/v1',
      maskedKey: 'sk-mock****',
      activeModelId: 'gpt-4o-mini',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      overallStatus: type === 'signal_confirmed' ? 'error' : type === 'needs_review' ? 'warning' : 'success',
      passedCount: type === 'signal_confirmed' ? 4 : type === 'needs_review' ? 5 : 7,
      totalCount: 8,
      steps: [
        { key: 'base_url', title: 'Base URL', status: 'success', latencyMs: 50 },
        { key: 'api_key', title: 'API Key', status: 'success', latencyMs: 30 },
        { key: 'models', title: 'Models', status: 'success', latencyMs: 100, modelCount: 50 },
        { key: 'model', title: 'Model', status: 'success', latencyMs: 20 },
        { key: 'chat', title: 'Chat', status: type === 'signal_confirmed' ? 'warning' : 'success', latencyMs: 800, responseText: 'Hello!' },
        { key: 'usage', title: 'Usage', status: 'success', latencyMs: 10 },
        { key: 'audit', title: 'Audit', status: 'success', latencyMs: 50 },
      ],
      usageSummary: {
        status: 'available',
        promptTokens: 10,
        completionTokens: type === 'signal_confirmed' ? 0 : 5,
        totalTokens: type === 'signal_confirmed' ? 10 : 15,
      },
      billingAnomaly: {
        enabled: true,
        balanceSnapshot: {
          supported: true,
          source: 'newapi',
          granted: 100,
          used: 10,
          available: type === 'signal_confirmed' ? 9.999 : 99.99,
          unlimited: false,
          precision: 6,
        },
        emptyReplyProbe: type === 'signal_confirmed' ? {
          key: 'empty_reply_charge',
          title: 'Empty Reply Charge',
          status: 'signal_confirmed',
          result: 'signal_confirmed',
          confirmed: true,
          highRisk: true,
          httpStatus: 200,
          streamStatus: 'done',
          outputSignal: {
            visibleText: '',
            completionTokens: 0,
            promptTokens: 10,
            totalTokens: 10,
            finishReason: 'stop',
            stopReason: 'stop',
            hasToolCall: false,
            hasImage: false,
            hasAudio: false,
            hasSearch: false,
            hasRefusal: false,
            hasContentFilter: false,
            hasErrorEvent: false,
            hasAnyEffectiveOutput: false,
          },
          balanceTimeline: {
            source: 'newapi',
            before: { supported: true, source: 'newapi', available: 100, precision: 6 },
            afterImmediate: { supported: true, source: 'newapi', available: 99.999 },
            afterSettled: { supported: true, source: 'newapi', available: type === 'signal_confirmed' ? 99.999 : 100 },
            deltaImmediate: type === 'signal_confirmed' ? -0.001 : 0,
            deltaSettled: type === 'signal_confirmed' ? -0.001 : 0,
            status: type === 'signal_confirmed' ? 'decreased' : 'available',
            settlementDelayMs: 1500,
          },
          message: type === 'signal_confirmed' ? 'Empty reply with balance decrease detected' : 'No empty reply charge found',
          suggestion: type === 'signal_confirmed' ? 'Contact provider to review logs' : 'No action needed',
          evidence: {
            visibleOutputLength: 0,
            completionTokens: 0,
            hasToolCall: false,
            hasImage: false,
            hasAudio: false,
            hasSearch: false,
            balanceSource: 'newapi',
            balanceDeltaImmediate: type === 'signal_confirmed' ? -0.001 : 0,
            balanceDeltaSettled: type === 'signal_confirmed' ? -0.001 : 0,
          },
        } : type === 'needs_review' ? {
          key: 'empty_reply_charge',
          title: 'Empty Reply Charge',
          status: 'needs_review',
          result: 'needs_review',
          confirmed: false,
          highRisk: true,
          httpStatus: 200,
          streamStatus: 'done',
          outputSignal: {
            visibleText: '',
            completionTokens: 0,
            promptTokens: 10,
            totalTokens: 10,
            finishReason: 'stop',
            stopReason: 'stop',
            hasToolCall: false,
            hasImage: false,
            hasAudio: false,
            hasSearch: false,
            hasRefusal: false,
            hasContentFilter: false,
            hasErrorEvent: false,
            hasAnyEffectiveOutput: false,
          },
          balanceTimeline: {
            source: 'unsupported',
            before: { supported: false, source: 'unsupported' },
            afterImmediate: { supported: false, source: 'unsupported' },
            afterSettled: { supported: false, source: 'unsupported' },
            deltaImmediate: undefined,
            deltaSettled: undefined,
            status: 'not_available',
            settlementDelayMs: 1500,
          },
          message: 'Empty reply detected but balance unavailable',
          suggestion: 'Check provider dashboard for balance confirmation',
          evidence: {
            visibleOutputLength: 0,
            completionTokens: 0,
            hasToolCall: false,
            hasImage: false,
            hasAudio: false,
            hasSearch: false,
            balanceSource: 'unsupported',
          },
        } : {
          key: 'empty_reply_charge',
          title: 'Empty Reply Charge',
          status: 'not_found',
          result: 'not_found',
          confirmed: false,
          highRisk: false,
          httpStatus: 200,
          streamStatus: 'done',
          outputSignal: {
            visibleText: 'Hello!',
            completionTokens: 5,
            promptTokens: 10,
            totalTokens: 15,
            finishReason: 'stop',
            stopReason: 'stop',
            hasToolCall: false,
            hasImage: false,
            hasAudio: false,
            hasSearch: false,
            hasRefusal: false,
            hasContentFilter: false,
            hasErrorEvent: false,
            hasAnyEffectiveOutput: true,
          },
          message: 'No empty reply charge found',
          suggestion: 'No action needed',
          evidence: {
            visibleOutputLength: 6,
            completionTokens: 5,
            totalTokens: 15,
            hasToolCall: false,
            hasImage: false,
            hasAudio: false,
            hasSearch: false,
            balanceSource: 'newapi',
            balanceDeltaImmediate: 0,
            balanceDeltaSettled: 0,
          },
        },
        failedRequestProbe: type === 'not_found' ? {
          key: 'failed_request_charge',
          title: 'Failed Request Charge',
          status: 'not_found',
          result: 'not_found',
          confirmed: false,
          highRisk: false,
          httpStatus: 404,
          providerMessage: 'model not found',
          outputSignal: {
            visibleText: '',
            completionTokens: 0,
            hasToolCall: false,
            hasImage: false,
            hasAudio: false,
            hasSearch: false,
            hasRefusal: false,
            hasContentFilter: false,
            hasErrorEvent: false,
            hasAnyEffectiveOutput: false,
          },
          message: 'No failed request charge found',
          suggestion: 'No action needed',
          evidence: {
            visibleOutputLength: 0,
            hasToolCall: false,
            hasImage: false,
            hasAudio: false,
            hasSearch: false,
            balanceSource: 'newapi',
            balanceDeltaSettled: 0,
          },
        } : {
          key: 'failed_request_charge',
          title: 'Failed Request Charge',
          status: 'needs_review',
          result: 'needs_review',
          confirmed: false,
          highRisk: true,
          httpStatus: 404,
          providerMessage: 'model not found',
          outputSignal: {
            visibleText: '',
            completionTokens: 0,
            hasToolCall: false,
            hasImage: false,
            hasAudio: false,
            hasSearch: false,
            hasRefusal: false,
            hasContentFilter: false,
            hasErrorEvent: false,
            hasAnyEffectiveOutput: false,
          },
          balanceTimeline: {
            source: 'unsupported',
            before: { supported: false, source: 'unsupported' },
            afterImmediate: { supported: false, source: 'unsupported' },
            afterSettled: { supported: false, source: 'unsupported' },
            status: 'not_available',
            settlementDelayMs: 1500,
          },
          message: 'Request failed but balance unavailable',
          suggestion: 'Check provider dashboard',
          evidence: {
            visibleOutputLength: 0,
            hasToolCall: false,
            hasImage: false,
            hasAudio: false,
            hasSearch: false,
            balanceSource: 'unsupported',
          },
        },
      },
      totalLatencyMs: 1000,
      totalTokens: type === 'signal_confirmed' ? 10 : 15,
    };
    setReport(mockReport);
  }, []);

  const handleCopyMd = useCallback(async () => {
    if (!report) return;
    try {
      const lines: string[] = [];
      lines.push('# AI API Doctor Report');
      lines.push('');

      // Trust Score
      const trustScore = calculateTrustScore(report);
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

  const handleCopyForProvider = useCallback(async () => {
    if (!billingReport) return;
    try {
      const lines: string[] = [];
      const isZh = lang === 'zh-CN';
      const timeline = billingReport.rawQuotaTimeline;
      const conn = billingReport.modelConnectivityTest;

      // Header
      if (isZh) {
        lines.push('AI API Doctor 扣费异常检测报告');
      } else {
        lines.push('AI API Doctor Billing Anomaly Report');
      }
      lines.push('');

      // Detection Score
      lines.push(`${isZh ? '本次检测分' : 'Detection Score'}: ${billingReport.detectionScore ?? '—'}/100`);
      lines.push('');

      // Conclusion
      lines.push(`${isZh ? '结论' : 'Conclusion'}: ${isZh ? billingReport.judgment.titleZh : billingReport.judgment.title}`);
      lines.push(`${isZh ? '说明' : 'Message'}: ${isZh ? billingReport.judgment.detailZh : billingReport.judgment.detail}`);
      lines.push('');

      // Config
      lines.push(`Origin: ${new URL(billingReport.baseUrl).origin}`);
      lines.push(`Base URL: ${billingReport.baseUrl}`);
      lines.push(`Model: ${billingReport.activeModelId || 'N/A'}`);
      lines.push(`Time: ${new Date(billingReport.startedAt).toLocaleString()}`);
      lines.push('');

      // Raw Quota
      if (timeline && timeline.readable) {
        lines.push(isZh ? '原始额度:' : 'Raw Quota:');
        lines.push(`- ${isZh ? '检测前' : 'Before'}: ${timeline.before?.rawQuota?.toLocaleString() ?? 'N/A'}`);
        lines.push(`- ${isZh ? '10 秒后' : 'After 10s'}: ${timeline.after10s?.rawQuota?.toLocaleString() ?? 'N/A'}`);
        if (timeline.delta10s !== undefined) {
          lines.push(`- ${isZh ? '最终变化' : 'Final Delta'}: ${timeline.delta10s >= 0 ? '+' : ''}${timeline.delta10s}`);
        }
        lines.push('');
      } else {
        lines.push(`${isZh ? '原始额度' : 'Raw Quota'}: ${isZh ? '无法读取' : 'Unavailable'}`);
        lines.push('');
      }

      // Model Connectivity
      lines.push(isZh ? '模型联通:' : 'Model Connectivity:');
      if (conn) {
        const statusMap: Record<string, string> = {
          passed: isZh ? '通过' : 'Passed',
          review: isZh ? '需复查' : 'Review',
          failed: isZh ? '失败' : 'Failed',
          skipped: isZh ? '未检测' : 'Not tested',
        };
        lines.push(`- ${isZh ? '状态' : 'Status'}: ${statusMap[conn.status] || conn.status}`);
        if (conn.httpStatus) lines.push(`- HTTP: ${conn.httpStatus}`);
        if (conn.latencyMs) lines.push(`- Latency: ${conn.latencyMs}ms`);
        if (conn.visibleOutputLength !== undefined) lines.push(`- ${isZh ? '输出长度' : 'Output Length'}: ${conn.visibleOutputLength}`);
        if (conn.totalTokens) lines.push(`- total_tokens: ${conn.totalTokens}`);
        if (conn.requestId) lines.push(`- request_id: ${conn.requestId}`);
        if (conn.errorMessage) lines.push(`- ${isZh ? '错误' : 'Error'}: ${conn.errorMessage}`);
      } else {
        lines.push(`- ${isZh ? '状态' : 'Status'}: ${isZh ? '未检测' : 'Not tested'}`);
      }
      lines.push('');

      // Safety
      lines.push(`${isZh ? '安全说明' : 'Safety Note'}: ${isZh ? 'API Key 已脱敏。本报告只展示本次测试中的可复现信号，不证明服务商故意多扣费。' : 'API Key is masked. This report only shows reproducible signals from this test.'}`);
      lines.push('');
      lines.push('Generated by AI API Doctor · https://aiapidoctor.com');

      await copyToClipboard(lines.join('\n'));
      setCopyState('provider');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch { setCopyState('idle'); }
  }, [billingReport, lang]);

  // handleSaveImage is now only used for legacy report - billing report goes to report page
  const handleSaveImage = useCallback(async () => {
    // This function is no longer used for billing reports
    // Users should use the report page to save images
  }, []);

  const canRun = !!config.baseUrl && !!config.apiKey;

  return (
    <div className="page home-page">
      {/* Save success toast */}
      {saveToast && (
        <div className="toast toast-success">
          <CheckCircle2 size={14} />
          <span>{lang === 'zh-CN' ? t('saveLocallySuccess') : t('saveLocallySuccessEn')}</span>
        </div>
      )}

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
            onChange={(e) => { setConfig((p) => ({ ...p, providerName: e.target.value })); configDirtyRef.current = true; localStorage.setItem('aiapidoctor-config-dirty', '1'); }}
          />
        </div>

        {/* Base URL */}
        <div className="form-group">
          <div className="form-label-row">
            <span className="form-label">{t('baseUrl')}</span>
            <span className="form-label-tag required">{t('baseUrlRequired')}</span>
          </div>
          <div className="form-input-with-action">
            <input
              type="url"
              className="form-input"
              placeholder={t('baseUrlPlaceholder')}
              value={config.baseUrl}
              onChange={(e) => {
                setConfig((p) => ({ ...p, baseUrl: e.target.value }));
                configDirtyRef.current = true;
                localStorage.setItem('aiapidoctor-config-dirty', '1');
                // Clear stale consoleVerifyState error on manual edit
                setConsoleVerifyState((prev) =>
                  prev.status === 'error' || prev.status === 'permission_denied' || prev.status === 'status_timeout' || prev.status === 'self_timeout'
                    ? { ...prev, status: 'idle', errorCode: undefined, message: undefined }
                    : prev
                );
              }}
            />
            <button className="btn btn-ghost btn-sm" onClick={handleDetectSite}>
              {t('detectFromSite')}
            </button>
          </div>

          {/* Page Domain State Message */}
          {pageDomainState.status === 'filled' && pageDomainState.message && (
            <div className="parse-hint parse-hint-info">
              {pageDomainState.message}
            </div>
          )}

          {/* Console Verification State */}
          {consoleVerifyState.status !== 'idle' && (
            <div className={`console-verify-status ${
              consoleVerifyState.status === 'verified' ? 'console-verify-verified' :
              consoleVerifyState.status === 'checking' ? 'console-verify-checking' :
              consoleVerifyState.status === 'error' ? 'console-verify-error' :
              'console-verify-warning'
            }`}>
              <span className="console-verify-label">{lang === 'zh-CN' ? '控制台验证' : 'Console Verification'}: </span>
              {consoleVerifyState.message && <span>{consoleVerifyState.message}</span>}
            </div>
          )}

          {/* Raw Quota State */}
          {rawQuotaState.status !== 'idle' && (
            <div className={`raw-quota-status ${
              rawQuotaState.status === 'available' ? 'raw-quota-available' :
              rawQuotaState.status === 'unavailable' ? 'raw-quota-unavailable' : ''
            }`}>
              {rawQuotaState.status === 'available' && (lang === 'zh-CN' ? '✓ Raw quota 可读取' : '✓ Raw quota readable')}
              {rawQuotaState.status === 'unavailable' && (lang === 'zh-CN' ? '⚠ Raw quota 不可用' : '⚠ Raw quota unavailable')}
            </div>
          )}
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
            onChange={(e) => {
              setConfig((p) => ({ ...p, apiKey: e.target.value }));
              configDirtyRef.current = true;
              localStorage.setItem('aiapidoctor-config-dirty', '1');
              setConsoleVerifyState((prev) =>
                prev.status === 'error' || prev.status === 'permission_denied' || prev.status === 'status_timeout' || prev.status === 'self_timeout'
                  ? { ...prev, status: 'idle', errorCode: undefined, message: undefined }
                  : prev
              );
            }}
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
            onChange={(e) => {
              setConfig((p) => ({ ...p, modelId: e.target.value }));
              configDirtyRef.current = true;
              localStorage.setItem('aiapidoctor-config-dirty', '1');
              setConsoleVerifyState((prev) =>
                prev.status === 'error' || prev.status === 'permission_denied' || prev.status === 'status_timeout' || prev.status === 'self_timeout'
                  ? { ...prev, status: 'idle', errorCode: undefined, message: undefined }
                  : prev
              );
            }}
          />
          <div className="form-hint" style={{ marginTop: '4px', color: '#94a3b8', fontSize: '11px' }}>
            {lang === 'zh-CN' ? t('modelsNeedSaveHint') : t('modelsNeedSaveHintEn')}
          </div>
        </div>

        {/* Interface Type - Simplified */}
        <div className="form-group">
          <div className="form-label-row">
            <span className="form-label">{t('interfaceType')}</span>
          </div>
          <div className="interface-type-options">
            <span className="interface-type-badge active">{t('interfaceTypeOpenAI')}</span>
            <span className="interface-type-badge disabled">{t('interfaceTypeResponses')}</span>
            <span className="interface-type-badge disabled">{t('interfaceTypeClaude')}</span>
          </div>
        </div>

        {/* Detection Options */}
        <div className="form-group">
          <label className="form-label">{t('billingAnomalyDetection')}</label>
          <div className="form-hint" style={{ marginBottom: '12px' }}>
            {t('billingAnomalyDetectionDesc')}
          </div>
          <div className="baseline-option">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includeBaselineTest}
                onChange={(e) => setIncludeBaselineTest(e.target.checked)}
                disabled={running}
              />
              <span className="checkbox-text">
                <span className="checkbox-title">{lang === 'zh-CN' ? '模型联通检测' : 'Model connectivity test'}</span>
                <span className="checkbox-hint">{lang === 'zh-CN' ? '会发送一次极小请求，用于确认 API Key、Base URL 和模型是否可用，可能产生极低成本。' : 'Send a tiny request to verify API Key, Base URL and model are working. May incur minimal cost.'}</span>
              </span>
            </label>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="form-actions">
          <div className="form-action-note">
            {t('detectionNote')}
          </div>
          {running && progress && (
            <div className="diagnosis-progress">
              <div className="diagnosis-progress-bar">
                <div
                  className="diagnosis-progress-fill"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <div className="diagnosis-progress-text">
                {lang === 'zh-CN' ? progress.messageZh : progress.message}
              </div>
            </div>
          )}
          <div className="form-action-buttons">
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
            {billingAnomalyEnabled && config.modelId && (
              <div className="cost-audit-hint">
                {lang === 'zh-CN'
                  ? '扣费异常检测会发送 2 次低成本真实请求，可能消耗少量额度。建议使用测试 Key。'
                  : 'Billing anomaly probes send 2 low-cost real requests and may consume a small amount of credits. Use a test key.'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* DEV Mock Reports - Only visible in development */}
      {import.meta.env.DEV && (
        <div className="dev-mock-section">
          <div className="dev-mock-title">Mock Reports (DEV)</div>
          <div className="dev-mock-buttons">
            <button className="btn btn-ghost btn-sm" onClick={() => handleMockReport('not_found')}>
              Not Found
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => handleMockReport('needs_review')}>
              Needs Review
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => handleMockReport('signal_confirmed')}>
              Signal Confirmed
            </button>
          </div>
        </div>
      )}

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

      {/* Billing Report Card - Simplified New API */}
      {billingReport && (() => {
        const judgment = billingReport.judgment;
        const connectivity = billingReport.modelConnectivityTest;

        // Get billing status config
        const getBillingStatusConfig = () => {
          if (!billingReport.rawQuotaTimeline?.readable) {
            return { label: lang === 'zh-CN' ? '无法读取' : 'Unavailable', color: '#F59E0B' };
          }
          switch (judgment.code) {
            case 'failed_request_not_charged':
            case 'precharge_refunded':
              return { label: lang === 'zh-CN' ? '通过' : 'Passed', color: '#22C55E' };
            case 'raw_quota_unavailable':
              return { label: lang === 'zh-CN' ? '风险' : 'Risk', color: '#F59E0B' };
            case 'failed_request_charged':
            case 'empty_response_charged':
              return { label: lang === 'zh-CN' ? '异常' : 'Anomaly', color: '#EF4444' };
            default:
              return { label: lang === 'zh-CN' ? '通过' : 'Passed', color: '#22C55E' };
          }
        };

        // Get model connectivity status config
        const getConnectivityStatusConfig = () => {
          if (!connectivity || connectivity.status === 'skipped') {
            return { label: lang === 'zh-CN' ? '未检测' : 'Not tested', color: '#94A3B8' };
          }
          switch (connectivity.status) {
            case 'passed':
              return { label: lang === 'zh-CN' ? '通过' : 'Passed', color: '#22C55E' };
            case 'review':
              return { label: lang === 'zh-CN' ? '需复查' : 'Review', color: '#F59E0B' };
            case 'failed':
              return { label: lang === 'zh-CN' ? '失败' : 'Failed', color: '#EF4444' };
            default:
              return { label: lang === 'zh-CN' ? '未检测' : 'Not tested', color: '#94A3B8' };
          }
        };

        const billingStatusConfig = getBillingStatusConfig();
        const connectivityStatusConfig = getConnectivityStatusConfig();
        const delta10 = billingReport.rawQuotaTimeline?.delta10s;
        const deltaColor = delta10 === undefined ? 'var(--muted)' : delta10 === 0 ? '#22C55E' : (judgment.code === 'failed_request_charged' || judgment.code === 'empty_response_charged') ? '#EF4444' : '#22C55E';
        const deltaDisplay = delta10 === undefined ? '—' : `${delta10 >= 0 ? '+' : ''}${delta10}`;

        const handleOpenReportPage = () => {
          if (currentReportId) {
            browser.tabs.create({ url: browser.runtime.getURL(`report.html?reportId=${currentReportId}`) });
          }
        };

        return (
          <>
            <div ref={reportCardRef} className="billing-report-simple">
              {/* Title */}
              <div className="billing-simple-title" style={{ color: billingStatusConfig.color }}>
                {lang === 'zh-CN' ? judgment.titleZh : judgment.title}
              </div>

              {/* Detection Score */}
              <div className="billing-simple-score">
                <span className="billing-simple-score-label">{lang === 'zh-CN' ? '本次检测分' : 'Detection Score'}: </span>
                <span className="billing-simple-score-value">{billingReport.detectionScore ?? '—'}</span>
                <span className="billing-simple-score-max">/100</span>
              </div>

              {/* Two Status Badges */}
              <div className="billing-simple-status-row">
                <div className="billing-simple-status-item">
                  <span className="billing-simple-status-label">{lang === 'zh-CN' ? '扣费完整性' : 'Billing'}: </span>
                  <span className="billing-simple-status-badge" style={{ color: billingStatusConfig.color }}>
                    {billingStatusConfig.label}
                  </span>
                </div>
                <div className="billing-simple-status-item">
                  <span className="billing-simple-status-label">{lang === 'zh-CN' ? '模型联通' : 'Connectivity'}: </span>
                  <span className="billing-simple-status-badge" style={{ color: connectivityStatusConfig.color }}>
                    {connectivityStatusConfig.label}
                  </span>
                </div>
              </div>

              {/* Delta - only show if raw quota is available */}
              {billingReport.rawQuotaTimeline?.readable ? (
                <>
                  <div className="billing-simple-delta">
                    <span className="billing-simple-delta-label">{lang === 'zh-CN' ? '最终变化' : 'Final Delta'}: </span>
                    <span className="billing-simple-delta-value" style={{ color: deltaColor }}>{deltaDisplay}</span>
                  </div>

                  {/* Evidence Chain */}
                  <div className="billing-simple-evidence">
                    <span>{billingReport.rawQuotaTimeline?.before?.rawQuota.toLocaleString() ?? '—'}</span>
                    <span className="billing-simple-arrow">→</span>
                    <span style={{ color: billingReport.invalidModelTest?.httpStatus && billingReport.invalidModelTest.httpStatus >= 400 ? '#EF4444' : '#22C55E' }}>
                      {billingReport.invalidModelTest?.httpStatus ? `HTTP ${billingReport.invalidModelTest.httpStatus}` : '—'}
                    </span>
                    <span className="billing-simple-arrow">→</span>
                    <span>{billingReport.rawQuotaTimeline?.after10s?.rawQuota.toLocaleString() ?? '—'}</span>
                  </div>
                </>
              ) : (
                <div className="billing-simple-unavailable">
                  <div className="billing-simple-unavailable-title">
                    {lang === 'zh-CN' ? '无法读取原始余额' : 'Cannot read raw quota'}
                  </div>
                  <div className="billing-simple-unavailable-reason">
                    {billingReport.rawQuotaTimeline?.error ?
                      (lang === 'zh-CN' ? `原因：${billingReport.rawQuotaTimeline.error}` : `Reason: ${billingReport.rawQuotaTimeline.error}`)
                      : (lang === 'zh-CN' ? '请打开并登录 New API / One API 控制台后重新验证。' : 'Please open and sign in to New API / One API console to retry.')}
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="report-actions">
              <button
                className="report-btn report-btn-primary"
                onClick={handleOpenReportPage}
              >
                {lang === 'zh-CN' ? '打开报告页' : 'Open Report Page'}
              </button>
              <button
                className={`report-btn ${copyState === 'provider' ? 'copied' : ''}`}
                onClick={handleCopyForProvider}
              >
                {copyState === 'provider' ? t('copied') : t('copyForProvider')}
              </button>
              <button
                className={`report-btn ${copyState === 'md' ? 'copied' : ''}`}
                onClick={handleCopyMd}
              >
                {copyState === 'md' ? t('copied') : t('copyMarkdown')}
              </button>
            </div>
          </>
        );
      })()}

      {/* Legacy Report Card V2 */}
      {report && !billingReport && (() => {
        const trustScore = calculateTrustScore(report);
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
                className={`report-btn ${copyState === 'provider' ? 'copied' : ''}`}
                onClick={handleCopyForProvider}
              >
                {copyState === 'provider' ? t('copied') : t('copyForProvider')}
              </button>
              <button
                className={`report-btn ${copyState === 'text' ? 'copied' : ''}`}
                onClick={handleCopyText}
              >
                {copyState === 'text' ? t('copied') : t('copyResultText')}
              </button>
              <button
                className={`report-btn report-btn-save ${saveState === 'saving' || saveState === 'generating' ? 'saving' : saveState === 'saved' ? 'saved' : saveState === 'failed' ? 'failed' : ''}`}
                onClick={handleSaveImage}
                disabled={saveState === 'saving' || saveState === 'generating'}
              >
                {saveState === 'saving' ? t('savingImage') :
                 saveState === 'generating' ? t('generatingImage') :
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
  const [configDirty, setConfigDirty] = useState(false);

  useEffect(() => {
    getActiveConfig().then((c) => {
      setConfig(c);
      const dirty = localStorage.getItem('aiapidoctor-config-dirty') === '1';
      setConfigDirty(dirty);
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

  // Listen for config-saved event and storage changes
  useEffect(() => {
    const onSaved = () => {
      setConfigDirty(false);
      getActiveConfig().then(setConfig);
    };
    window.addEventListener('aiapidoctor-config-saved', onSaved);
    window.addEventListener('storage', (e: StorageEvent) => {
      if (e.key === 'aiapidoctor-config-dirty') {
        setConfigDirty(e.newValue === '1');
      }
    });
    return () => {
      window.removeEventListener('aiapidoctor-config-saved', onSaved);
    };
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

  const loadModels = useCallback(async () => {
    if (!config?.baseUrl || !config?.apiKey) return;
    setLoading(true);
    setError('');
    try {
      const fetched = await fetchModels(config.baseUrl, config.apiKey);
      setModels(fetched);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load models');
    } finally {
      setLoading(false);
    }
  }, [config]);

  if (!config?.baseUrl || !config?.apiKey) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-state-icon"><Globe size={18} /></div>
          <span className="empty-state-title">{t('modelsNeedBaseUrl')}</span>
          <span className="empty-state-hint">{t('modelsNeedBaseUrlEn')}</span>
        </div>
      </div>
    );
  }

  if (configDirty) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-state-icon"><Globe size={18} /></div>
          <span className="empty-state-title">{t('modelsConfigNotSaved')}</span>
          <span className="empty-state-hint">{t('modelsConfigNotSavedEn')}</span>
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

      {/* Config hint banner */}
      <div className="models-hint-banner">
        <Globe size={12} />
        <span>{lang === 'zh-CN' ? '当前使用首页已保存配置拉取模型。' : 'Using saved Home config to fetch models.'}</span>
      </div>

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

      {/* Refresh button */}
      <div className="models-actions">
        <button className="btn btn-secondary btn-sm" onClick={loadModels} disabled={loading}>
          <span>{t('refresh')}</span>
        </button>
      </div>

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

interface ClearDataDialogProps {
  lang: 'zh-CN' | 'en-US';
  onConfirm: () => void;
  onCancel: () => void;
}

function ClearDataDialog({ lang, onConfirm, onCancel }: ClearDataDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-icon"><AlertTriangle size={20} color="#DC2626" /></div>
        <div className="dialog-title">
          {lang === 'zh-CN' ? '确认清除本地信息？' : 'Confirm Clear Local Data?'}
        </div>
        <div className="dialog-desc">
          {lang === 'zh-CN'
            ? '这会删除 AI API Doctor 保存在本浏览器中的 Base URL、API Key、模型 ID、检测报告和缓存状态。不会清除你的中转站账号、余额或浏览器 Cookie。'
            : "This will delete AI API Doctor's Base URL, API Key, model ID, diagnostic reports and cache stored in this browser. It will not clear your relay station account, balance or browser cookies."}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel}>
            {lang === 'zh-CN' ? '取消' : 'Cancel'}
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            {lang === 'zh-CN' ? '确认清除' : 'Confirm Clear'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HelpPage() {
  const { lang, t } = useLang();
  const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [clearSuccess, setClearSuccess] = useState(false);

  const handleClearData = useCallback(async () => {
    await clearAllLocalData();
    setShowClearDialog(false);
    setClearSuccess(true);
    setTimeout(() => setClearSuccess(false), 3000);
  }, []);

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

      {/* Danger Zone */}
      <div className="help-card danger-zone">
        <div className="help-card-title" style={{ color: '#DC2626' }}>
          <AlertTriangle size={11} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          {lang === 'zh-CN' ? '本地数据' : 'Local Data'}
        </div>
        <p className="help-dazard-desc">
          {lang === 'zh-CN'
            ? 'AI API Doctor 的配置、报告和历史记录只保存在当前浏览器本地。清除后不会影响你的 New API / One API 账号、余额、Cookie 或服务商后台数据。'
            : "AI API Doctor's configuration, reports and history are only saved in the current browser's local storage. Clearing will not affect your New API / One API account, balance, cookies, or provider backend data."}
        </p>
        <button className="btn btn-danger-outline" onClick={() => setShowClearDialog(true)}>
          <Trash2 size={11} />
          {lang === 'zh-CN' ? '清除本地信息' : 'Clear Local Data'}
        </button>
      </div>

      {/* Clear success toast */}
      {clearSuccess && (
        <div className="toast toast-success">
          <CheckCircle2 size={14} />
          <span>{lang === 'zh-CN' ? '本地信息已清除' : 'Local data cleared'}</span>
        </div>
      )}

      {/* Clear confirm dialog */}
      {showClearDialog && (
        <ClearDataDialog
          lang={lang}
          onConfirm={handleClearData}
          onCancel={() => setShowClearDialog(false)}
        />
      )}
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
