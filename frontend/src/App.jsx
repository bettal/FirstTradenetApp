import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useState, useEffect, useCallback, useRef } from 'react';
import ParticleBg from './components/ParticleBg';
import ToastContainer from './components/Toast';
import Navbar from './components/Navbar';
import ConnectWalletPanel from './components/ConnectWalletPanel';
import SecurityPanel from './pages/SecurityPanel';
import TfaVerifyPanel from './components/TfaVerifyPanel';
import { useApp } from './context';
import { getWallets } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Dictionaries from './pages/Dictionaries';

function Layout() {
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showTfa, setShowTfa] = useState(false);
  const [editWallet, setEditWallet] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const walletsRef = useRef({ wallets: [], totpEnabled: false });
  const { addToast } = useApp();

  // Load wallet info to know totpEnabled status
  const refreshWallets = useCallback(async () => {
    try {
      const data = await getWallets();
      walletsRef.current = { wallets: data.wallets || [], totpEnabled: !!data.totp_enabled };
    } catch {}
  }, []);

  useEffect(() => { refreshWallets(); }, [refreshWallets]);

  // Keep walletsRef in sync when wallets change
  useEffect(() => {
    const handler = () => refreshWallets();
    window.addEventListener('wallets-changed', handler);
    return () => window.removeEventListener('wallets-changed', handler);
  }, [refreshWallets]);

  // Stable event listeners
  useEffect(() => {
    const handleAddWallet = () => {
      if (walletsRef.current.totpEnabled) {
        setEditWallet(null);
        setShowAddWallet(true);
      } else {
        addToast('Enable 2FA first', 'warning');
      }
    };
    const handleSecurity = () => setShowSecurity(true);

    // Edit wallet: receive wallet data from Dashboard, open edit panel
    const handleEditWallet = (e) => {
      if (walletsRef.current.totpEnabled && e.detail) {
        setEditWallet(e.detail);
        setShowAddWallet(true);
      }
    };

    window.addEventListener('open-add-wallet', handleAddWallet);
    window.addEventListener('open-security', handleSecurity);
    window.addEventListener('open-edit-wallet', handleEditWallet);
    return () => {
      window.removeEventListener('open-add-wallet', handleAddWallet);
      window.removeEventListener('open-security', handleSecurity);
      window.removeEventListener('open-edit-wallet', handleEditWallet);
    };
  }, [addToast]);

  // TFA wrap: if an action needs TFA, show TFA panel, then execute on success
  const requireTfa = useCallback((action) => {
    setPendingAction(() => action);
    setShowTfa(true);
  }, []);

  const handleTfaVerified = useCallback(() => {
    if (pendingAction) pendingAction();
    setPendingAction(null);
  }, [pendingAction]);

  const handleWalletDone = useCallback(() => {
    // Notify Dashboard to reload wallets
    window.dispatchEvent(new Event('wallets-changed'));
  }, []);

  const handle2FAEnabled = useCallback(() => {
    window.dispatchEvent(new Event('wallets-changed'));
  }, []);

  return (
    <div className="app-layout">
      <div className="app-main">
        <Navbar />
        <Outlet context={{ requireTfa }} />
      </div>

      {/* Shared panels — always mounted in Layout */}
      <ConnectWalletPanel
        open={showAddWallet}
        onClose={() => setShowAddWallet(false)}
        onDone={handleWalletDone}
        editWallet={editWallet}
      />

      <SecurityPanel
        open={showSecurity}
        onClose={() => setShowSecurity(false)}
        on2FAEnabled={handle2FAEnabled}
      />

      <TfaVerifyPanel
        open={showTfa}
        onClose={() => { setShowTfa(false); setPendingAction(null); }}
        onVerified={handleTfaVerified}
      />
    </div>
  );
}

export default function App() {
  // Protect against back-button after logout (bfcache restore)
  useEffect(() => {
    const handlePageShow = (event) => {
      if (event.persisted && window.location.pathname !== '/login') {
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  return (
    <BrowserRouter>
      <ParticleBg />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/dictionaries" element={<Dictionaries />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      <ToastContainer />
    </BrowserRouter>
  );
}
