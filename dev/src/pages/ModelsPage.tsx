import React, { useState, useEffect } from 'react';
import { ApiModel, Provider } from '../types';
import {
  getActiveProvider,
  getActiveApiKey,
  fetchModels,
  testConnectivity,
} from '../lib/storage';

const ModelsPage: React.FC = () => {
  const [models, setModels] = useState<ApiModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; latency?: number; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    setTestResult(null);
    try {
      const activeProvider = await getActiveProvider();
      setProvider(activeProvider);
      const apiKey = await getActiveApiKey(activeProvider?.id || '');

      if (!activeProvider || !apiKey) {
        setError('Provider or API key not configured. Please set up your provider and API key first.');
        return;
      }

      const fetchedModels = await fetchModels(activeProvider.baseUrl, apiKey.key);
      setModels(fetchedModels);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnectivity = async () => {
    if (!provider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const apiKey = await getActiveApiKey(provider.id);
      if (!apiKey) {
        setTestResult({ success: false, error: 'No API key configured for this provider' });
        return;
      }
      const result = await testConnectivity(provider.baseUrl, apiKey.key);
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setTesting(false);
    }
  };

  const handleSelectModel = (modelId: string) => {
    setSelectedModel(selectedModel === modelId ? null : modelId);
  };

  const handleCopyModelId = async (modelId: string) => {
    try {
      await navigator.clipboard.writeText(modelId);
    } catch {
      alert('Failed to copy model ID');
    }
  };

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading models...</p>
      </div>
    );
  }

  return (
    <div className="page models-page">
      <h2 className="page-title">Available Models</h2>

      {error && (
        <div className="error-message">
          <div className="error-content">
            <span className="error-icon">!</span>
            <div className="error-details">
              <p className="error-text">{error}</p>
              {provider && (
                <p className="error-provider">
                  Provider: <strong>{provider.name}</strong> | Base URL: <code>{provider.baseUrl}</code>
                </p>
              )}
              <p className="error-hint">
                This provider may not support /v1/models. You can still use it if connectivity test passes.
              </p>
            </div>
          </div>
          <div className="error-actions">
            <button className="btn btn-secondary" onClick={handleTestConnectivity} disabled={testing}>
              {testing ? 'Testing...' : 'Test Connectivity'}
            </button>
            <button className="btn btn-primary" onClick={loadModels}>
              Retry
            </button>
          </div>
          {testResult && (
            <div className={`connectivity-result ${testResult.success ? 'success' : 'error'}`}>
              {testResult.success ? (
                <span>Connectivity OK ({testResult.latency}ms)</span>
              ) : (
                <span>Connectivity failed: {testResult.error}</span>
              )}
            </div>
          )}
        </div>
      )}

      {!error && models.length === 0 && (
        <div className="empty-state">
          No models found. This may indicate a configuration issue.
        </div>
      )}

      {!error && models.length > 0 && (
        <>
          <p className="page-desc">
            Found {models.length} models. Click to select a model.
          </p>
          <div className="models-list">
            {models.map((model) => (
              <div
                key={model.id}
                className={`model-item ${selectedModel === model.id ? 'selected' : ''}`}
                onClick={() => handleSelectModel(model.id)}
              >
                <div className="model-name">{model.name}</div>
                <div className="model-id">{model.id}</div>
                {selectedModel === model.id && (
                  <button
                    className="btn btn-secondary copy-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyModelId(model.id);
                    }}
                  >
                    Copy ID
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <button className="btn btn-secondary refresh-btn" onClick={loadModels}>
        Refresh Models
      </button>
    </div>
  );
};

export default ModelsPage;
