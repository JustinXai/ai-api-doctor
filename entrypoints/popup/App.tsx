/**
 * App.tsx — AI API Doctor MVP
 * Single-page popup with 4 tabs: Home, Models, Export, Help
 */

import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
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
} from '../../src/lib/storage';
import { t, resolveLanguage, Language } from '../../src/lib/i18n';
import type { ActiveConfig, DiagnosisReport } from '../../src/types';

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

// ─── Report Card ──────────────────────────────────────────

function ReportCard({
  report,
  baseUrl,
  lang,
  onCopyMd,
  onCopyIssue,
  onCopyText,
  copyState,
}: {
  report: DiagnosisReport;
  baseUrl: string;
  lang: 'zh-CN' | 'en-US';
  onCopyMd: () => void;
  onCopyIssue: () => void;
  onCopyText: () => void;
  copyState: 'idle' | 'md' | 'issue' | 'text';
}) {
  const { t } = useLang();

  const statusLabel =
    report.overallStatus === 'success' ? t('ready') :
    report.overallStatus === 'warning' ? t('needsAttention') :
    t('failed');
  const statusClass =
    report.overallStatus === 'success' ? 'card-ok' :
    report.overallStatus === 'warning' ? 'card-warn' : 'card-fail';

  const checksLabel = lang === 'zh-CN'
    ? `已通过 ${report.passedCount} / ${report.totalCount} 项`
    : `${report.passedCount} / ${report.totalCount} passed`;

  const firstError = report.steps.find((s) => s.status === 'error');
  const firstWarn = report.steps.find((s) => s.status === 'warning');
  const mainIssue = firstError || firstWarn;
  const mainIssueLabel = mainIssue?.title ||
    (lang === 'zh-CN' ? '未发现主要问题' : 'No major issue found');

  const usageStr = report.usageSummary?.status === 'available' || report.usageSummary?.status === 'anomaly'
    ? `${report.usageSummary.totalTokens} total` +
      (report.usageSummary.promptTokens !== undefined ? ` / ${report.usageSummary.promptTokens} prompt` : '') +
      (report.usageSummary.completionTokens !== undefined ? ` / ${report.usageSummary.completionTokens} completion` : '')
    : report.usageSummary?.status === 'missing'
    ? (lang === 'zh-CN' ? '未返回用量' : 'Not reported')
    : (lang === 'zh-CN' ? '未测试用量' : 'Not tested');

  const tokensPerSec = report.usageSummary?.status === 'available' && report.usageSummary.totalTokens && report.totalLatencyMs
    ? ((report.usageSummary.totalTokens / report.totalLatencyMs) * 1000).toFixed(1)
    : null;

  return (
    <div className="report-card">
      <div className="report-card-head">
        <span className="report-brand">AI API Doctor</span>
        <span className="report-sub">{t('diagnosisResult')}</span>
      </div>
      <div className="report-card-body">
        <div className="report-row">
          <span className="report-label">{t('status')}</span>
          <span className={`report-value ${statusClass}`}>{statusLabel}</span>
        </div>
        <div className="report-row">
          <span className="report-label">{t('checks')}</span>
          <span className="report-value">{checksLabel}</span>
        </div>
        <div className="report-row">
          <span className="report-label">{t('provider')}</span>
          <span className="report-value">{report.providerName}</span>
        </div>
        <div className="report-row">
          <span className="report-label">{t('baseUrl_')}</span>
          <span className="report-value report-mono">{baseUrl}</span>
        </div>
        <div className="report-row">
          <span className="report-label">{t('model')}</span>
          <span className="report-value report-mono">
            {report.activeModelId || (lang === 'zh-CN' ? '未选择' : 'Not selected')}
          </span>
        </div>
        <div className="report-row">
          <span className="report-label">{t('mainIssue')}</span>
          <span className="report-value">{mainIssueLabel}</span>
        </div>
        {mainIssue?.httpStatus && (
          <div className="report-row">
            <span className="report-label">{t('httpStatus')}</span>
            <span className="report-value report-mono">{mainIssue.httpStatus}</span>
          </div>
        )}
        {mainIssue?.providerMessage && (
          <div className="report-row">
            <span className="report-label">{t('providerMessage')}</span>
            <span className="report-value">{mainIssue.providerMessage}</span>
          </div>
        )}
        {mainIssue?.suggestion && (
          <div className="report-row">
            <span className="report-label">{t('suggestion')}</span>
            <span className="report-value">{mainIssue.suggestion.replace(/\n/g, ' ')}</span>
          </div>
        )}
        <div className="report-row">
          <span className="report-label">{t('usage')}</span>
          <span className="report-value report-mono">{usageStr}</span>
        </div>
        {report.totalLatencyMs && (
          <div className="report-row">
            <span className="report-label">{t('latency')}</span>
            <span className="report-value report-mono">{report.totalLatencyMs}ms{tokensPerSec ? ` / ${tokensPerSec} tokens/s` : ''}</span>
          </div>
        )}
      </div>
      <div className="report-card-foot">
        <span className="report-footer">{t('reportFooter')}</span>
        <span className="report-url">{t('reportUrl')}</span>
      </div>
      <div className="report-actions">
        <button className={`report-btn ${copyState === 'md' ? 'copied' : ''}`} onClick={onCopyMd}>
          {copyState === 'md' ? t('copied') : t('copyMarkdown')}
        </button>
        <button className={`report-btn ${copyState === 'issue' ? 'copied' : ''}`} onClick={onCopyIssue}>
          {copyState === 'issue' ? t('copied') : t('copyIssue')}
        </button>
        <button className={`report-btn ${copyState === 'text' ? 'copied' : ''}`} onClick={onCopyText}>
          {copyState === 'text' ? t('copied') : t('copyResultText')}
        </button>
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
  const [showGuide, setShowGuide] = useState(true);
  const [showExample, setShowExample] = useState(false);

  useEffect(() => {
    getActiveConfig().then((c) => {
      if (c) setConfig(c);
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
    const next = { ...config, updatedAt: new Date().toISOString() };
    await saveActiveConfig(next);
    setConfig(next);
  }, [config]);

  const handleRun = useCallback(async () => {
    if (!config.baseUrl || !config.apiKey) return;
    setRunning(true);
    setReport(null);
    try {
      const next = { ...config, updatedAt: new Date().toISOString() };
      await saveActiveConfig(next);
      const rep = await runDiagnosis(next);
      setReport(rep);
      setConfig(next);
    } catch (e) {
      console.error('Diagnosis error:', e);
    } finally {
      setRunning(false);
    }
  }, [config]);

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
  }, [report, config]);

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

      {/* Report Card */}
      {report && (
        <ReportCard
          report={report}
          baseUrl={config.baseUrl}
          lang={lang}
          onCopyMd={handleCopyMd}
          onCopyIssue={handleCopyIssue}
          onCopyText={handleCopyText}
          copyState={copyState}
        />
      )}

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
          {currentPage === 'home' && <HomePage />}
          {currentPage === 'models' && <ModelsPage />}
          {currentPage === 'export' && <ExportPage />}
          {currentPage === 'help' && <HelpPage />}
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
