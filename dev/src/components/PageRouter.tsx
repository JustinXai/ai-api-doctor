import React from 'react';
import { Home, Cloud, KeyRound, Boxes, Download, Settings } from 'lucide-react';

export type Page = 'home' | 'providers' | 'keys' | 'models' | 'export' | 'settings';

interface PageRouterProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const NAV_ITEMS: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'home', label: 'Home', icon: <Home size={20} strokeWidth={1.75} /> },
  { page: 'providers', label: 'Providers', icon: <Cloud size={20} strokeWidth={1.75} /> },
  { page: 'keys', label: 'Keys', icon: <KeyRound size={20} strokeWidth={1.75} /> },
  { page: 'models', label: 'Models', icon: <Boxes size={20} strokeWidth={1.75} /> },
  { page: 'export', label: 'Export', icon: <Download size={20} strokeWidth={1.75} /> },
  { page: 'settings', label: 'Settings', icon: <Settings size={20} strokeWidth={1.75} /> },
];

const PageRouter: React.FC<PageRouterProps> = ({ currentPage, onNavigate }) => {
  return (
    <nav className="page-nav">
      {NAV_ITEMS.map(({ page, label, icon }) => (
        <button
          key={page}
          className={`nav-item ${currentPage === page ? 'active' : ''}`}
          onClick={() => onNavigate(page)}
          title={label}
        >
          <span className="nav-icon">{icon}</span>
          <span className="nav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
};

export default PageRouter;
