import React from 'react';
import { createRoot } from 'react-dom/client';
import ReportApp from './ReportApp';
import '../../src/styles/report.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<ReportApp />);
}
