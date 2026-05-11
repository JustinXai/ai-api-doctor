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

// ─── Generate Report Text ────────────────────────────────

function generateReportText(report: DiagnosisReport, baseUrl: string, lang: 'zh-CN' | 'en-US'): string {
  const lines: string[] = [];
  lines.push(lang === 'zh-CN' ? 'AI API 诊断助手报告' : 'AI API Doctor Report');
  lines.push('\u2500'.repeat(40));
  lines.push(`${lang === 'zh-CN' ? '服务商' : 'Provider'}: ${report.providerName}`);
  lines.push(`${lang === 'zh-CN' ? '接口地址' : 'Base URL'}: ${baseUrl}`);
  lines.push(`${lang === 'zh-CN' ? 'API 密钥' : 'API Key'}: ${report.maskedKey}`);
  if (report.activeModelId) {
    lines.push(`${lang === 'zh-CN' ? '模型' : 'Model'}: ${report.activeModelId}`);
  }
  lines.push(`${lang === 'zh-CN' ? '时间' : 'Time'}: ${report.startedAt}`);
  lines.push('');
  lines.push(lang === 'zh-CN' ? '结果：' : 'Result:');
  lines.push(`  ${report.passedCount} / ${report.totalCount} ${lang === 'zh-CN' ? '项检查通过' : 'checks passed'}`);

  const failedSteps = report.steps.filter((s) => s.status === 'error');
  if (failedSteps.length > 0) {
    lines.push('');
    lines.push(lang === 'zh-CN' ? '失败项目：' : 'Failed Steps:');
    for (const step of failedSteps) {
      lines.push(`  - ${step.title}`);
      if (step.httpStatus) lines.push(`    HTTP Status: ${step.httpStatus}`);
      if (step.providerMessage) lines.push(`    Provider: ${step.providerMessage}`);
      if (step.suggestion) lines.push(`    ${lang === 'zh-CN' ? '建议' : 'Suggestion'}: ${step.suggestion.replace(/\n/g, ' ')}`);
    }
  }

  if (report.usageSummary?.hasUsage) {
    const u = report.usageSummary;
    lines.push('');
    lines.push(lang === 'zh-CN' ? '用量：' : 'Usage:');
    if (u.promptTokens !== undefined) lines.push(`  prompt_tokens: ${u.promptTokens}`);
    if (u.completionTokens !== undefined) lines.push(`  completion_tokens: ${u.completionTokens}`);
    if (u.totalTokens !== undefined) lines.push(`  total_tokens: ${u.totalTokens}`);
    if (report.totalLatencyMs) lines.push(`  latency: ${report.totalLatencyMs}ms`);
  }

  lines.push('');
  lines.push('\u2500'.repeat(40));
  if (lang === 'zh-CN') {
    lines.push('说明：');
    lines.push('本报告仅展示配置和用量数据，无法证明服务商存在故意多扣费行为。');
  } else {
    lines.push('Important:');
    lines.push('This report masks the API Key and does not prove intentional overbilling.');
    lines.push('It only shows configuration and usage signals from this test request.');
  }

  return lines.join('\n');
}

// ─── Home Page ──────────────────────────────────────────

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
  const [reportCopied, setReportCopied] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const activeProvider = await getActiveProvider();
      const activeKey = await getActiveApiKey(activeProvider?.id || '');
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

  const handleCopyReport = useCallback(async () => {
    if (!report || !provider) return;
    const text = generateReportText(report, provider.baseUrl, lang);
    await copyToClipboard(text);
    setReportCopied(true);
    setTimeout(() => setReportCopied(false), 2000);
  }, [report, provider, lang]);

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
          builtIn: t('builtIn'),
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

      {/* Diagnosis Summary */}
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

          {/* Steps + Usage in scrollable area */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0 }}>
            <div className="diag-steps">
              {report.steps.map((step) => (
                <DiagnosisStepRow key={step.id} step={step} />
              ))}
            </div>
            <DiagnosisUsageBlock report={report} />

            {/* Copy Report */}
            <button
              className={`copy-report-btn ${reportCopied ? 'copied' : ''}`}
              onClick={handleCopyReport}
            >
              {reportCopied ? (
                <>
                  <CheckCircle2 size={12} strokeWidth={2} />
                  {t('copied')}
                </>
              ) : (
                <>
                  <Copy size={12} strokeWidth={2} />
                  {t('copyReport')}
                </>
              )}
            </button>
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
