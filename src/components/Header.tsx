import React from 'react';
import { FileSearch } from 'lucide-react';

const Header: React.FC = () => {
  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="header-logo">
          <FileSearch size={15} strokeWidth={2} />
        </div>
        <div className="header-titles">
          <h1 className="header-title">AI API Doctor</h1>
          <span className="header-subtitle">by Link-AI</span>
        </div>
      </div>
      <span className="header-badge">v0.2</span>
    </header>
  );
};

export default Header;
