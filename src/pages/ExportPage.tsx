import React, { useState, useEffect } from 'react';
import { ExportTarget } from '../types';
import {
  getActiveProvider,
  getActiveApiKey,
  exportToJson,
  copyToClipboard,
} from '../lib/storage';

const ExportPage: React.FC = () => {
  const [exportTarget, setExportTarget] = useState<ExportTarget['type']>('generic');
  const [exportData, setExportData] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    generateExport();
  }, [exportTarget]);

  const generateExport = async () => {
    setLoading(true);
    try {
      const provider = await getActiveProvider();
      const apiKey = await getActiveApiKey(provider?.id || '');

      if (!provider || !apiKey) {
        setExportData(JSON.stringify({ error: 'Please configure provider and API key first' }));
        return;
      }

      let data: Record<string, string>;
      switch (exportTarget) {
        case 'claude':
          data = {
            ANTHROPIC_API_KEY: apiKey.key,
            ANTHROPIC_BASE_URL: provider.baseUrl,
          };
          break;
        case 'openai':
          data = {
            OPENAI_API_KEY: apiKey.key,
            OPENAI_BASE_URL: provider.baseUrl,
          };
          break;
        case 'generic':
        default:
          data = {
            API_KEY: apiKey.key,
            BASE_URL: provider.baseUrl,
            PROVIDER_NAME: provider.name,
          };
          break;
      }

      setExportData(exportToJson(data));
    } catch (error) {
      setExportData(JSON.stringify({ error: 'Failed to generate export' }));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    await copyToClipboard(exportData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([exportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-config-${exportTarget}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page export-page">
      <h2 className="page-title">Export Configuration</h2>
      <p className="page-desc">
        Export your API configuration in a format suitable for various AI clients.
      </p>

      <div className="export-targets">
        <label className="target-label">Export Format:</label>
        <div className="target-buttons">
          <button
            className={`target-btn ${exportTarget === 'generic' ? 'active' : ''}`}
            onClick={() => setExportTarget('generic')}
          >
            Generic JSON
          </button>
          <button
            className={`target-btn ${exportTarget === 'claude' ? 'active' : ''}`}
            onClick={() => setExportTarget('claude')}
          >
            Claude (Anthropic)
          </button>
          <button
            className={`target-btn ${exportTarget === 'openai' ? 'active' : ''}`}
            onClick={() => setExportTarget('openai')}
          >
            OpenAI
          </button>
        </div>
      </div>

      <div className="export-preview">
        <label className="preview-label">Preview:</label>
        {loading ? (
          <div className="loading-preview">Generating...</div>
        ) : (
          <pre className="export-data">{exportData}</pre>
        )}
      </div>

      <div className="export-actions">
        <button className="btn btn-primary" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy to Clipboard'}
        </button>
        <button className="btn btn-secondary" onClick={handleDownload}>
          Download JSON
        </button>
      </div>

      <div className="export-note">
        <strong>Note:</strong> Your API key will be included in the export.
        Keep the exported file secure and do not share it publicly.
      </div>
    </div>
  );
};

export default ExportPage;
