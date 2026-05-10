import React, { useState, useEffect } from 'react';
import { ApiModel } from '../types';
import {
  getActiveProvider,
  getActiveApiKey,
  fetchModels,
} from '../lib/storage';

const ModelsPage: React.FC = () => {
  const [models, setModels] = useState<ApiModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const provider = await getActiveProvider();
      const apiKey = await getActiveApiKey(provider?.id || '');

      if (!provider || !apiKey) {
        setError('Provider or API key not configured. Please set up your provider and API key first.');
        return;
      }

      const fetchedModels = await fetchModels(provider.baseUrl, apiKey.key);
      setModels(fetchedModels);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setLoading(false);
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
          <span className="error-icon">!</span>
          {error}
          <button className="btn btn-secondary retry-btn" onClick={loadModels}>
            Retry
          </button>
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
