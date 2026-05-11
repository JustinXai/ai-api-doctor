import React, { useState, useCallback } from 'react';
import { Wifi, Copy, Download, CheckCircle, XCircle, AlertCircle, Eye, Activity } from 'lucide-react';
import {
  getActiveProvider,
  getActiveApiKey,
  getSettings,
  testConnectivity,
  copyToClipboard,
} from '../lib/storage';
import { ConnectivityTestResult } from '../types';

interface QuickActionsProps {
  onNavigate: (page: 'models' | 'export') => void;
  onStatusUpdate: (status: 'unknown' | 'connected' | 'failed', latency: number | null) => void;
  onActiveModelChange: (id: string) => void;
}

const QuickActions: React.FC<QuickActionsProps> = ({
  onNavigate,
  onStatusUpdate,
}) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectivityTestResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const handleRunDiagnosis = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    onStatusUpdate('unknown', null);
    try {
      const provider = await getActiveProvider();
      const apiKey = await getActiveApiKey(provider?.id || '');
      if (!provider || !apiKey) {
        const result: ConnectivityTestResult = {
          success: false,
          error: {
            code: 'UNKNOWN_ERROR',
            message: 'Provider or API key not configured.',
          },
          timestamp: Date.now(),
        };
        setTestResult(result);
        onStatusUpdate('failed', null);
        return;
      }

      const settings = await getSettings();
      const modelId = settings.activeModelId || undefined;

      if (modelId) {
        const result = await testConnectivity(provider.baseUrl, apiKey.key, modelId);
        setTestResult(result);
        onStatusUpdate(result.success ? 'connected' : 'failed', result.latency ?? null);
      } else {
        const result = await testConnectivity(provider.baseUrl, apiKey.key);
        setTestResult({
          ...result,
          error: result.error
            ? {
                ...result.error,
                message:
                  result.error.message +
                  ' Select a model from the Models page to perform a full test.',
              }
            : undefined,
        });
        onStatusUpdate(result.success ? 'connected' : 'failed', result.latency ?? null);
      }
    } catch (error) {
      const result: ConnectivityTestResult = {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: Date.now(),
      };
      setTestResult(result);
      onStatusUpdate('failed', null);
    } finally {
      setTesting(false);
    }
  }, [onStatusUpdate]);

  const handleCopyConfig = useCallback(async () => {
    const provider = await getActiveProvider();
    if (provider) {
      copyToClipboard(provider.baseUrl);
      setCopied('config');
      setTimeout(() => setCopied(null), 2000);
    }
  }, []);

  const getPrimaryClass = () => {
    if (testing) return 'btn-primary-action testing';
    if (testResult?.success) return 'btn-primary-action success';
    if (testResult?.success === false) return 'btn-primary-action error';
    return 'btn-primary-action';
  };

  const getAlertKind = (): 'success' | 'error' | 'warning' | 'info' => {
    if (testing) return 'info';
    if (testResult?.success) return 'success';
    if (testResult?.success === false) {
      const code = testResult.error?.code;
      if (code === 'HTTP_401') return 'error';
      if (code === 'HTTP_403') return 'error';
      if (code === 'HTTP_429') return 'warning';
      if (code === 'NETWORK_ERROR') return 'warning';
      return 'error';
    }
    return 'info';
  };

  const getAlertIcon = () => {
    const kind = getAlertKind();
    const size = 10;
    if (kind === 'success') return <CheckCircle size={size} strokeWidth={2.5} />;
    if (kind === 'error') return <XCircle size={size} strokeWidth={2.5} />;
    if (kind === 'warning') return <AlertCircle size={size} strokeWidth={2.5} />;
    return <Activity size={size} strokeWidth={2.5} />;
  };

  const getAlertTitle = () => {
    if (testing) return 'Running diagnosis…';
    if (testResult?.success) {
      const parts = ['Connected'];
      if (testResult.activeModelId) parts.push(testResult.activeModelId);
      if (testResult.latency != null) parts.push(`${testResult.latency}ms`);
      return parts.join(' · ');
    }
    if (testResult?.success === false) {
      const code = testResult.error?.code;
      if (code === 'HTTP_401') return 'Authentication failed';
      if (code === 'HTTP_403') return 'Permission denied';
      if (code === 'HTTP_404') return 'Endpoint not found';
      if (code === 'HTTP_429') return 'Rate limited';
      if (code === 'NETWORK_ERROR') return 'Network error';
      if (code === 'MODELS_UNSUPPORTED') return 'Model listing unsupported';
      if (code === 'MODEL_ACCESS_DENIED') return 'Model access denied';
      return 'Connection failed';
    }
    return 'Not yet tested';
  };

  const getAlertDesc = () => {
    if (testing) return null;
    if (testResult?.success) return 'API endpoint is reachable and responding.';
    if (testResult?.success === false) {
      return testResult.error?.message ?? 'Unknown error';
    }
    return 'Click "Run Diagnosis" to test your configuration.';
  };

  return (
    <div className="quick-actions">
      {/* Diagnosis Result Alert */}
      <div className={`diagnosis-alert ${getAlertKind()}`}>
        <div className="diagnosis-alert-icon">
          {getAlertIcon()}
        </div>
        <div className="diagnosis-alert-body">
          <span className="diagnosis-alert-title">{getAlertTitle()}</span>
          {getAlertDesc() && (
            <span className="diagnosis-alert-desc">{getAlertDesc()}</span>
          )}
          {testResult?.error?.providerMessage && (
            <span className="diagnosis-alert-provider-msg">
              Provider: {testResult.error.providerMessage}
            </span>
          )}
        </div>
      </div>

      {/* Primary Action */}
      <button
        className={getPrimaryClass()}
        onClick={handleRunDiagnosis}
        disabled={testing}
      >
        {testing ? (
          <Wifi size={14} strokeWidth={2} style={{ opacity: 0.7 }} />
        ) : testResult?.success ? (
          <CheckCircle size={14} strokeWidth={2} />
        ) : testResult?.success === false ? (
          <XCircle size={14} strokeWidth={2} />
        ) : (
          <Activity size={14} strokeWidth={2} />
        )}
        {testing ? 'Running…' : testResult?.success ? 'Re-test' : testResult?.success === false ? 'Retry Diagnosis' : 'Run Diagnosis'}
      </button>

      {/* Quick Actions */}
      <div className="action-secondary-btns">
        <button
          className={`action-btn ${copied === 'config' ? 'copied' : ''}`}
          onClick={handleCopyConfig}
          title="Copy Base URL"
        >
          {copied === 'config' ? (
            <CheckCircle size={12} strokeWidth={2.5} />
          ) : (
            <Copy size={12} strokeWidth={2} />
          )}
          {copied === 'config' ? 'Copied!' : 'Copy URL'}
        </button>
        <button
          className="action-btn"
          onClick={() => onNavigate('models')}
          title="View Models"
        >
          <Eye size={12} strokeWidth={2} />
          Models
        </button>
        <button
          className="action-btn"
          onClick={() => onNavigate('export')}
          title="Export Config"
        >
          <Download size={12} strokeWidth={2} />
          Export
        </button>
      </div>
    </div>
  );
};

export default QuickActions;
