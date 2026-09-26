import { useState } from 'react';
import { authMode, roleOf, Snowflake, useSession } from './auth';
import { useI18n } from './i18n';
import { useLive } from './live';

// Views
import { OpsDashboardView } from './views/OpsDashboard';
import { SheltersView } from './views/SheltersView';
import { PeopleView } from './views/PeopleView';

export function App() {
  const { t, toggle } = useI18n();
  const { me, signOut } = useSession();
  const { connected, online } = useLive();
  const role = roleOf(me);
  
  const [currentView, setCurrentView] = useState('ops');

  // Simple Sidebar Navigation
  const navItems = [
    { id: 'ops', label: 'City Operations', icon: '📊' },
    { id: 'shelters', label: 'Shelters', icon: '🏢' },
    { id: 'people', label: 'People', icon: '👥' },
    { id: 'incidents', label: 'Incidents', icon: '🚨' },
  ];

  return (
    <div className={`app-shell role-${role}`}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <Snowflake />
          <span>Shelter Mesh</span>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button 
              key={item.id}
              className={`nav-item ${currentView === item.id ? 'active' : ''}`}
              onClick={() => setCurrentView(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <div className="search-bar">
            <span>🔍</span>
            <input type="text" className="search-input" placeholder="Search people, shelters, incidents..." />
            <span className="cmd-k">⌘K</span>
          </div>
          
          <div style={{ flex: 1 }} />
          
          <span className={`badge ${connected ? 'green' : 'amber'}`}>
            {connected ? '● Live Operations' : '○ Connecting...'}
          </span>
          
          <div className="flex-center gap-2 text-muted" style={{ fontSize: '0.875rem' }}>
            <div className="avatar">{me.name.charAt(0)}</div>
            {me.name}
          </div>
          
          <button className="btn btn-outline" onClick={signOut}>
            {authMode === 'dev' ? 'Switch Role' : 'Sign Out'}
          </button>
        </header>

        {/* View Content */}
        <div className="page-content">
          {currentView === 'ops' && <OpsDashboardView />}
          {currentView === 'shelters' && <SheltersView />}
          {currentView === 'people' && <PeopleView />}
          {currentView === 'incidents' && <div>Incidents View (WIP)</div>}
        </div>
      </main>
    </div>
  );
}
