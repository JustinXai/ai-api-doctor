import React, { useState, useEffect } from 'react';
import { Provider } from '../types';
import {
  getProviders,
  saveProviders,
  addProvider,
  deleteProvider,
  setActiveProvider,
} from '../lib/storage';
import { generateId } from '../lib/storage';

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
    // Update enabled status
    const updated = providers.map((p) => ({
      ...p,
      enabled: p.id === id,
    }));
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

  const handleDeleteProvider = async (id: string) => {
    const provider = providers.find((p) => p.id === id);
    if (provider?.recommended) {
      alert('Cannot delete the recommended provider.');
      return;
    }
    await deleteProvider(id);
    setProviders(providers.filter((p) => p.id !== id));
  };

  if (loading) {
    return <div className="page-loading"><div className="spinner" /></div>;
  }

  return (
    <div className="page providers-page">
      <h2 className="page-title">Providers</h2>

      <div className="provider-list">
        {providers.map((provider) => (
          <div
            key={provider.id}
            className={`provider-item ${activeId === provider.id ? 'active' : ''}`}
          >
            <div className="provider-info">
              <div className="provider-name">
                {provider.name}
                {provider.recommended && (
                  <span className="badge recommended">Recommended</span>
                )}
              </div>
              <div className="provider-url">{provider.baseUrl}</div>
            </div>
            <div className="provider-actions">
              <button
                className={`btn ${activeId === provider.id ? 'btn-active' : 'btn-primary'}`}
                onClick={() => handleSetActive(provider.id)}
                disabled={activeId === provider.id}
              >
                {activeId === provider.id ? 'Active' : 'Set Active'}
              </button>
              {!provider.recommended && (
                <button
                  className="btn btn-danger"
                  onClick={() => handleDeleteProvider(provider.id)}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showAddForm ? (
        <div className="add-form">
          <input
            type="text"
            placeholder="Provider Name"
            value={newProvider.name}
            onChange={(e) =>
              setNewProvider({ ...newProvider, name: e.target.value })
            }
            className="form-input"
          />
          <input
            type="url"
            placeholder="Base URL (e.g., https://api.example.com/v1)"
            value={newProvider.baseUrl}
            onChange={(e) =>
              setNewProvider({ ...newProvider, baseUrl: e.target.value })
            }
            className="form-input"
          />
          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleAddProvider}>
              Add Provider
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
          + Add Custom Provider
        </button>
      )}
    </div>
  );
};

export default ProvidersPage;
