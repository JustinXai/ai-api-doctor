import React from 'react';
import { Provider, ApiKey } from '../types';

interface StatusCardProps {
  provider: Provider | null;
  apiKey: ApiKey | null;
  maskedKey: string | null;
}

const StatusCard: React.FC<StatusCardProps> = ({ provider, apiKey, maskedKey }) => {
  return (
    <div className="status-card">
      <div className="status-row">
        <span className="status-label">Provider</span>
        <span className="status-value">{provider?.name || 'Not configured'}</span>
      </div>
      <div className="status-row">
        <span className="status-label">Base URL</span>
        <span className="status-value status-url" title={provider?.baseUrl}>
          {provider?.baseUrl || 'N/A'}
        </span>
      </div>
      <div className="status-row">
        <span className="status-label">API Key</span>
        <span className="status-value status-key">
          {apiKey ? maskedKey : 'Not set'}
        </span>
      </div>
      {provider?.recommended && (
        <div className="status-badge recommended">Recommended</div>
      )}
    </div>
  );
};

export default StatusCard;
