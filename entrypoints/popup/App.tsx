import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Provider, ApiKey } from '../../src/types';
import {
  getActiveProvider,
  getActiveApiKey,
  getActiveModelId,
  getLanguage,
  setLanguage,
  maskApiKey,
  copyToClipboard,
  addExampleProvider,
} from '../../src/lib/storage';
import { t, resolveLanguage, Language } from '../../src/lib/i18n';
import { runDiagnosis } from '../../src/lib/diagnosis';
import Header from '../../src/components/Header';
import StatusCard from '../../src/components/StatusCard';
import PageRouter, { Page } from '../../src/components/PageRouter';
import ProvidersPage from '../../src/pages/ProvidersPage';
import KeysPage from '../../src/pages/KeysPage';
import ModelsPage from '../../src/pages/ModelsPage';
import ExportPage from '../../src/pages/ExportPage';
import SettingsPage from '../../src/pages/SettingsPage';
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  MinusCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  CheckCircle2,
  Stethoscope,
  Plus,
  ExternalLink,
  Globe,
} from 'lucide-react';
import type { DiagnosisReport, DiagnosisStepResult } from '../../src/types';

// ─── Language Context ─────────────────────────────────────

interface LanguageContextValue {
  lang: 'zh-CN' | 'en-US';
  langSetting: Language;
  setLang: (lang: Language) => void;
  t: (key: Parameters<typeof t>[1]) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en-US',
  langSetting: 'auto',
  setLang: () => {},
  t: (key) => key as string,
});

function useLanguage() {
  return useContext(LanguageContext);
}

// ─── Step Row Component ─────────────────────────────────

