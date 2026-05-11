import React, { useState, useEffect, useCallback } from 'react';
import { getActiveProvider, getActiveApiKey, getActiveModelId, copyToClipboard } from '../lib/storage';
import { Copy, CheckCircle, Download, FileCode, Terminal, Braces, FileText } from 'lucide-react';

type ExportFormat = 'cline' | 'continue' | 'openai' | 'curl' | 'generic';

interface FormatConfig {
  type: ExportFormat;
  name: string;
  icon: React.ReactNode;
}

const FORMATS: FormatConfig[] = [
  { type: 'cline', name: 'Cline', icon: <FileCode size={14} strokeWidth={2} /> },
  { type: 'continue', name: 'Continue', icon: <Terminal size={14} strokeWidth={2} /> },
  { type: 'openai', name: 'OpenAI SDK', icon: <Braces size={14} strokeWidth={2} /> },
  { type: 'curl', name: 'cURL', icon: <Terminal size={14} strokeWidth={2} /> },
  { type: 'generic', name: '.env', icon: <FileText size={14} strokeWidth={2} /> },
];

const ExportPage: React.FC = () => {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('cline');
  const [exportData, setExportData] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [providerName, setProviderName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  const generateExport = useCallback(async () => {
    setLoading(true);
    try {
      const [provider, apiKey, modelId] = await Promise.all([
        getActiveProvider(),
        getActiveApiKey((await getActiveProvider())?.id || ''),
        getActiveModelId(),
      ]);
      setProviderName(provider?.name || '');
      setBaseUrl(provider?.baseUrl || '');

      if (!provider || !apiKey) {
        setExportData('# Provider or API key not configured.');
        setLoading(false);
        return;
      }

      const resolvedModelId = modelId || '';
      let data = '';

      switch (selectedFormat) {
        case 'cline':
          data = JSON.stringify(
            { name: provider.name, apiKey: apiKey.key, baseURL: provider.baseUrl },
            null,
            2
          );
          break;
        case 'continue':
          data = JSON.stringify(
            { title: provider.name, model: resolvedModelId || 'default', apiKey: apiKey.key, baseUrl: provider.baseUrl },
            null,
            2
          );
          break;
        case 'openai':
          data = `OPENAI_API_KEY=${apiKey.key}\nOPENAI_API_BASE=${provider.baseUrl}`;
          break;
        case 'curl':
          data = [
            `# ${provider.name}`,
            `curl ${provider.baseUrl}/chat/completions \\`,
            `  -H "Authorization: Bearer ${apiKey.key}" \\`,
            `  -H "Content-Type: application/json" \\`,
            `  -d '{`,
            `    "model": "${resolvedModelId || 'gpt-4o'}",`,
            `    "messages": [{"role": "user", "content": "Hello"}]`,
            `  }'`,
          ].join('\n');
          break;
        case 'generic':
        default:
          data = [
            `# ${provider.name}`,
            `PROVIDER_NAME="${provider.name}"`,
            `API_BASE_URL="${provider.baseUrl}"`,
            `API_KEY="${apiKey.key}"`,
            resolvedModelId ? `ACTIVE_MODEL="${resolvedModelId}"` : null,
          ].filter(Boolean).join('\n');
          break;
      }

      setExportData(data);
    } catch {
      setExportData('# Failed to generate export');
    } finally {
      setLoading(false);
    }
  }, [selectedFormat]);

  useEffect(() => {
    generateExport();
  }, [generateExport]);

  const handleCopy = async () => {
    await copyToClipboard(exportData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const isJson = ['cline', 'continue'].includes(selectedFormat);
    const mimeType = isJson ? 'application/json' : 'text/plain';
    const extension = isJson ? 'json' : 'txt';
    const blob = new Blob([exportData], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-config-${selectedFormat}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Export</h2>
      </div>

      {/* Config Summary */}
      <div className="info-box" style={{ fontSize: 12 }}>
        <div className="info-box-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </div>
        <span>
          {providerName || 'No provider'} · {baseUrl || 'No URL'}
          {exportData && exportData.includes('ACTIVE_MODEL') && ' · model set'}
        </span>
      </div>

      {/* Format Cards */}
      <div className="export-targets-grid">
        {FORMATS.map((fmt) => (
          <button
            key={fmt.type}
            className={`export-target-btn ${selectedFormat === fmt.type ? 'active' : ''}`}
            onClick={() => setSelectedFormat(fmt.type)}
          >
            <div className="export-target-icon">{fmt.icon}</div>
            <span className="export-target-name">{fmt.name}</span>
          </button>
        ))}
      </div>

      {/* Preview */}
      <div className="export-preview">
        <div className="export-preview-head">
          <span className="export-preview-label">Configuration</span>
          <span className="export-preview-type">
            {FORMATS.find((f) => f.type === selectedFormat)?.name}
          </span>
        </div>
        {loading ? (
          <div className="page-loading" style={{ padding: 16 }}>
            <div className="spinner" />
          </div>
        ) : (
          <pre className="export-data">{exportData}</pre>
        )}
      </div>

      {/* Actions */}
      <div className="export-actions">
        <button className="btn btn-primary" onClick={handleCopy} style={{ flex: 1 }}>
          {copied ? (
            <><CheckCircle size={12} strokeWidth={2.5} /> Copied!</>
          ) : (
            <><Copy size={12} strokeWidth={2} /> Copy</>
          )}
        </button>
        <button className="btn btn-secondary" onClick={handleDownload}>
          <Download size={12} strokeWidth={2} />
          Download
        </button>
      </div>

      <div className="export-note">
        <strong>Note:</strong> Your API key will be included in the export. Keep the file secure and do not share it publicly.
      </div>
    </div>
  );
};

export default ExportPage;
