import React, { useEffect, useState, useCallback, useRef } from 'react';
import { toPng, toBlob } from 'html-to-image';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { BillingDiagnosisReport } from '../../src/types';

// Language
type Lang = 'zh-CN' | 'en-US';
const resolveLanguage = (): Lang => {
  const stored = localStorage.getItem('aiapidoctor-lang');
  if (stored === 'zh-CN' || stored === 'en-US') return stored;
  const browserLang = navigator.language;
  return browserLang.startsWith('zh') ? 'zh-CN' : 'en-US';
};

// Storage functions
async function getStoredReports(): Promise<Record<string, BillingDiagnosisReport>> {
  return new Promise((resolve) => {
    chrome.storage.local.get('billingReports', (result) => {
      resolve(result.billingReports || {});
    });
  });
}

// Colors
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

interface ReportPageProps {
  report: BillingDiagnosisReport;
  lang: Lang;
}

function ReportPage({ report, lang }: ReportPageProps) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    timeline: false,
    request: false,
    rules: false,
    suggestion: false,
  });

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getStatusConfig = () => {
    const judgment = report.judgment;
    switch (judgment.code) {
      case 'failed_request_not_charged':
      case 'precharge_refunded':
        return { label: lang === 'zh-CN' ? '正常' : 'OK', labelColor: colors.green, bgColor: '#DCFCE7', icon: '✓' };
      case 'raw_quota_unavailable':
        return { label: lang === 'zh-CN' ? '风险' : 'RISK', labelColor: colors.orange, bgColor: '#FEF3C7', icon: '⚠' };
      case 'failed_request_charged':
      case 'empty_response_charged':
        return { label: lang === 'zh-CN' ? '异常' : 'ANOMALY', labelColor: colors.red, bgColor: '#FEE2E2', icon: '✕' };
      default:
        return { label: lang === 'zh-CN' ? '完成' : 'DONE', labelColor: colors.blue, bgColor: '#DBEAFE', icon: 'ℹ' };
    }
  };

  const getBillingStatusLabel = () => {
    if (!report.rawQuotaTimeline?.readable) {
      return { label: lang === 'zh-CN' ? '无法读取' : 'Unavailable', color: colors.orange };
    }
    switch (report.judgment.code) {
      case 'failed_request_not_charged':
      case 'precharge_refunded':
        return { label: lang === 'zh-CN' ? '通过' : 'Passed', color: colors.green };
      case 'raw_quota_unavailable':
        return { label: lang === 'zh-CN' ? '风险' : 'Risk', color: colors.orange };
      case 'failed_request_charged':
      case 'empty_response_charged':
        return { label: lang === 'zh-CN' ? '异常' : 'Anomaly', color: colors.red };
      default:
        return { label: lang === 'zh-CN' ? '通过' : 'Passed', color: colors.green };
    }
  };

  const getConnectivityStatusLabel = () => {
    const conn = report.modelConnectivityTest;
    if (!conn || conn.status === 'skipped') {
      return { label: lang === 'zh-CN' ? '未检测' : 'Not tested', color: colors.muted };
    }
    switch (conn.status) {
      case 'passed': return { label: lang === 'zh-CN' ? '通过' : 'Passed', color: colors.green };
      case 'review': return { label: lang === 'zh-CN' ? '需复查' : 'Review', color: colors.orange };
      case 'failed': return { label: lang === 'zh-CN' ? '失败' : 'Failed', color: colors.red };
      default: return { label: lang === 'zh-CN' ? '未检测' : 'Not tested', color: colors.muted };
    }
  };

  const statusConfig = getStatusConfig();
  const billingStatusConfig = getBillingStatusLabel();
  const connectivityStatusConfig = getConnectivityStatusLabel();
  const timeline = report.rawQuotaTimeline;
  const delta10 = timeline?.delta10s;
  const deltaColor = delta10 === undefined ? colors.muted : delta10 === 0 ? colors.green : (report.judgment.code === 'failed_request_charged' || report.judgment.code === 'empty_response_charged') ? colors.red : colors.green;
  const deltaDisplay = delta10 === undefined ? '—' : `${delta10 >= 0 ? '+' : ''}${delta10}`;
  const usdDisplay = timeline?.before && delta10 !== undefined ? `$${(delta10 / timeline.before.quotaPerUnit).toFixed(6)}` : '—';

  const handleSaveImage = useCallback(async () => {
    const targetRef = summaryRef.current;
    if (!targetRef) {
      setSaveState('failed');
      setSaveMessage(lang === 'zh-CN' ? '图片生成失败：报告节点不存在。' : 'Image generation failed: report node not found.');
      setTimeout(() => setSaveState('idle'), 4000);
      return;
    }

    setSaveState('saving');
    setSaveMessage(lang === 'zh-CN' ? '正在生成图片...' : 'Generating image...');

    try {
      await new Promise(requestAnimationFrame);
      await new Promise(resolve => setTimeout(resolve, 120));
      await document.fonts?.ready?.catch(() => undefined);

      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      const filename = `aiapidoctor-report-${timestamp}.png`;

      let dataUrl: string | null = null;

      try {
        dataUrl = await toPng(targetRef, {
          pixelRatio: 2,
          cacheBust: true,
          backgroundColor: '#F8FAFC',
        });
      } catch {
        try {
          dataUrl = await toPng(targetRef, {
            pixelRatio: 1,
            cacheBust: true,
            backgroundColor: '#F8FAFC',
          });
        } catch {
          try {
            const blob = await toBlob(targetRef, {
              pixelRatio: 2,
              cacheBust: true,
              backgroundColor: '#F8FAFC',
            });
            if (blob) {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = filename;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 10000);
              setSaveState('saved');
              setSaveMessage(lang === 'zh-CN' ? '已保存' : 'Saved');
              setTimeout(() => setSaveState('idle'), 2000);
              return;
            }
          } catch {
            // Fall through to error
          }
        }
      }

      if (!dataUrl) throw new Error('All image generation methods failed');

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.click();

      setSaveState('saved');
      setSaveMessage(lang === 'zh-CN' ? '已保存' : 'Saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (err) {
      setSaveState('failed');
      setSaveMessage(
        lang === 'zh-CN'
          ? '图片生成失败，请使用浏览器截图或复制报告文本。'
          : 'Image generation failed. Please use browser screenshot or copy report text.'
      );
      setTimeout(() => setSaveState('idle'), 5000);
      console.error('Save image error:', err instanceof Error ? err.message : 'Unknown error');
    }
  }, [lang]);

  const getSaveBtnLabel = () => {
    switch (saveState) {
      case 'saving': return lang === 'zh-CN' ? '正在生成...' : 'Generating...';
      case 'saved': return lang === 'zh-CN' ? '已保存' : 'Saved';
      case 'failed': return lang === 'zh-CN' ? '保存失败' : 'Failed';
      default: return lang === 'zh-CN' ? '保存摘要图' : 'Save Summary';
    }
  };

  return (
    <div className="report-page">
      {/* Toolbar */}
      <div className="report-toolbar">
        <button
          className={`save-btn ${saveState === 'saving' ? 'saving' : saveState === 'saved' ? 'saved' : saveState === 'failed' ? 'failed' : ''}`}
          onClick={handleSaveImage}
          disabled={saveState === 'saving'}
        >
          {getSaveBtnLabel()}
        </button>
        {saveState === 'failed' && (
          <div className="save-msg save-msg-fail">
            {lang === 'zh-CN' ? '图片生成失败，请使用浏览器截图或复制报告文本。' : 'Image generation failed. Please use browser screenshot or copy report text.'}
          </div>
        )}
        {saveState === 'saving' && saveMessage && (
          <div className="save-msg save-msg-info">{saveMessage}</div>
        )}
      </div>

      {/* ── Export summary (captured by toPng) ── */}
      <div ref={summaryRef} className="billing-report-receipt billing-report-summary">
        <div className="report-header" style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>AI API Doctor</div>
              <div style={{ fontSize: '14px', color: '#64748b', marginTop: '4px' }}>{lang === 'zh-CN' ? '扣费异常检测报告' : 'Billing Anomaly Report'}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '12px', color: '#94a3b8' }}>
              <div>{lang === 'zh-CN' ? 'API Key 已脱敏' : 'API Key Masked'}</div>
              <div>{lang === 'zh-CN' ? '本地检测' : 'Local Report'}</div>
            </div>
          </div>
        </div>

        <div className="verdict-hero" style={{ background: statusConfig.bgColor }}>
          <div className="verdict-icon" style={{ background: statusConfig.labelColor }}>{statusConfig.icon}</div>
          <div className="verdict-label" style={{ color: statusConfig.labelColor }}>{statusConfig.label}</div>
          <div className="verdict-title">{lang === 'zh-CN' ? report.judgment.titleZh : report.judgment.title}</div>
          <div className="verdict-subtitle">{lang === 'zh-CN' ? report.judgment.detailZh : report.judgment.detail}</div>
          <div className="detection-score" style={{ marginTop: '16px' }}>
            <span className="score-label">{lang === 'zh-CN' ? '本次检测分' : 'Detection Score'}: </span>
            <span className="score-value">{report.detectionScore ?? '—'}</span>
            <span className="score-max">/100</span>
          </div>
          <div className="status-badges" style={{ marginTop: '12px', display: 'flex', gap: '16px', justifyContent: 'center' }}>
            <div className="status-badge-item">
              <span className="badge-label">{lang === 'zh-CN' ? '扣费完整性' : 'Billing'}: </span>
              <span className="badge-value" style={{ color: billingStatusConfig.color, fontWeight: 600 }}>{billingStatusConfig.label}</span>
            </div>
            <div className="status-badge-item">
              <span className="badge-label">{lang === 'zh-CN' ? '模型联通' : 'Connectivity'}: </span>
              <span className="badge-value" style={{ color: connectivityStatusConfig.color, fontWeight: 600 }}>{connectivityStatusConfig.label}</span>
            </div>
          </div>
        </div>

        <div className="delta-section">
          <div className="delta-main"><div className="delta-label">{lang === 'zh-CN' ? '最终变化' : 'Final Delta'}</div></div>
          {timeline?.readable ? (
            <>
              <div className="delta-value-large" style={{ color: deltaColor }}>{deltaDisplay}<span className="delta-unit-large"> quota</span></div>
              <div className="delta-usd">{lang === 'zh-CN' ? '约合金额' : '≈ USD'}: {usdDisplay}</div>
            </>
          ) : (
            <>
              <div className="delta-value-large" style={{ color: colors.orange }}>—</div>
              <div className="delta-usd">{lang === 'zh-CN' ? '无法读取原始余额' : 'Raw quota unavailable'}</div>
            </>
          )}
        </div>

        <div className="evidence-section">
          <div className="evidence-title">{lang === 'zh-CN' ? '证据链' : 'Evidence Chain'}</div>
          {timeline?.readable ? (
            <div className="evidence-chain">
              <div className="evidence-node">
                <div className="evidence-node-label">{lang === 'zh-CN' ? '检测前' : 'Before'}</div>
                <div className="evidence-node-value-sm">{timeline?.before?.rawQuota.toLocaleString() ?? '—'}</div>
              </div>
              <div className="evidence-arrow">→</div>
              <div className="evidence-node">
                <div className="evidence-node-label">HTTP</div>
                <div className="evidence-node-value-sm" style={{ color: report.invalidModelTest?.httpStatus && report.invalidModelTest.httpStatus >= 400 ? colors.red : colors.green }}>
                  {report.invalidModelTest?.httpStatus || '—'}
                </div>
              </div>
              <div className="evidence-arrow">→</div>
              <div className="evidence-node">
                <div className="evidence-node-label">{lang === 'zh-CN' ? '10 秒后' : 'After 10s'}</div>
                <div className="evidence-node-value-sm">{timeline?.after10s?.rawQuota.toLocaleString() ?? '—'}</div>
              </div>
            </div>
          ) : (
            <div className="evidence-unavailable">
              <div className="evidence-unavailable-title">{lang === 'zh-CN' ? '原始额度证据链未建立' : 'Raw quota evidence chain not established'}</div>
              <div className="evidence-unavailable-reason">
                {timeline?.error
                  ? (lang === 'zh-CN' ? `原因：${timeline.error}` : `Reason: ${timeline.error}`)
                  : (lang === 'zh-CN' ? '请打开并登录 New API / One API 控制台后重新验证。' : 'Please open and sign in to New API / One API console to retry.')}
              </div>
            </div>
          )}
        </div>

        <div className="why-section">
          <div className="why-title">{lang === 'zh-CN' ? '为什么是这个结果' : 'Why This Result'}</div>
          <div className="why-text">{lang === 'zh-CN' ? report.judgment.detailZh : report.judgment.detail}</div>
        </div>

        <div className="tech-section">
          <div className="tech-title">{lang === 'zh-CN' ? '技术细节' : 'Technical Evidence'}</div>
          <div className="tech-grid">
            <div className="tech-item"><span className="tech-label">HTTP {lang === 'zh-CN' ? '状态' : 'Status'}</span><span className="tech-value">{report.invalidModelTest?.httpStatus || '—'}</span></div>
            <div className="tech-item"><span className="tech-label">completion_tokens</span><span className="tech-value">{report.baselineTest?.outputSignal?.completionTokens ?? '—'}</span></div>
            <div className="tech-item"><span className="tech-label">total_tokens</span><span className="tech-value">{report.baselineTest?.outputSignal?.totalTokens ?? '—'}</span></div>
            <div className="tech-item"><span className="tech-label">Base URL</span><span className="tech-value">{report.baseUrl}</span></div>
            <div className="tech-item"><span className="tech-label">{lang === 'zh-CN' ? '模型' : 'Model'}</span><span className="tech-value">{report.activeModelId || '—'}</span></div>
            <div className="tech-item"><span className="tech-label">{lang === 'zh-CN' ? '接口' : 'Interface'}</span><span className="tech-value">OpenAI Chat</span></div>
            <div className="tech-item"><span className="tech-label">{lang === 'zh-CN' ? '时间' : 'Time'}</span><span className="tech-value">{new Date(report.startedAt).toLocaleString()}</span></div>
            <div className="tech-item"><span className="tech-label">API Key</span><span className="tech-value">{report.maskedKey}</span></div>
          </div>
        </div>

        <div className="safety-note">
          {lang === 'zh-CN'
            ? 'API Key 已脱敏。本报告只展示本次测试中的可复现信号，不证明服务商故意多扣费。'
            : 'API Key is masked. This report only shows reproducible signals and does not prove intentional overbilling.'}
        </div>

        <div className="report-footer">
          <span className="report-footer-left">{lang === 'zh-CN' ? '由 AI API Doctor 生成' : 'Generated by AI API Doctor'}</span>
          <span className="report-footer-right">aiapidoctor.com</span>
        </div>
      </div>

      {/* ── Detail sections (view-only, not exported) ── */}
      <div ref={detailRef} className="billing-report-detail">
        <div className="detail-sections">
          <div className="detail-section">
            <button className="detail-section-toggle" onClick={() => toggleSection('timeline')}>
              <span>{lang === 'zh-CN' ? '1. 原始额度时间线' : '1. Raw Quota Timeline'}</span>
              {expandedSections.timeline ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {expandedSections.timeline && (
              <div className="detail-section-content">
                <div className="detail-grid">
                  <div className="detail-item"><span className="detail-label">{lang === 'zh-CN' ? '检测前 raw quota' : 'Before'}</span><span className="detail-value">{timeline?.before?.rawQuota?.toLocaleString() ?? '—'}</span></div>
                  <div className="detail-item"><span className="detail-label">{lang === 'zh-CN' ? '请求后立即 raw quota' : 'After immediate'}</span><span className="detail-value">{timeline?.afterImmediate?.rawQuota?.toLocaleString() ?? '—'}</span></div>
                  <div className="detail-item"><span className="detail-label">{lang === 'zh-CN' ? '3 秒后 raw quota' : 'After 3s'}</span><span className="detail-value">{timeline?.after3s?.rawQuota?.toLocaleString() ?? '—'}</span></div>
                  <div className="detail-item"><span className="detail-label">{lang === 'zh-CN' ? '10 秒后 raw quota' : 'After 10s'}</span><span className="detail-value">{timeline?.after10s?.rawQuota?.toLocaleString() ?? '—'}</span></div>
                  <div className="detail-item"><span className="detail-label">{lang === 'zh-CN' ? '最终变化 delta10' : 'Delta 10s'}</span><span className="detail-value" style={{ color: delta10 !== undefined && delta10 < 0 ? colors.red : 'inherit' }}>{delta10 !== undefined ? `${delta10 >= 0 ? '+' : ''}${delta10}` : '—'}</span></div>
                  <div className="detail-item"><span className="detail-label">quota_per_unit</span><span className="detail-value">{timeline?.before?.quotaPerUnit?.toLocaleString() ?? '—'}</span></div>
                  <div className="detail-item"><span className="detail-label">{lang === 'zh-CN' ? '约合金额' : '≈ USD'}</span><span className="detail-value">{usdDisplay}</span></div>
                </div>
              </div>
            )}
          </div>

          <div className="detail-section">
            <button className="detail-section-toggle" onClick={() => toggleSection('request')}>
              <span>{lang === 'zh-CN' ? '2. 请求与响应摘要' : '2. Request & Response Summary'}</span>
              {expandedSections.request ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {expandedSections.request && (
              <div className="detail-section-content">
                <div className="detail-grid">
                  <div className="detail-item"><span className="detail-label">HTTP {lang === 'zh-CN' ? '状态' : 'Status'}</span><span className="detail-value">{report.invalidModelTest?.httpStatus || '—'}</span></div>
                  <div className="detail-item"><span className="detail-label">request_id</span><span className="detail-value">{report.invalidModelTest?.requestId || '—'}</span></div>
                  <div className="detail-item"><span className="detail-label">{lang === 'zh-CN' ? '可见输出长度' : 'Visible output length'}</span><span className="detail-value">{report.baselineTest?.outputSignal?.visibleText?.length ?? '—'}</span></div>
                  <div className="detail-item"><span className="detail-label">completion_tokens</span><span className="detail-value">{report.baselineTest?.outputSignal?.completionTokens ?? '—'}</span></div>
                  <div className="detail-item"><span className="detail-label">total_tokens</span><span className="detail-value">{report.baselineTest?.outputSignal?.totalTokens ?? '—'}</span></div>
                  <div className="detail-item"><span className="detail-label">{lang === 'zh-CN' ? '错误信息' : 'Error message'}</span><span className="detail-value">{report.invalidModelTest?.error?.message || report.baselineTest?.error?.message || '—'}</span></div>
                  <div className="detail-item"><span className="detail-label">{lang === 'zh-CN' ? '是否有有效产物' : 'Has effective output'}</span><span className="detail-value">{report.baselineTest?.outputSignal?.hasAnyEffectiveOutput ? (lang === 'zh-CN' ? '是' : 'Yes') : (lang === 'zh-CN' ? '否' : 'No')}</span></div>
                </div>
              </div>
            )}
          </div>

          <div className="detail-section">
            <button className="detail-section-toggle" onClick={() => toggleSection('rules')}>
              <span>{lang === 'zh-CN' ? '3. 判断规则' : '3. Judgment Rules'}</span>
              {expandedSections.rules ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {expandedSections.rules && (
              <div className="detail-section-content">
                <div className="judgment-rules">
                  <div className="rule-item"><span className="rule-code">failed_request_not_charged</span><span className="rule-desc">{lang === 'zh-CN' ? '请求失败，但 10 秒后原始额度未减少。' : 'Request failed but raw quota unchanged after 10s.'}</span></div>
                  <div className="rule-item"><span className="rule-code">precharge_refunded</span><span className="rule-desc">{lang === 'zh-CN' ? '请求后曾预扣额度，但 10 秒内已返还。' : 'Quota was pre-charged but refunded within 10s.'}</span></div>
                  <div className="rule-item"><span className="rule-code">raw_quota_unavailable</span><span className="rule-desc">{lang === 'zh-CN' ? '无法读取原始余额，只能作为风险参考。' : 'Cannot read raw quota. Use as risk reference only.'}</span></div>
                  <div className="rule-item"><span className="rule-code">failed_request_charged</span><span className="rule-desc">{lang === 'zh-CN' ? '请求失败且无有效输出，但 10 秒后 raw quota 减少。' : 'Request failed with no effective output, but raw quota decreased after 10s.'}</span></div>
                  <div className="rule-item"><span className="rule-code">empty_response_charged</span><span className="rule-desc">{lang === 'zh-CN' ? '请求无有效输出，但 10 秒后 raw quota 减少。' : 'Request had no effective output, but raw quota decreased after 10s.'}</span></div>
                </div>
              </div>
            )}
          </div>

          <div className="detail-section">
            <button className="detail-section-toggle" onClick={() => toggleSection('suggestion')}>
              <span>{lang === 'zh-CN' ? '4. 站长侧修复建议' : '4. Provider Fix Suggestions'}</span>
              {expandedSections.suggestion ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {expandedSections.suggestion && (
              <div className="detail-section-content">
                <div className="provider-suggestion">
                  <p>{lang === 'zh-CN'
                    ? '失败请求、无效模型、上游 503、超时、无可用通道等无有效产物请求不应最终扣费。如果已预扣，应在最终结算阶段返还。'
                    : 'Failed requests, invalid models, upstream 503, timeout, no available channels etc. with no effective output should not be finally charged. If pre-charged, should be refunded at final settlement.'}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        .report-page { min-height: 100vh; padding: 20px; max-width: 680px; margin: 0 auto; }
        .report-toolbar { display: flex; flex-direction: column; align-items: center; margin-bottom: 24px; }
        .save-btn {
          padding: 10px 28px; font-size: 14px; font-weight: 600; border: none; border-radius: 10px;
          background: #2563EB; color: white; cursor: pointer; transition: all 0.2s;
        }
        .save-btn:hover:not(:disabled) { background: #1D4ED8; }
        .save-btn:disabled { opacity: 0.7; cursor: not-allowed; }
        .save-btn.saving { background: #F59E0B; }
        .save-btn.saved { background: #16A34A; }
        .save-btn.failed { background: #DC2626; }
        .save-msg { margin-top: 8px; font-size: 12px; text-align: center; }
        .save-msg-fail { color: #DC2626; }
        .save-msg-info { color: #64748B; }
        .billing-report-receipt {
          background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 24px; margin-bottom: 24px;
        }
        .billing-report-summary { }
        .billing-report-detail { margin-top: 0; }
        .report-header { }
        .verdict-hero {
          border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 24px;
        }
        .verdict-icon { font-size: 28px; border-radius: 50%; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; color: white; }
        .verdict-label { font-size: 13px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
        .verdict-title { font-size: 22px; font-weight: 700; color: #0F172A; margin-bottom: 8px; }
        .verdict-subtitle { font-size: 14px; color: #475569; line-height: 1.5; }
        .detection-score { font-size: 14px; color: #475569; }
        .score-label { font-weight: 500; }
        .score-value { font-size: 18px; font-weight: 700; color: #0F172A; }
        .score-max { font-size: 14px; color: #94A3B8; }
        .status-badges { }
        .status-badge-item { font-size: 13px; color: #475569; }
        .badge-label { }
        .badge-value { }
        .delta-section { background: #F8FAFC; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px; }
        .delta-main { }
        .delta-label { font-size: 13px; color: #94A3B8; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; margin-bottom: 8px; }
        .delta-value-large { font-size: 72px; font-weight: 800; line-height: 1.1; margin-bottom: 8px; }
        .delta-unit-large { font-size: 28px; font-weight: 500; color: #475569; }
        .delta-usd { font-size: 18px; color: #475569; }
        .evidence-section { margin-bottom: 24px; }
        .evidence-title { font-size: 13px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }
        .evidence-chain { display: flex; align-items: center; justify-content: center; gap: 12px; }
        .evidence-node { background: white; border: 2px solid #E5E7EB; border-radius: 12px; padding: 14px 18px; text-align: center; min-width: 90px; }
        .evidence-node-label { font-size: 11px; color: #475569; margin-bottom: 4px; }
        .evidence-node-value-sm { font-size: 16px; font-weight: 700; color: #0F172A; }
        .evidence-arrow { font-size: 18px; color: #94A3B8; }
        .evidence-unavailable { background: #FEF3C7; border-radius: 8px; padding: 16px; }
        .evidence-unavailable-title { font-size: 14px; font-weight: 600; color: #92400E; margin-bottom: 6px; }
        .evidence-unavailable-reason { font-size: 13px; color: #78350F; line-height: 1.5; }
        .why-section { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 20px; margin-bottom: 24px; }
        .why-title { font-size: 13px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
        .why-text { font-size: 15px; color: #0F172A; line-height: 1.6; }
        .tech-section { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 20px; margin-bottom: 24px; }
        .tech-title { font-size: 13px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }
        .tech-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
        .tech-item { display: flex; flex-direction: column; gap: 4px; padding: 10px; background: #F8FAFC; border-radius: 8px; }
        .tech-label { font-size: 12px; color: #475569; }
        .tech-value { font-size: 13px; font-weight: 600; color: #0F172A; word-break: break-all; }
        .safety-note { background: #F1F5F9; border-radius: 12px; padding: 14px; font-size: 13px; color: #475569; line-height: 1.6; margin-bottom: 24px; }
        .report-footer { padding-top: 14px; border-top: 1px solid #E5E7EB; display: flex; justify-content: space-between; font-size: 12px; color: #94A3B8; }
        .detail-sections { margin-top: 24px; }
        .detail-section { border: 1px solid #E5E7EB; border-radius: 16px; margin-bottom: 10px; overflow: hidden; background: white; }
        .detail-section-toggle {
          width: 100%; display: flex; align-items: center; justify-content: space-between;
          padding: 14px 18px; background: #F8FAFC; border: none; font-size: 13px; font-weight: 600;
          color: #0F172A; cursor: pointer; transition: background-color 0.15s;
        }
        .detail-section-toggle:hover { background: #F1F5F9; }
        .detail-section-content { padding: 18px; border-top: 1px solid #E5E7EB; }
        .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
        .detail-item { display: flex; flex-direction: column; gap: 4px; padding: 10px; background: #F8FAFC; border-radius: 8px; }
        .detail-label { font-size: 11px; color: #64748B; }
        .detail-value { font-size: 14px; font-weight: 600; color: #0F172A; font-family: 'SFMono-Regular', 'Consolas', monospace; }
        .judgment-rules { display: flex; flex-direction: column; gap: 10px; }
        .rule-item { display: flex; flex-direction: column; gap: 4px; padding: 10px; background: #F8FAFC; border-radius: 8px; border-left: 3px solid #CBD5E1; }
        .rule-code { font-size: 11px; font-weight: 600; color: #0F172A; font-family: monospace; }
        .rule-desc { font-size: 12px; color: #475569; line-height: 1.5; }
        .provider-suggestion { padding: 14px; background: #F0FDF4; border-radius: 8px; border-left: 4px solid #16A34A; }
        .provider-suggestion p { font-size: 13px; color: #0F172A; line-height: 1.6; margin: 0; }
      `}</style>
    </div>
  );
}

function NotFoundPage({ lang }: { lang: Lang }) {
  return (
    <div className="not-found-page">
      <div className="not-found-icon">📋</div>
      <div className="not-found-title">{lang === 'zh-CN' ? '报告不存在或已过期' : 'Report not found or expired'}</div>
      <div className="not-found-desc">{lang === 'zh-CN' ? '请返回插件重新运行检测' : 'Please return to the extension and run a new diagnosis'}</div>
      <style>{`
        .not-found-page { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; text-align: center; padding: 20px; }
        .not-found-icon { font-size: 56px; margin-bottom: 20px; }
        .not-found-title { font-size: 22px; font-weight: 700; color: #0F172A; margin-bottom: 10px; }
        .not-found-desc { font-size: 15px; color: #475569; }
      `}</style>
    </div>
  );
}

export default function ReportApp() {
  const [report, setReport] = useState<BillingDiagnosisReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Lang>('en-US');

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const reportId = urlParams.get('reportId');
    if (!reportId) { setLoading(false); return; }

    getStoredReports().then((reports) => {
      const found = reports[reportId];
      if (found) setReport(found);
      setLoading(false);
    });

    const resolvedLang = resolveLanguage();
    setLang(resolvedLang);
  }, []);

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner">⏳</div>
        <div className="loading-text">{lang === 'zh-CN' ? '加载中...' : 'Loading...'}</div>
        <style>{`
          .loading-page { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; gap: 16px; }
          .loading-spinner { font-size: 44px; }
          .loading-text { font-size: 16px; color: #475569; }
        `}</style>
      </div>
    );
  }

  if (!report) return <NotFoundPage lang={lang} />;
  return <ReportPage report={report} lang={lang} />;
}