function DiagnosisStepRow({ step }: { step: DiagnosisStepResult }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();
  const hasErrorExtra = step.providerMessage || step.suggestion;

  const getIcon = () => {
    switch (step.status) {
      case 'success':
        return <CheckCircle size={9} strokeWidth={2.5} />;
      case 'warning':
        return <AlertCircle size={9} strokeWidth={2.5} />;
      case 'error':
        return <XCircle size={9} strokeWidth={2.5} />;
      case 'skipped':
        return <MinusCircle size={9} strokeWidth={2.5} />;
    }
  };

  return (
    <div className={`diag-step ${step.status}`}>
      <div className="diag-step-icon">{getIcon()}</div>
      <div className="diag-step-body">
        <div className="diag-step-head">
          <span className="diag-step-title">{step.title}</span>
          <div className="diag-step-meta">
            {step.latencyMs !== undefined && (
              <span className="diag-step-latency">{step.latencyMs}ms</span>
            )}
            {hasErrorExtra && (
              <button
                onClick={() => setExpanded((v) => !v)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--muted-light)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '2px',
                  marginLeft: '2px',
                }}
                title={expanded ? t('collapse') : t('expand')}
              >
                {expanded ? (
                  <ChevronUp size={11} strokeWidth={2} />
                ) : (
                  <ChevronDown size={11} strokeWidth={2} />
                )}
              </button>
            )}
          </div>
        </div>
        <span className="diag-step-message">{step.message}</span>
        {expanded && hasErrorExtra && (
          <>
            {step.providerMessage && (
              <span className="diag-step-provider-msg">
                {step.providerMessage}
              </span>
            )}
            {step.suggestion && (
              <div className="diag-step-suggestion">{step.suggestion}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Usage Block ─────────────────────────────────────────

function DiagnosisUsageBlock({ report }: { report: DiagnosisReport }) {
  const { lang, t } = useLanguage();
  const s = report.usageSummary;
  if (!s) return null;

  const tokensPerSec =
    s.hasUsage && s.totalTokens && report.totalLatencyMs
      ? ((s.totalTokens / report.totalLatencyMs) * 1000).toFixed(1)
      : null;

  const badgeLabel = {
    skipped: t('usageSkippedBadge'),
    available: t('usageAvailable'),
    missing: t('usageNotReportedBadge'),
    anomaly: t('usageAnomaly'),
  }[s.status];

  return (
    <div className="diag-usage">
      <div className="diag-usage-head">
        <span className="diag-usage-title">{t('usageAudit')}</span>
        <span className={`diag-usage-badge ${s.status === 'available' ? 'available' : s.status === 'anomaly' ? 'anomaly' : 'missing'}`}>
          {badgeLabel}
        </span>
      </div>
      <div className="diag-usage-body">
        {s.status === 'skipped' && (
          <span className="diag-usage-note">{t('usageSkipped')}</span>
        )}
        {s.status === 'missing' && (
          <span className="diag-usage-note">{t('noUsageInResponse')}</span>
        )}
        {(s.status === 'available' || s.status === 'anomaly') && (
          <>
            <div className="diag-usage-row">
              <span className="diag-usage-label">{t('usagePromptTokens')}</span>
              <span className="diag-usage-value">{s.promptTokens ?? '—'}</span>
            </div>
            <div className="diag-usage-row">
              <span className="diag-usage-label">{t('usageCompletionTokens')}</span>
              <span className="diag-usage-value">{s.completionTokens ?? '—'}</span>
            </div>
            <div className="diag-usage-row">
              <span className="diag-usage-label">{t('usageTotalTokens')}</span>
              <span className={`diag-usage-value ${s.suspicious ? 'anomaly' : ''}`}>
                {s.totalTokens ?? '—'}
              </span>
            </div>
            <div className="diag-usage-row">
              <span className="diag-usage-label">{t('usageLatency')}</span>
              <span className="diag-usage-value">{report.totalLatencyMs}ms</span>
            </div>
            {tokensPerSec && (
              <div className="diag-usage-row">
                <span className="diag-usage-label">{t('usageTokensPerSec')}</span>
                <span className="diag-usage-value">{tokensPerSec}</span>
              </div>
            )}
          </>
        )}
        {s.status === 'anomaly' && s.note && (
          <span className="diag-usage-note">{s.note}</span>
        )}
        {s.status === 'available' && (
          <span className="diag-usage-disclaimer">{t('usageAuditDisclaimer')}</span>
        )}
      </div>
    </div>
  );
}

// ─── Generate Markdown Report Text ───────────────────────────

function generateMarkdownReport(
  report: DiagnosisReport,
  baseUrl: string,
  lang: 'zh-CN' | 'en-US'
): string {
  const lines: string[] = [];
  lines.push(`# ${lang === 'zh-CN' ? 'AI API Doctor 诊断报告' : 'AI API Doctor Report'}`);
  lines.push('');

  const statusLabel = report.overallStatus === 'success'
    ? (lang === 'zh-CN' ? '可用' : 'Ready')
    : report.overallStatus === 'warning'
    ? (lang === 'zh-CN' ? '需要注意' : 'Needs Attention')
    : (lang === 'zh-CN' ? '失败' : 'Failed');

  lines.push(`**${lang === 'zh-CN' ? '状态' : 'Status'}:** ${statusLabel}`);
  lines.push(`**${lang === 'zh-CN' ? '已通过' : 'Checks'}:** ${report.passedCount} / ${report.totalCount} ${lang === 'zh-CN' ? '项' : 'passed'}`);
  lines.push('');
  lines.push(`| | |`);
  lines.push(`|---|---|---|`);
  lines.push(`| **${lang === 'zh-CN' ? '服务商' : 'Provider'}** | ${report.providerName} |`);
  lines.push(`| **${lang === 'zh-CN' ? '接口地址' : 'Base URL'}** | ${baseUrl} |`);
  lines.push(`| **${lang === 'zh-CN' ? 'API 密钥' : 'API Key'}** | \`${report.maskedKey}\` |`);
  if (report.activeModelId) {
    lines.push(`| **${lang === 'zh-CN' ? '模型' : 'Model'}** | \`${report.activeModelId}\` |`);
  }
  lines.push('');

  const firstError = report.steps.find((s) => s.status === 'error');
  const firstWarning = report.steps.find((s) => s.status === 'warning');
  const mainIssue = firstError || firstWarning;
  if (mainIssue) {
    lines.push(`**${lang === 'zh-CN' ? '主要问题' : 'Main Issue'}:**`);
    lines.push(`- ${mainIssue.title}`);
    if (mainIssue.httpStatus) {
      lines.push(`- **${lang === 'zh-CN' ? 'HTTP 状态码' : 'HTTP Status'}:** ${mainIssue.httpStatus}`);
    }
    if (mainIssue.providerMessage) {
      lines.push(`- **${lang === 'zh-CN' ? '服务商返回' : 'Provider Message'}:** ${mainIssue.providerMessage}`);
    }
    if (mainIssue.suggestion) {
      lines.push(`- **${lang === 'zh-CN' ? '建议' : 'Suggestion'}:** ${mainIssue.suggestion.replace(/\n/g, ' ')}`);
    }
    lines.push('');
  }

  if (report.usageSummary) {
    lines.push(`**${lang === 'zh-CN' ? '用量' : 'Usage'}:**`);
    if (report.usageSummary.status === 'available' || report.usageSummary.status === 'anomaly') {
      if (report.usageSummary.totalTokens !== undefined) {
        lines.push(`- \`total_tokens: ${report.usageSummary.totalTokens}\``);
      }
      if (report.usageSummary.promptTokens !== undefined) {
        lines.push(`- \`prompt_tokens: ${report.usageSummary.promptTokens}\``);
      }
      if (report.usageSummary.completionTokens !== undefined) {
        lines.push(`- \`completion_tokens: ${report.usageSummary.completionTokens}\``);
      }
    } else if (report.usageSummary.status === 'missing') {
      lines.push(`- ${lang === 'zh-CN' ? '未返回用量数据' : 'No usage data returned.'}`);
    } else {
      lines.push(`- ${lang === 'zh-CN' ? '未测试用量' : 'Usage not tested.'}`);
    }
    lines.push('');
  }

  lines.push(`---`);
  lines.push(`*${lang === 'zh-CN' ? 'API Key 已脱敏，不包含完整 Key。' : 'API Key is masked. No full key is included.'}*`);
  lines.push(`*Generated by AI API Doctor · aiapidoctor.com*`);

  return lines.join('\n');
}

// ─── Generate GitHub Issue Text ──────────────────────────────

function generateGhIssueReport(
  report: DiagnosisReport,
  baseUrl: string,
  lang: 'zh-CN' | 'en-US'
): string {
  const lines: string[] = [];

  if (lang === 'zh-CN') {
    lines.push('## API 诊断问题');
    lines.push('');
    lines.push('### 摘要');
    lines.push('AI API Doctor 发现了配置、权限或用量返回问题。');
    lines.push('');
    lines.push('### 环境');
    lines.push(`- 服务商：${report.providerName}`);
    lines.push(`- Base URL：${baseUrl}`);
    if (report.activeModelId) lines.push(`- 模型：${report.activeModelId}`);
    lines.push(`- 时间：${new Date(report.startedAt).toLocaleString('zh-CN')}`);
    lines.push('');
    lines.push('### 结果');
    const statusLabel = report.overallStatus === 'success' ? '可用' : report.overallStatus === 'warning' ? '需要注意' : '失败';
    lines.push(`- 状态：${statusLabel}`);
    lines.push(`- 通过项：${report.passedCount} / ${report.totalCount}`);
    lines.push('');

    const firstError = report.steps.find((s) => s.status === 'error');
    const firstWarning = report.steps.find((s) => s.status === 'warning');
    const mainIssue = firstError || firstWarning;
    if (mainIssue) {
      lines.push('### 失败步骤');
      lines.push(`- 步骤：${mainIssue.title}`);
      if (mainIssue.httpStatus) lines.push(`- HTTP 状态码：${mainIssue.httpStatus}`);
      if (mainIssue.providerMessage) lines.push(`- 服务商返回信息：${mainIssue.providerMessage}`);
      if (mainIssue.suggestion) lines.push(`- 建议：${mainIssue.suggestion.replace(/\n/g, ' ')}`);
      lines.push('');
    }

    if (report.usageSummary) {
      lines.push('### 用量');
      if (report.usageSummary.status === 'available' || report.usageSummary.status === 'anomaly') {
        if (report.usageSummary.promptTokens !== undefined) lines.push(`- prompt_tokens：${report.usageSummary.promptTokens}`);
        if (report.usageSummary.completionTokens !== undefined) lines.push(`- completion_tokens：${report.usageSummary.completionTokens}`);
        if (report.usageSummary.totalTokens !== undefined) lines.push(`- total_tokens：${report.usageSummary.totalTokens}`);
        lines.push(`- 用量状态：${report.usageSummary.suspicious ? '数据异常' : '正常'}`);
      } else if (report.usageSummary.status === 'missing') {
        lines.push('- 用量状态：未返回数据');
      } else {
        lines.push('- 用量状态：未测试');
      }
      lines.push('');
    }

    lines.push('### 安全说明');
    lines.push('API Key 已脱敏，不包含完整 Key。');
  } else {
    lines.push('## API Diagnosis Issue');
    lines.push('');
    lines.push('### Summary');
    lines.push('AI API Doctor found a configuration or permission issue.');
    lines.push('');
    lines.push('### Environment');
    lines.push(`- Provider: ${report.providerName}`);
    lines.push(`- Base URL: ${baseUrl}`);
    if (report.activeModelId) lines.push(`- Model: ${report.activeModelId}`);
    lines.push(`- Time: ${new Date(report.startedAt).toLocaleString('en-US')}`);
    lines.push('');
    lines.push('### Result');
    const statusLabel = report.overallStatus === 'success' ? 'Ready' : report.overallStatus === 'warning' ? 'Needs Attention' : 'Failed';
    lines.push(`- Status: ${statusLabel}`);
    lines.push(`- Checks: ${report.passedCount} / ${report.totalCount} passed`);
    lines.push('');

    const firstError = report.steps.find((s) => s.status === 'error');
    const firstWarning = report.steps.find((s) => s.status === 'warning');
    const mainIssue = firstError || firstWarning;
    if (mainIssue) {
      lines.push('### Failed Step');
      lines.push(`- Step: ${mainIssue.title}`);
      if (mainIssue.httpStatus) lines.push(`- HTTP Status: ${mainIssue.httpStatus}`);
      if (mainIssue.providerMessage) lines.push(`- Provider Message: ${mainIssue.providerMessage}`);
      if (mainIssue.suggestion) lines.push(`- Suggestion: ${mainIssue.suggestion.replace(/\n/g, ' ')}`);
      lines.push('');
    }

    if (report.usageSummary) {
      lines.push('### Usage');
      if (report.usageSummary.status === 'available' || report.usageSummary.status === 'anomaly') {
        if (report.usageSummary.promptTokens !== undefined) lines.push(`- prompt_tokens: ${report.usageSummary.promptTokens}`);
        if (report.usageSummary.completionTokens !== undefined) lines.push(`- completion_tokens: ${report.usageSummary.completionTokens}`);
        if (report.usageSummary.totalTokens !== undefined) lines.push(`- total_tokens: ${report.usageSummary.totalTokens}`);
        lines.push(`- usage_status: ${report.usageSummary.suspicious ? 'Anomaly' : 'Normal'}`);
      } else if (report.usageSummary.status === 'missing') {
        lines.push('- usage_status: No data returned');
      } else {
        lines.push('- usage_status: Not tested');
      }
      lines.push('');
    }

    lines.push('### Safety');
    lines.push('The API Key is masked. No full key is included.');
  }

  lines.push('');
  lines.push(`*Generated by AI API Doctor · aiapidoctor.com*`);
  return lines.join('\n');
}

// ─── Shareable Result Card ─────────────────────────────────

function ShareableCard({
  report,
  provider,
  lang,
  onCopyMd,
  onCopyGh,
  copyState,
}: {
  report: DiagnosisReport;
  provider: Provider | null;
  lang: 'zh-CN' | 'en-US';
  onCopyMd: () => void;
  onCopyGh: () => void;
  copyState: 'idle' | 'md' | 'gh';
}) {
  const { t } = useLanguage();
  const statusLabel = report.overallStatus === 'success'
    ? (lang === 'zh-CN' ? '可用' : 'Ready')
    : report.overallStatus === 'warning'
    ? (lang === 'zh-CN' ? '需要处理' : 'Needs Attention')
    : (lang === 'zh-CN' ? '失败' : 'Failed');
  const statusClass = report.overallStatus === 'success' ? 'card-status-ok' : report.overallStatus === 'warning' ? 'card-status-warn' : 'card-status-fail';

  const firstError = report.steps.find((s) => s.status === 'error');
  const firstWarning = report.steps.find((s) => s.status === 'warning');
  const mainIssue = firstError || firstWarning;
  const mainIssueTitle = mainIssue?.title || (lang === 'zh-CN' ? '未发现主要问题' : 'No major issue found');

  const usageLines: string[] = [];
  if (report.usageSummary?.status === 'available' || report.usageSummary?.status === 'anomaly') {
    const u = report.usageSummary;
    if (u.totalTokens !== undefined) usageLines.push(`total: ${u.totalTokens}`);
    if (u.promptTokens !== undefined) usageLines.push(`prompt: ${u.promptTokens}`);
    if (u.completionTokens !== undefined) usageLines.push(`completion: ${u.completionTokens}`);
  } else if (report.usageSummary?.status === 'missing') {
    usageLines.push(lang === 'zh-CN' ? '未返回用量' : 'Not reported');
  } else {
    usageLines.push(lang === 'zh-CN' ? '未测试用量' : 'Not tested');
  }

  return (
    <div className="shareable-card">
      <div className="shareable-card-head">
        <span className="shareable-brand">AI API Doctor</span>
        <span className="shareable-subbrand">Diagnosis Result / 诊断结果</span>
      </div>
      <div className="shareable-card-body">
        <div className="shareable-row">
          <span className="shareable-label">{t('cardStatus')}</span>
          <span className={`shareable-value ${statusClass}`}>{statusLabel}</span>
        </div>
        <div className="shareable-row">
          <span className="shareable-label">{t('cardChecks')}</span>
          <span className="shareable-value">
            {report.passedCount} / {report.totalCount} {lang === 'zh-CN' ? '通过' : 'passed'}
          </span>
        </div>
        <div className="shareable-row">
          <span className="shareable-label">{t('cardProvider')}</span>
          <span className="shareable-value">{report.providerName}</span>
        </div>
        <div className="shareable-row">
          <span className="shareable-label">{t('cardBaseUrl')}</span>
          <span className="shareable-value shareable-mono">{provider?.baseUrl || 'N/A'}</span>
        </div>
        <div className="shareable-row">
          <span className="shareable-label">{t('cardModel')}</span>
          <span className="shareable-value shareable-mono">
            {report.activeModelId || (lang === 'zh-CN' ? '未选择' : 'Not selected')}
          </span>
        </div>
        <div className="shareable-row">
          <span className="shareable-label">{t('cardMainIssue')}</span>
          <span className="shareable-value">{mainIssueTitle}</span>
        </div>
        {mainIssue?.httpStatus && (
          <div className="shareable-row">
            <span className="shareable-label">{t('cardHttpStatus')}</span>
            <span className="shareable-value shareable-mono">{mainIssue.httpStatus}</span>
          </div>
        )}
        {mainIssue?.providerMessage && (
          <div className="shareable-row">
            <span className="shareable-label">{t('cardProviderMsg')}</span>
            <span className="shareable-value">{mainIssue.providerMessage}</span>
          </div>
        )}
        {mainIssue?.suggestion && (
          <div className="shareable-row">
            <span className="shareable-label">{t('cardSuggestion')}</span>
            <span className="shareable-value">{mainIssue.suggestion.replace(/\n/g, ' ')}</span>
          </div>
        )}
        <div className="shareable-row">
          <span className="shareable-label">{t('cardUsage')}</span>
          <span className="shareable-value shareable-mono">{usageLines.join(' / ')}</span>
        </div>
      </div>
      <div className="shareable-card-foot">
        <span className="shareable-footer">{t('cardFooter')}</span>
        <span className="shareable-url">{t('cardUrl')}</span>
      </div>
      <div className="shareable-actions">
        <button
          className={`shareable-btn ${copyState === 'md' ? 'copied' : ''}`}
          onClick={onCopyMd}
        >
          {copyState === 'md' ? t('copied') : t('copyMarkdown')}
        </button>
        <button
          className={`shareable-btn ${copyState === 'gh' ? 'copied' : ''}`}
          onClick={onCopyGh}
        >
          {copyState === 'gh' ? t('copied') : t('copyGhIssue')}
        </button>
      </div>
    </div>
  );
}

// ─── Home Page ──────────────────────────────────────────

function shouldShowExamplePrompt(report: DiagnosisReport | null, hasProvider: boolean, hasKey: boolean): boolean {
  if (hasProvider && hasKey && report) {
    const firstError = report.steps.find((s) => s.status === 'error');
    if (firstError) {
      const code = firstError.errorType;
      return !!(code === 'NETWORK_ERROR' || code === 'NON_JSON_RESPONSE' ||
        code === 'HTTP_404' || code === 'HTML_RESPONSE' || code === 'CLOUDFLARE_BLOCK' ||
        code === 'LOGIN_PAGE' || code === 'HOST_UNREACHABLE' || code === 'SSL_ERROR' ||
        code === 'CORS_ERROR');
    }
  }
  return !hasProvider || !hasKey;
}

interface HomePageProps {
  onNavigate: (page: Page) => void;
  activeModelId: string;
}

const HomePage: React.FC<HomePageProps> = ({ onNavigate, activeModelId }) => {
  const { lang, t } = useLanguage();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [apiKey, setApiKey] = useState<ApiKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'md' | 'gh'>('idle');
  const [exampleAdded, setExampleAdded] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const activeProvider = await getActiveProvider();
      const activeKey = activeProvider ? await getActiveApiKey(activeProvider.id) : null;
      setProvider(activeProvider);
      setApiKey(activeKey);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRunDiagnosis = useCallback(async () => {
    if (!provider || !apiKey) return;
    setRunning(true);
    setReport(null);
    try {
      const rep = await runDiagnosis(provider, apiKey, activeModelId || undefined);
      setReport(rep);
    } catch (error) {
      console.error('Diagnosis error:', error);
    } finally {
      setRunning(false);
    }
  }, [provider, apiKey, activeModelId]);

  const handleCopyMarkdown = useCallback(async () => {
    if (!report || !provider) return;
    try {
      const text = generateMarkdownReport(report, provider.baseUrl, lang);
      await copyToClipboard(text);
      setCopyState('md');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch { /* ignore */ }
  }, [report, provider, lang]);

  const handleCopyGhIssue = useCallback(async () => {
    if (!report || !provider) return;
    try {
      const text = generateGhIssueReport(report, provider.baseUrl, lang);
      await copyToClipboard(text);
      setCopyState('gh');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch { /* ignore */ }
  }, [report, provider, lang]);

  const handleAddExample = useCallback(async () => {
    await addExampleProvider();
    setExampleAdded(true);
  }, []);

  const hasProvider = !!provider;
  const hasKey = !!apiKey;
  const showExamplePrompt = shouldShowExamplePrompt(report, hasProvider, hasKey) && !exampleAdded;

  const getOverallStatusLabel = () => {
    switch (report?.overallStatus) {
      case 'success': return t('ready');
      case 'warning': return t('needsAttention');
      case 'error': return t('failed');
      case 'skipped': return t('incomplete');
      default: return t('notTested');
    }
  };

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <span className="page-loading-text">{t('loading')}</span>
      </div>
    );
  }

  // ── No Provider at all ──────────────────────────────
  if (!hasProvider) {
    return (
      <div className="home-page">
        <div className="empty-state">
          <div className="empty-state-icon">
            <Globe size={18} strokeWidth={1.5} />
          </div>
          <span className="empty-state-title">{t('emptyNoProvider')}</span>
          <span className="empty-state-hint">{t('emptyNoProviderHint')}</span>
          <div className="empty-state-actions">
            <button className="btn btn-primary" onClick={() => onNavigate('providers')}>
              <Plus size={11} strokeWidth={2} />
              {t('addProvider')}
            </button>
            <button className="btn btn-secondary" onClick={() => onNavigate('settings')}>
              <ExternalLink size={11} strokeWidth={2} />
              {t('viewGuide')}
            </button>
          </div>
        </div>

        {showExamplePrompt && (
          <div className="example-prompt">
            <div className="example-prompt-head">
              <span className="example-prompt-title">{t('needRefEnv')}</span>
            </div>
            <div className="example-prompt-body">
              <p className="example-prompt-desc">{t('needRefEnvHint')}</p>
              <button className="example-prompt-btn" onClick={handleAddExample}>
                <Plus size={11} strokeWidth={2} />
                {t('addExampleProvider')}
              </button>
              <p className="example-prompt-footnote">{t('exampleProviderBy')}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="home-page">
      <StatusCard
        provider={provider}
        apiKey={apiKey}
        maskedKey={apiKey ? maskApiKey(apiKey.key) : null}
        activeModelId={activeModelId || null}
        labels={{
          notConfigured: t('notConfigured'),
          provider: t('provider'),
          baseUrl: t('baseUrl'),
          apiKey: t('apiKey'),
          notSet: t('notSet'),
          activeModel: t('activeModel'),
          noModelSelected: t('noModelSelected'),
          exampleTag: t('exampleTag'),
        }}
      />

      {/* Run Diagnosis Button */}
      <button
        className="btn-primary-action"
        onClick={handleRunDiagnosis}
        disabled={running || !provider || !apiKey}
      >
        {running ? (
          <>
            <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', borderTopColor: '#fff' }} />
            {t('runningDiagnosis')}
          </>
        ) : (
          <>
            <Stethoscope size={14} strokeWidth={2} />
            {t('runDiagnosis')}
          </>
        )}
      </button>

      {/* Example Provider Prompt */}
      {showExamplePrompt && (
        <div className="example-prompt">
          <div className="example-prompt-head">
            <span className="example-prompt-title">{t('needRefEnv')}</span>
          </div>
          <div className="example-prompt-body">
            <p className="example-prompt-desc">{t('needRefEnvHint')}</p>
            <button className="example-prompt-btn" onClick={handleAddExample}>
              <Plus size={11} strokeWidth={2} />
              {t('addExampleProvider')}
            </button>
            <p className="example-prompt-footnote">{t('exampleProviderBy')}</p>
          </div>
        </div>
      )}

      {/* Diagnosis Summary + Steps */}
      {report ? (
        <>
          <div className="diag-summary">
            <div className="diag-summary-left">
              <span className="diag-summary-count">
                <strong>{report.passedCount}</strong> / {report.totalCount} {t('passed')}
              </span>
              {report.totalLatencyMs !== undefined && (
                <span className="diag-summary-total">{report.totalLatencyMs}ms</span>
              )}
            </div>
            <span className={`diag-summary-status ${report.overallStatus}`}>
              {report.overallStatus === 'success' && <CheckCircle size={10} strokeWidth={2.5} />}
              {report.overallStatus === 'warning' && <AlertCircle size={10} strokeWidth={2.5} />}
              {report.overallStatus === 'error' && <XCircle size={10} strokeWidth={2.5} />}
              {report.overallStatus === 'skipped' && <MinusCircle size={10} strokeWidth={2.5} />}
              {getOverallStatusLabel()}
            </span>
          </div>

          {/* Shareable Result Card */}
          <ShareableCard
            report={report}
            provider={provider}
            lang={lang}
            onCopyMd={handleCopyMarkdown}
            onCopyGh={handleCopyGhIssue}
            copyState={copyState}
          />

          {/* Steps + Usage in scrollable area */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0 }}>
            <div className="diag-steps">
              {report.steps.map((step) => (
                <DiagnosisStepRow key={step.id} step={step} />
              ))}
            </div>
            <DiagnosisUsageBlock report={report} />
          </div>
        </>
      ) : (
        /* Quick Nav when no report */
        <div className="action-secondary-btns">
          <button className="action-btn" onClick={() => onNavigate('models')}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.6 }}>
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
            </svg>
            {t('models')}
          </button>
          <button className="action-btn" onClick={() => onNavigate('export')}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.6 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {t('export')}
          </button>
          <button className="action-btn" onClick={() => onNavigate('providers')}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.6 }}>
              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
            </svg>
            {t('providers')}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── App ─────────────────────────────────────────────────

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [activeModelId, setActiveModelId] = useState<string>('');
  const [langSetting, setLangSetting] = useState<Language>('auto');
  const [lang, setLang] = useState<'zh-CN' | 'en-US'>('en-US');

  // Load language preference from storage
  useEffect(() => {
    getLanguage().then((l) => {
      setLangSetting(l);
      setLang(resolveLanguage(l));
    });
    getActiveModelId().then((id) => {
      setActiveModelId(id);
    });
  }, []);

  const handleSetLang = useCallback(async (l: Language) => {
    setLangSetting(l);
    setLang(resolveLanguage(l));
    await setLanguage(l);
  }, []);

  const handleModelChange = useCallback((modelId: string) => {
    setActiveModelId(modelId);
  }, []);

  const langCtx: LanguageContextValue = {
    lang,
    langSetting,
    setLang: handleSetLang,
    t: (key) => t(lang, key),
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage onNavigate={setCurrentPage} activeModelId={activeModelId} />;
      case 'providers':
        return <ProvidersPage />;
      case 'keys':
        return <KeysPage />;
      case 'models':
        return <ModelsPage activeModelId={activeModelId} onModelChange={handleModelChange} />;
      case 'export':
        return <ExportPage />;
      case 'settings':
        return <SettingsPage lang={lang} langSetting={langSetting} onLangChange={handleSetLang} activeModelId={activeModelId} onModelChange={handleModelChange} />;
      default:
        return <HomePage onNavigate={setCurrentPage} activeModelId={activeModelId} />;
    }
  };

  return (
    <LanguageContext.Provider value={langCtx}>
      <div className="app">
        <Header />
        <main className="main-content">{renderPage()}</main>
        <PageRouter currentPage={currentPage} onNavigate={setCurrentPage} />
      </div>
    </LanguageContext.Provider>
  );
};

export default App;
