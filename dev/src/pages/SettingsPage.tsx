import React, { useState, useEffect } from 'react';
import { ExtensionSettings } from '../types';
import { getSettings, saveSettings, clearAllLocalData } from '../lib/storage';
import { DEFAULT_SETTINGS } from '../lib/defaults';

const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await getSettings();
      setSettings(data);
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      await saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  const handleClearData = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to clear all local data? This will delete all providers, API keys, and settings. This action cannot be undone.'
    );
    if (confirmed) {
      await clearAllLocalData();
      setSettings(DEFAULT_SETTINGS);
      alert('All data has been cleared. Please refresh the extension.');
    }
  };

  const updateSetting = <K extends keyof ExtensionSettings>(
    key: K,
    value: ExtensionSettings[K]
  ) => {
    setSettings({ ...settings, [key]: value });
  };

  if (loading) {
    return <div className="page-loading"><div className="spinner" /></div>;
  }

  return (
    <div className="page settings-page">
      <h2 className="page-title">Settings</h2>

      <div className="settings-section">
        <h3 className="section-title">Appearance</h3>
        <div className="setting-item">
          <label className="setting-label">Theme</label>
          <select
            className="form-select"
            value={settings.theme}
            onChange={(e) =>
              updateSetting('theme', e.target.value as ExtensionSettings['theme'])
            }
          >
            <option value="system">System Default</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="section-title">Behavior</h3>
        <div className="setting-item">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={settings.autoConnect}
              onChange={(e) => updateSetting('autoConnect', e.target.checked)}
            />
            Auto-connect on startup
          </label>
          <p className="setting-desc">
            Automatically test connectivity when the extension opens.
          </p>
        </div>
        <div className="setting-item">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={settings.showKeyPrefix}
              onChange={(e) => updateSetting('showKeyPrefix', e.target.checked)}
            />
            Show API key prefix
          </label>
          <p className="setting-desc">
            Display the first few characters of the API key (e.g., sk-****abcd).
          </p>
        </div>
      </div>

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={handleSave}>
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>

      <div className="settings-section danger-zone">
        <h3 className="section-title">Danger Zone</h3>
        <div className="setting-item">
          <button className="btn btn-danger" onClick={handleClearData}>
            Clear All Local Data
          </button>
          <p className="setting-desc">
            This will permanently delete all providers, API keys, and settings
            stored in chrome.storage.local.
          </p>
        </div>
      </div>

      <div className="settings-info">
        <h3 className="section-title">Storage Info</h3>
        <p className="info-text">
          All data is stored locally in your browser using chrome.storage.local.
          API keys are never uploaded to any server.
        </p>
        <p className="info-text">
          Storage quota: Approximately 10MB.
        </p>
      </div>
    </div>
  );
};

export default SettingsPage;
