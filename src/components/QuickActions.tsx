import React, { useState } from 'react';
import {
  getActiveProvider,
  getActiveApiKey,
  testConnectivity,
  copyToClipboard,
} from '../lib/storage';
import { ConnectivityTestResult } from '../types';

interface QuickActionsProps {
  onRefresh: () => void;
}

const QuickActions: React.FC<QuickActionsProps> = ({ onRefresh }) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectivityTestResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const handleTestConnectivity = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const provider = await getActiveProvider();
      const apiKey = await getActiveApiKey(provider?.id || '');
      if (!provider || !apiKey) {
        setTestResult({
          success: false,
          error: 'Provider or API key not configured',
          timestamp: Date.now(),
        });
        return;
      }
      const result = await testConnectivity(provider.baseUrl, apiKey.key);
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleCopyBaseUrl = async () => {
    const provider = await getActiveProvider();
    if (provider) {
      copyToClipboard(provider.baseUrl);
      setCopied('url');
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const handleViewModels = () => {
    // Navigation handled by parent
  };

  const handleExportConfig = () => {
    // Navigation handled by parent
  };

  return (
    <div className="quick-actions">
      <h3 className="section-title">Quick Actions</h3>
      <div className="action-buttons">
        <button
          className={`action-btn ${testResult?.success ? 'success' : ''} ${testResult?.success === false ? 'error' : ''}`}
          onClick={handleTestConnectivity}
          disabled={testing}
        >
          {testing ? 'Testing...' : 'Test Connectivity'}
        </button>
        <button className="action-btn" onClick={handleViewModels}>
          View Models
        </button>
        <button className="action-btn" onClick={handleCopyBaseUrl}>
          {copied === 'url' ? 'Copied!' : 'Copy Base URL'}
        </button>
        <button className="action-btn" onClick={handleExportConfig}>
          Export Config
        </button>
      </div>
      {testResult && (
        <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
          {testResult.success ? (
            <>
              <span className="result-icon">✓</span>
              <span>Connected! Latency: {testResult.latency}ms</span>
            </>
          ) : (
            <>
              <span className="result-icon">✗</span>
              <span>{testResult.error}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default QuickActions;
