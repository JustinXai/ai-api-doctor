import React, { useState, useEffect } from 'react';
import { Provider } from '../types';
import {
  getProviders,
  saveProviders,
  addProvider,
  addExampleProvider,
  deleteProvider,
  setActiveProvider,
  generateId,
} from '../lib/storage';
import { Plus, Trash2, CheckCircle, Lightbulb } from 'lucide-react';

const ProvidersPage: React.FC = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState({ name: '', baseUrl: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      const data = await getProviders();
      const active = data.find((p) => p.enabled) || data[0];
      setProviders(data);
      setActiveId(active?.id || '');
    } catch (error) {
      console.error('Failed to load providers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSetActive = async (id: string) => {
    await setActiveProvider(id);
    setActiveId(id);
    const updated = providers.map((p) => ({ ...p, enabled: p.id === id }));
    setProviders(updated);
    await saveProviders(updated);
  };

  const handleAddProvider = async () => {
    if (!newProvider.name || !newProvider.baseUrl) return;
    const provider: Provider = {
      id: generateId(),
      name: newProvider.name,
      baseUrl: newProvider.baseUrl.endsWith('/v1')
        ? newProvider.baseUrl
        : `${newProvider.baseUrl}/v1`,
      enabled: false,
    };
    await addProvider(provider);
    setProviders([...providers, provider]);
    setNewProvider({ name: '', baseUrl: '' });
    setShowAddForm(false);
  };

  const handleAddExample = async () => {
    const p = await addExampleProvider();
    await loadProviders();
    await setActiveProvider(p.id);
    setActiveId(p.id);
  };

  const handleDeleteProvider = async (id: string) => {
    const provider = providers.find((p) => p.id === id);
    if (!confirm(`Delete provider "${provider?.name}"?`)) return;
    await deleteProvider(id);
    setProviders(providers.filter((p) => p.id !== id));
  };

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
        <h2 className="page-title">Providers</h2>
      </div>

      <div className="provider-list">
        {providers.map((provider) => {
          const isActive = activeId === provider.id;
          return (
            <div
              key={provider.id}
              className={`list-card ${isActive ? 'active' : ''}`}
            >
              <div className="list-card-head">
                <div className="list-card-name">
                  {provider.name}
                  {provider.source === 'example' && (
                    <span className="badge example-tag-badge">Example</span>
                  )}
                  {isActive && (
                    <span className="badge active-tag">Active</span>
                  )}
                </div>
              </div>
              <div className="list-card-meta">{provider.baseUrl}</div>
              <div className="list-card-actions">
                {isActive ? (
                  <span className="btn-active-label">
                    <CheckCircle size={11} strokeWidth={2.5} />
                    Active
                  </span>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={() => handleSetActive(provider.id)}
                  >
                    Set Active
                  </button>
                )}
                <button
                  className="btn btn-danger"
                  onClick={() => handleDeleteProvider(provider.id)}
                >
                  <Trash2 size={11} strokeWidth={2} />
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showAddForm ? (
        <div className="add-form">
          <input
            type="text"
            placeholder="Provider Name"
            value={newProvider.name}
            onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })}
            className="form-input"
          />
          <input
            type="url"
            placeholder="Base URL (e.g., https://api.example.com/v1)"
            value={newProvider.baseUrl}
            onChange={(e) => setNewProvider({ ...newProvider, baseUrl: e.target.value })}
            className="form-input"
          />
          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleAddProvider}>
              Add Provider
            </button>
            <button className="btn btn-secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="provider-add-btns">
          <button className="btn btn-primary add-btn" onClick={() => setShowAddForm(true)}>
            <Plus size={13} strokeWidth={2} />
            Add Custom Provider
          </button>
          <button className="btn btn-ghost" onClick={handleAddExample}>
            <Lightbulb size={11} strokeWidth={2} />
            Add Example Provider
          </button>
        </div>
      )}
    </div>
  );
};

export default ProvidersPage;
