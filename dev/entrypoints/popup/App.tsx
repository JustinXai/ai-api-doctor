import React, { useState, useEffect } from 'react';
import { Provider, ApiKey } from '../../src/types';
import {
  getActiveProvider,
  getActiveApiKey,
  maskApiKey,
  testConnectivity,
} from '../../src/lib/storage';
import Header from '../../src/components/Header';
import StatusCard from '../../src/components/StatusCard';
import QuickActions from '../../src/components/QuickActions';
import PageRouter, { Page } from '../../src/components/PageRouter';
import ProvidersPage from '../../src/pages/ProvidersPage';
import KeysPage from '../../src/pages/KeysPage';
import ModelsPage from '../../src/pages/ModelsPage';
import ExportPage from '../../src/pages/ExportPage';
import SettingsPage from '../../src/pages/SettingsPage';

const HomePage: React.FC = () => {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [apiKey, setApiKey] = useState<ApiKey | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [activeProvider, activeKey] = await Promise.all([
        getActiveProvider(),
        getActiveApiKey((await getActiveProvider())?.id || ''),
      ]);
      setProvider(activeProvider);
      setApiKey(activeKey);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="home-page">
      <StatusCard
        provider={provider}
        apiKey={apiKey}
        maskedKey={apiKey ? maskApiKey(apiKey.key) : null}
      />
      <QuickActions onRefresh={loadData} />
    </div>
  );
};

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('home');

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage />;
      case 'providers':
        return <ProvidersPage />;
      case 'keys':
        return <KeysPage />;
      case 'models':
        return <ModelsPage />;
      case 'export':
        return <ExportPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <HomePage />;
    }
  };

  return (
    <div className="app">
      <Header />
      <main className="main-content">{renderPage()}</main>
      <PageRouter currentPage={currentPage} onNavigate={setCurrentPage} />
    </div>
  );
};

export default App;
