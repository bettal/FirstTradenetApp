import { NavLink } from 'react-router-dom';
import { logout } from '../api';
import GlassButton from './GlassButton';

export default function Navbar() {
  const handleAddWallet = () => window.dispatchEvent(new Event('open-add-wallet'));

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        <span>Tradernet</span>
        <span className="badge badge--accent" style={{ marginLeft: '0.5rem' }}>BETA</span>
      </div>
      <div className="navbar-actions">
        <NavLink to="/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}>Dashboard</NavLink>
        <NavLink to="/dictionaries" className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}>Dictionaries</NavLink>
        <NavLink to="/profile" className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}>Profile</NavLink>
        <GlassButton variant="ghost" size="sm" onClick={handleAddWallet}>+ Wallet</GlassButton>
        <GlassButton variant="ghost" size="sm" onClick={logout}>Logout</GlassButton>
      </div>
    </nav>
  );
}
