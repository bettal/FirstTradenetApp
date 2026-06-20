import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useState, useEffect, useCallback, useRef } from 'react';
import ParticleBg from './components/ParticleBg';
import ToastContainer from './components/Toast';
import Navbar from './components/Navbar';
import ConnectWalletPanel from './components/ConnectWalletPanel';
import SecurityPanel from './pages/SecurityPanel';
import TfaVerifyPanel from './components/TfaVerifyPanel';
import { useApp } from './context';
import { getWallets, fetchCSRF, verifyEmail } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Dictionaries from './pages/Dictionaries';
import Profile from './pages/Profile';
import GlassCard from './components/GlassCard';
import GlassButton from './components/GlassButton';

// ── Email Verification Page ──
function VerifyEmailPage() {
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) { setStatus('error'); setMessage('Missing verification token'); return; }
    verifyEmail(token).then(data => {
      if (data.error) { setStatus('error'); setMessage(data.error); }
      else { setStatus('success'); setMessage(data.message); }
    }).catch(() => { setStatus('error'); setMessage('Network error'); });
  }, []);

  return (
    <div className="page" style={{ maxWidth: 500, margin: '4rem auto', textAlign: 'center' }}>
      <GlassCard>
        {status === 'loading' && <p className="text-dim">Verifying your email...</p>}
        {status === 'success' && (
          <>
            <h3 style={{ color: 'var(--accent)' }}>Email Verified!</h3>
            <p className="text-dim" style={{ marginTop: '0.5rem' }}>{message}</p>
            <GlassButton onClick={() => window.location.href = '/profile'} style={{ marginTop: '1rem' }}>
              Go to Profile
            </GlassButton>
          </>
        )}
        {status === 'error' && (
          <>
            <h3 style={{ color: 'var(--danger)' }}>Verification Failed</h3>
            <p className="text-dim" style={{ marginTop: '0.5rem' }}>{message}</p>
            <GlassButton onClick={() => window.location.href = '/profile'} style={{ marginTop: '1rem' }}>
              Go to Profile
            </GlassButton>
          </>
        )}
      </GlassCard>
    </div>
  );
}

// ── Layout ──
function Layout() {
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showTfa, setShowTfa] = useState(false);
  const [editWallet, setEditWallet] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const walletsRef = useRef({ wallets: [], totpEnabled: false });
  const { addToast } = useApp();

  const refreshWallets = useCallback(async () => {
    try {
      const data = await getWallets();
      walletsRef.current = { wallets: data.wallets || [], totpEnabled: !!data.totp_enabled };
    } catch {}
  }, []);

  useEffect(() => { refreshWallets(); }, [refreshWallets]);
  useEffect(() => { fetchCSRF(); }, []);

  useEffect(() => {
    const handler = () => refreshWallets();
    window.addEventListener('wallets-changed', handler);
    return () => window.removeEventListener('wallets-changed', handler);
  }, [refreshWallets]);

  useEffect(() => {
    const handleAddWallet = () => {
      if (walletsRef.current.totpEnabled) {
        requireTfa(() => {
          setEditWallet(null);
          setShowAddWallet(true);
        });
      } else {
        addToast('Enable 2FA first', 'warning');
      }
    };
    const handleSecurity = () => setShowSecurity(true);
    const handleEditWallet = (e) => {
      if (walletsRef.current.totpEnabled && e.detail) {
        requireTfa(() => {
          setEditWallet(e.detail);
          setShowAddWallet(true);
        });
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

  const requireTfa = useCallback((action) => {
    setPendingAction(() => action);
    setShowTfa(true);
  }, []);

  const handleTfaVerified = useCallback(() => {
    if (pendingAction) pendingAction();
    setPendingAction(null);
  }, [pendingAction]);

  const handleWalletDone = useCallback(() => {
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
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/dictionaries" element={<Dictionaries />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      <ToastContainer />
    </BrowserRouter>
  );
}
