import React, { useState, useEffect, useCallback } from 'react';
import { ApiKey } from '../types';
import {
  getApiKeys,
  addApiKey,
  deleteApiKey,
  getActiveProvider,
  maskApiKey,
  generateId,
} from '../lib/storage';
import { Plus, Trash2, Copy, CheckCircle } from 'lucide-react';

const KeysPage: React.FC = () => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newKey, setNewKey] = useState({ key: '', name: '' });
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [apiKeys, provider] = await Promise.all([getApiKeys(), getActiveProvider()]);
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
    if (!confirm('Delete this API key?')) return;
    await deleteApiKey(id);
    setKeys(keys.filter((k) => k.id !== id));
  };

  const handleCopyKey = useCallback(async (key: ApiKey) => {
    try {
      await navigator.clipboard.writeText(key.key);
      setCopiedId(key.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      alert('Failed to copy API key');
    }
  }, []);

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <span className="page-loading-text">Loading…</span>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">API Keys</h2>
      </div>

      {/* Privacy Info Box */}
      <div className="info-box">
        <div className="info-box-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </div>
        <span>
          API keys are stored locally in your browser via <code>chrome.storage.local</code>. They are never uploaded to any server.
        </span>
      </div>

      <div className="keys-list">
        {keys.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
            </div>
            <span className="empty-state-text">No API keys saved yet.</span>
            <span className="empty-state-hint">Add one below to get started.</span>
          </div>
        ) : (
          keys.map((key) => (
            <div key={key.id} className="list-card">
              <div className="list-card-head">
                <div className="key-card-name">
                  {key.name || 'Unnamed Key'}
                  {key.providerId === activeProviderId && (
                    <span className="badge active-tag">Active</span>
                  )}
                </div>
              </div>
              <div className="key-card-key">{maskApiKey(key.key)}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <span className="key-card-date">
                  Added {new Date(key.createdAt).toLocaleDateString()}
                </span>
                <div className="list-card-actions" style={{ marginTop: 0 }}>
                  <button
                    className={`btn btn-ghost ${copiedId === key.id ? 'copied' : ''}`}
                    onClick={() => handleCopyKey(key)}
                    style={{ height: 28, fontSize: 11 }}
                  >
                    {copiedId === key.id ? (
                      <><CheckCircle size={10} strokeWidth={2.5} /> Copied!</>
                    ) : (
                      <><Copy size={10} strokeWidth={2} /> Copy</>
                    )}
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDeleteKey(key.id)}
                  >
                    <Trash2 size={11} strokeWidth={2} />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showAddForm ? (
        <div className="add-form">
          <input
            type="password"
            placeholder="API Key (sk-…)"
            value={newKey.key}
            onChange={(e) => setNewKey({ ...newKey, key: e.target.value })}
            className="form-input"
          />
          <input
            type="text"
            placeholder="Name (optional, e.g. Production)"
            value={newKey.name}
            onChange={(e) => setNewKey({ ...newKey, name: e.target.value })}
            className="form-input"
          />
          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleAddKey}>
              Save Key
            </button>
            <button className="btn btn-secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-primary add-btn" onClick={() => setShowAddForm(true)}>
          <Plus size={13} strokeWidth={2} />
          Add API Key
        </button>
      )}
    </div>
  );
};

export default KeysPage;
