import React, { useState, useEffect, useCallback } from 'react';
import { ApiModel, Provider, ApiError } from '../types';
import {
  getActiveProvider,
  getActiveApiKey,
  fetchModels,
  testConnectivity,
  setActiveModelId,
} from '../lib/storage';
import { Search, Copy as CopyIcon, CheckCircle, RefreshCw, Wifi, XCircle, Check, ExternalLink } from 'lucide-react';

interface ModelsPageProps {
  activeModelId: string;
  onModelChange: (modelId: string) => void;
}

const ModelsPage: React.FC<ModelsPageProps> = ({ activeModelId, onModelChange }) => {
  const [models, setModels] = useState<ApiModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; latency?: number; error?: ApiError } | null>(null);
  const [testing, setTesting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [manualModelInput, setManualModelInput] = useState('');
  const [showManualForm, setShowManualForm] = useState(false);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTestResult(null);
    try {
      const activeProvider = await getActiveProvider();
      setProvider(activeProvider);
      const apiKey = await getActiveApiKey(activeProvider?.id || '');
      if (!activeProvider || !apiKey) {
        setError({ code: 'UNKNOWN_ERROR', message: 'Provider or API key not configured. Please set up your configuration first.' });
        return;
      }
      const fetchedModels = await fetchModels(activeProvider.baseUrl, apiKey.key);
      setModels(fetchedModels);
    } catch (err) {
      const apiErr = (err as ApiError) || { code: 'UNKNOWN_ERROR', message: err instanceof Error ? err.message : 'Failed to fetch models' };
      setError(apiErr);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleTestConnectivity = useCallback(async () => {
    if (!provider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const apiKey = await getActiveApiKey(provider.id);
      if (!apiKey) {
        setTestResult({ success: false, error: { code: 'UNKNOWN_ERROR', message: 'No API key configured' } });
        return;
      }
      const result = await testConnectivity(provider.baseUrl, apiKey.key);
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: { code: 'UNKNOWN_ERROR', message: err instanceof Error ? err.message : 'Unknown error' } });
    } finally {
      setTesting(false);
    }
  }, [provider]);

  const handleSelectModel = useCallback(async (modelId: string) => {
    await setActiveModelId(modelId);
    onModelChange(modelId);
  }, [onModelChange]);

  const handleCopyModelId = useCallback(async (modelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(modelId);
      setCopiedId(modelId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // silent
    }
  }, []);

  const handleSetManualModel = useCallback(async () => {
    const trimmed = manualModelInput.trim();
    if (!trimmed) return;
    await setActiveModelId(trimmed);
    onModelChange(trimmed);
    setManualModelInput('');
    setShowManualForm(false);
    setModels([]);
    setError(null);
  }, [manualModelInput, onModelChange]);

  const handleTestManualModel = useCallback(async () => {
    if (!provider || !manualModelInput.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const apiKey = await getActiveApiKey(provider.id);
      if (!apiKey) {
        setTestResult({ success: false, error: { code: 'UNKNOWN_ERROR', message: 'No API key configured' } });
        return;
      }
      const result = await testConnectivity(provider.baseUrl, apiKey.key, manualModelInput.trim());
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: { code: 'UNKNOWN_ERROR', message: err instanceof Error ? err.message : 'Unknown error' } });
    } finally {
      setTesting(false);
    }
  }, [provider, manualModelInput]);

  const filteredModels = models.filter((m) =>
    searchQuery
      ? m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.name.toLowerCase().includes(searchQuery.toLowerCase())
      : true
  );

  const is403 = error?.code === 'HTTP_403' || error?.code === 'MODEL_ACCESS_DENIED';
  const isNetwork = error?.code === 'NETWORK_ERROR';
  const showManual = is403 || isNetwork || !models.length;

  const renderError = () => {
    if (!error) return null;
    return (
      <div className="error-alert">
        <div className="error-alert-head">
          <div className="error-alert-icon">
            <XCircle size={10} strokeWidth={2.5} />
          </div>
          <span className="error-alert-title">{error.message.split('.')[0]}.</span>
        </div>
        <div className="error-alert-body">
          <p className="error-alert-desc">{error.message}</p>
          {error.providerMessage && (
            <div className="error-alert-provider-msg">
              Provider: {error.providerMessage}
            </div>
          )}
          {showManual && (
            <div className="error-alert-hint">
              Some relay providers do not expose /v1/models. You can manually enter a model ID and test it directly.
            </div>
          )}
        </div>
        <div className="error-alert-actions">
          <button className="btn btn-secondary" onClick={handleTestConnectivity} disabled={testing}>
            <Wifi size={11} strokeWidth={2} />
            {testing ? 'Testing…' : 'Test Connectivity'}
          </button>
          <button className="btn btn-primary" onClick={loadModels}>
            <RefreshCw size={11} strokeWidth={2} />
            Retry
          </button>
        </div>
        {testResult && (
          <div style={{ padding: '0 12px 10px' }}>
            <div className={`connectivity-result ${testResult.success ? 'success' : 'error'}`}>
              {testResult.success ? (
                <><CheckCircle size={11} strokeWidth={2.5} /> Connectivity OK · {testResult.latency}ms</>
              ) : (
                <><XCircle size={11} strokeWidth={2.5} /> {testResult.error?.message}</>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <span className="page-loading-text">Loading models…</span>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Models</h2>
        {activeModelId && (
          <span className="page-subtitle">Active: {activeModelId}</span>
        )}
      </div>

      {error && renderError()}

      {/* Manual Model Input — shown at top for relay provider users */}
      <div className="manual-model-section">
        <p className="manual-model-hint">
          Some relay providers do not expose /v1/models. Enter a model ID manually and test it directly.
        </p>
        {showManualForm ? (
          <div className="add-form" style={{ background: 'transparent', border: 'none', padding: 0 }}>
            <input
              type="text"
              className="form-input"
              placeholder="deepseek-chat, gpt-4o, claude-3-5-sonnet"
              value={manualModelInput}
              onChange={(e) => setManualModelInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSetManualModel()}
              autoFocus
            />
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleSetManualModel} disabled={!manualModelInput.trim()}>
                <Check size={11} strokeWidth={2.5} />
                Set Active
              </button>
              <button className="btn btn-ghost" onClick={handleTestManualModel} disabled={!manualModelInput.trim() || testing} title="Test this model">
                <Wifi size={11} strokeWidth={2} />
                {testing ? '…' : 'Test'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowManualForm(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-secondary" onClick={() => setShowManualForm(true)} style={{ width: '100%' }}>
            <ExternalLink size={12} strokeWidth={2} />
            Enter Model Manually
          </button>
        )}
      </div>

      {/* Search + List */}
      {!error && models.length > 0 && (
        <>
          <div className="models-page-search">
            <span className="models-search-icon">
              <Search size={13} strokeWidth={2} />
            </span>
            <input
              type="text"
              className="models-search-input"
              placeholder="Search models…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="models-count-row">
            <span className="models-count">
              {searchQuery ? `${filteredModels.length} of ${models.length}` : `${models.length} models`}
            </span>
          </div>

          <div className="models-list">
            {filteredModels.map((model) => {
              const isActive = activeModelId === model.id;
              return (
                <div
                  key={model.id}
                  className={`model-card ${isActive ? 'selected' : ''}`}
                  onClick={() => handleSelectModel(model.id)}
                >
                  <div className="model-card-info">
                    <div className="model-card-name">
                      {model.name || model.id}
                      {isActive && (
                        <span className="badge active-tag" style={{ fontSize: 9, padding: '1px 5px' }}>
                          <CheckCircle size={8} strokeWidth={2.5} />
                          Active
                        </span>
                      )}
                    </div>
                    <div className="model-card-id">{model.id}</div>
                  </div>
                  <div className="model-card-actions">
                    <button
                      className={`btn-copy ${copiedId === model.id ? 'copied' : ''}`}
                      onClick={(e) => handleCopyModelId(model.id, e)}
                    >
                      {copiedId === model.id ? (
                        <CheckCircle size={10} strokeWidth={2.5} />
                      ) : (
                        <CopyIcon size={10} strokeWidth={2} />
                      )}
                      {copiedId === model.id ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button className="btn btn-secondary" onClick={loadModels}>
            <RefreshCw size={11} strokeWidth={2} />
            Refresh
          </button>
        </>
      )}

      {!error && models.length === 0 && !showManualForm && (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <span className="empty-state-text">No models loaded.</span>
          <span className="empty-state-hint">Enter a model ID manually or retry.</span>
        </div>
      )}
    </div>
  );
};

export default ModelsPage;
