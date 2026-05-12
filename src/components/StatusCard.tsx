import React from 'react';
import { Provider, ApiKey } from '../types';

interface StatusCardProps {
  provider: Provider | null;
  apiKey: ApiKey | null;
  maskedKey: string | null;
  activeModelId?: string | null;
  labels?: {
    notConfigured: string;
    provider: string;
    baseUrl: string;
    apiKey: string;
    notSet: string;
    activeModel: string;
    noModelSelected: string;
    exampleTag: string;
  };
}

const defaultLabels = {
  notConfigured: 'Not configured',
  provider: 'Provider',
  baseUrl: 'Base URL',
  apiKey: 'API Key',
  notSet: 'Not set',
  activeModel: 'Active Model',
  noModelSelected: 'No model selected',
  exampleTag: 'Example',
};

const StatusCard: React.FC<StatusCardProps> = ({
  provider,
  apiKey,
  maskedKey,
  activeModelId,
  labels = defaultLabels,
}) => {
  return (
    <div className="status-card">
      <div className="status-card-head">
        <div className="status-card-provider">
          {provider?.name || labels.notConfigured}
          {provider?.source === 'example' && (
            <span className="status-badge example-tag">{labels.exampleTag}</span>
          )}
        </div>
      </div>

      <div className="status-card-body">
        <div className="status-field">
          <span className="status-field-label">{labels.provider}</span>
          <span className="status-field-value">
            {provider?.name || <span className="status-field-value muted">{labels.notConfigured}</span>}
          </span>
        </div>

        <div className="status-field">
          <span className="status-field-label">{labels.baseUrl}</span>
          <span className="status-field-value mono">{provider?.baseUrl || 'N/A'}</span>
        </div>

        <div className="status-field">
          <span className="status-field-label">{labels.apiKey}</span>
          <span className={apiKey && maskedKey ? 'status-field-value key' : 'status-field-value muted'}>
            {apiKey && maskedKey ? maskedKey : labels.notSet}
          </span>
        </div>

        <div className="status-field">
          <span className="status-field-label">{labels.activeModel}</span>
          {activeModelId ? (
            <span className="status-field-value model">{activeModelId}</span>
          ) : (
            <span className="status-field-value muted">{labels.noModelSelected}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default StatusCard;
