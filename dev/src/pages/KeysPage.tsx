import React, { useState, useEffect } from 'react';
import { ApiKey } from '../types';
import {
  getApiKeys,
  addApiKey,
  deleteApiKey,
  getActiveProvider,
  maskApiKey,
} from '../lib/storage';
import { generateId } from '../lib/storage';

const KeysPage: React.FC = () => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newKey, setNewKey] = useState({ key: '', name: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [apiKeys, provider] = await Promise.all([
        getApiKeys(),
        getActiveProvider(),
      ]);
      setKeys(apiKeys);
      setActiveProviderId(provider?.id || '');
    } catch (error) {
      console.error('Failed to load keys:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddKey = async () => {
    if (!newKey.key) return;

    const apiKey: ApiKey = {
      id: generateId(),
      providerId: activeProviderId,
      key: newKey.key,
      name: newKey.name || undefined,
      createdAt: Date.now(),
    };

    await addApiKey(apiKey);
    setKeys([...keys, apiKey]);
    setNewKey({ key: '', name: '' });
    setShowAddForm(false);
  };

  const handleDeleteKey = async (id: string) => {
    await deleteApiKey(id);
    setKeys(keys.filter((k) => k.id !== id));
  };

  const handleCopyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      alert('API Key copied to clipboard!');
    } catch {
      alert('Failed to copy API Key');
    }
  };

  if (loading) {
    return <div className="page-loading"><div className="spinner" /></div>;
  }

  return (
    <div className="page keys-page">
      <h2 className="page-title">API Keys</h2>
      <p className="page-desc">
        API keys are stored locally in your browser using chrome.storage.local.
        They are never uploaded to any server.
      </p>

      <div className="keys-list">
        {keys.length === 0 ? (
          <div className="empty-state">
            No API keys saved. Add one below to get started.
          </div>
        ) : (
          keys.map((key) => (
            <div key={key.id} className="key-item">
              <div className="key-info">
                <div className="key-name">
                  {key.name || 'Unnamed Key'}
                  {key.providerId === activeProviderId && (
                    <span className="badge active">Active</span>
                  )}
                </div>
                <div className="key-value">{maskApiKey(key.key)}</div>
                <div className="key-date">
                  Added: {new Date(key.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="key-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => handleCopyKey(key.key)}
                >
                  Copy
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => handleDeleteKey(key.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showAddForm ? (
        <div className="add-form">
          <input
            type="password"
            placeholder="API Key (sk-...)"
            value={newKey.key}
            onChange={(e) => setNewKey({ ...newKey, key: e.target.value })}
            className="form-input"
          />
          <input
            type="text"
            placeholder="Name (optional)"
            value={newKey.name}
            onChange={(e) => setNewKey({ ...newKey, name: e.target.value })}
            className="form-input"
          />
          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleAddKey}>
              Save Key
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShowAddForm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn-primary add-btn"
          onClick={() => setShowAddForm(true)}
        >
          + Add API Key
        </button>
      )}
    </div>
  );
};

export default KeysPage;
