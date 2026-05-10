import React, { useState, useEffect, useCallback } from 'react';
import { Provider, ApiKey } from '../../src/types';
import {
  getActiveProvider,
  getActiveApiKey,
  maskApiKey,
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

interface HomePageProps {
  onNavigate: (page: Page) => void;
  onRefresh: () => void;
}

const HomePage: React.FC<HomePageProps> = ({ onNavigate, onRefresh }) => {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [apiKey, setApiKey] = useState<ApiKey | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const activeProvider = await getActiveProvider();
      const activeKey = await getActiveApiKey(activeProvider?.id || '');
      setProvider(activeProvider);
      setApiKey(activeKey);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
      <QuickActions onRefresh={loadData} onNavigate={onNavigate} />
    </div>
  );
};

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('home');

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage onNavigate={setCurrentPage} onRefresh={() => {}} />;
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
        return <HomePage onNavigate={setCurrentPage} onRefresh={() => {}} />;
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
