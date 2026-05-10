export type Page = 'home' | 'providers' | 'keys' | 'models' | 'export' | 'settings';

interface PageRouterProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const PageRouter: React.FC<PageRouterProps> = ({ currentPage, onNavigate }) => {
  const navItems: { page: Page; label: string; icon: string }[] = [
    { page: 'home', label: 'Home', icon: '🏠' },
    { page: 'providers', label: 'Providers', icon: '☁️' },
    { page: 'keys', label: 'Keys', icon: '🔑' },
    { page: 'models', label: 'Models', icon: '🤖' },
    { page: 'export', label: 'Export', icon: '📤' },
    { page: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <nav className="page-nav">
      {navItems.map(({ page, label, icon }) => (
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
