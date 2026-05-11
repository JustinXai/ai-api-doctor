import React, { useState } from 'react';
import { setActiveModelId, clearAllLocalData } from '../lib/storage';
import { Save, Trash2, CheckCircle, ExternalLink } from 'lucide-react';
import type { Language } from '../lib/i18n';

interface SettingsPageProps {
  lang: 'zh-CN' | 'en-US';
  langSetting: Language;
  onLangChange: (lang: Language) => void;
  activeModelId: string;
  onModelChange: (modelId: string) => void;
}

interface HelpLink {
  label: string;
  desc: string;
  url: string;
}

const SettingsPage: React.FC<SettingsPageProps> = ({
  lang,
  langSetting,
  onLangChange,
  activeModelId,
  onModelChange,
}) => {
  const [modelInput, setModelInput] = useState<string>(activeModelId);
  const [saved, setSaved] = useState(false);

  React.useEffect(() => {
    setModelInput(activeModelId);
  }, [activeModelId]);

  const handleSave = async () => {
    const trimmed = modelInput.trim();
    await setActiveModelId(trimmed);
    onModelChange(trimmed);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClearData = async () => {
    const confirmed = window.confirm(
      lang === 'zh-CN'
        ? '确定要清除所有本地数据吗？此操作将删除所有服务商、API 密钥和设置，且不可恢复。'
        : 'Are you sure you want to clear all local data? This will delete all providers, API keys, and settings. This action cannot be undone.'
    );
    if (confirmed) {
      await clearAllLocalData();
      setModelInput('');
      onModelChange('');
      alert(
        lang === 'zh-CN'
          ? '所有数据已清除，请刷新插件。'
          : 'All data has been cleared. Please refresh the extension.'
      );
    }
  };

  const handleOpenLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const helpLinks: HelpLink[] = [
    {
      label: lang === 'zh-CN' ? '常见问题' : 'FAQ',
      desc: lang === 'zh-CN' ? 'FAQ' : '常见问题',
      url: 'https://aiapidoctor.com/faq',
    },
    {
      label: lang === 'zh-CN' ? '403 分组错误' : '403 Model Group Error',
      desc: lang === 'zh-CN' ? '403 Model Group Error' : '403 分组错误',
      url: 'https://aiapidoctor.com/errors/403-model-group',
    },
    {
      label: lang === 'zh-CN' ? 'Token 消耗核对' : 'Token Usage Audit',
      desc: lang === 'zh-CN' ? 'Token Usage Audit' : 'Token 消耗核对',
      url: 'https://aiapidoctor.com/guides/token-usage-audit',
    },
    {
      label: lang === 'zh-CN' ? '隐私政策' : 'Privacy',
      desc: lang === 'zh-CN' ? 'Privacy' : '隐私政策',
      url: 'https://aiapidoctor.com/privacy',
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">{lang === 'zh-CN' ? '设置' : 'Settings'}</h2>
      </div>

      {/* Active Model */}
      <div className="settings-section">
        <div className="section-label" style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
          {lang === 'zh-CN' ? '当前模型' : 'Active Model'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            type="text"
            className="form-input"
            placeholder="deepseek-chat, gpt-4o, claude-3-5-sonnet"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
          />
          <p className="setting-desc" style={{ marginLeft: 0 }}>
            {lang === 'zh-CN' ? '常用模型 ID：' : 'Common IDs:'}{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>gpt-4o</code>,{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>gpt-4o-mini</code>,{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>claude-3-5-sonnet-20241022</code>,{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>deepseek-chat</code>
          </p>
        </div>
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={handleSave}>
            {saved ? (
              <><CheckCircle size={11} strokeWidth={2.5} /> {lang === 'zh-CN' ? '已保存！' : 'Saved!'}</>
            ) : (
              <><Save size={11} strokeWidth={2} /> {lang === 'zh-CN' ? '保存' : 'Save'}</>
            )}
          </button>
        </div>
      </div>

      {/* Language */}
      <div className="settings-section">
        <div className="section-label" style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
          {lang === 'zh-CN' ? '界面语言' : 'Language'}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['auto', 'zh-CN', 'en-US'] as Language[]).map((option) => (
            <button
              key={option}
              className={`btn ${langSetting === option ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onLangChange(option)}
            >
              {option === 'auto'
                ? lang === 'zh-CN' ? '跟随系统' : 'Auto'
                : option === 'zh-CN'
                ? '简体中文'
                : 'English'}
            </button>
          ))}
        </div>
      </div>

      {/* Help & FAQ */}
      <div className="settings-section">
        <div className="section-label" style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
          {lang === 'zh-CN' ? '帮助与文档' : 'Help & FAQ'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {helpLinks.map((link) => (
            <button
              key={link.url}
              className="btn btn-secondary"
              onClick={() => handleOpenLink(link.url)}
              style={{ justifyContent: 'space-between', width: '100%' }}
            >
              <span>
                {link.label}
                <span style={{ color: 'var(--muted-light)', marginLeft: 4, fontWeight: 400, fontSize: 10 }}>
                  / {link.desc}
                </span>
              </span>
              <ExternalLink size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
            </button>
          ))}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="settings-section danger-zone">
        <div className="section-label" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          {lang === 'zh-CN' ? '危险操作' : 'Danger Zone'}
        </div>
        <div className="setting-row">
          <button className="btn btn-danger" onClick={handleClearData}>
            <Trash2 size={11} strokeWidth={2} />
            {lang === 'zh-CN' ? '清除所有本地数据' : 'Clear All Local Data'}
          </button>
          <p className="setting-desc" style={{ marginLeft: 0, color: 'var(--error-text)' }}>
            {lang === 'zh-CN'
              ? '永久删除 chrome.storage.local 中的所有服务商、API 密钥和设置。'
              : 'Permanently delete all providers, API keys, and settings from chrome.storage.local.'}
          </p>
        </div>
      </div>

      {/* Privacy Info */}
      <div className="settings-info">
        <p className="info-row">
          <strong>{lang === 'zh-CN' ? '隐私' : 'Privacy'}:</strong>{' '}
          {lang === 'zh-CN'
            ? '所有数据存储在浏览器本地的 chrome.storage.local 中，API 密钥不会上传至任何服务器。'
            : 'All data is stored locally in your browser via chrome.storage.local. API keys are never uploaded to any server.'}
        </p>
        <p className="info-row">
          <strong>{lang === 'zh-CN' ? '存储空间' : 'Storage quota'}:</strong>{' '}
          {lang === 'zh-CN' ? '约 10MB。' : 'Approximately 10MB.'}
        </p>
      </div>
    </div>
  );
};

export default SettingsPage;
