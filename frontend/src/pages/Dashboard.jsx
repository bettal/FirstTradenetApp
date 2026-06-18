import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import GlassCard from '../components/GlassCard';
import GlassButton from '../components/GlassButton';
import { SkeletonCard } from '../components/Skeleton';
import { useApp } from '../context';
import { getWallets, deleteWallet, getWalletSecret } from '../api';
import ApiExplorer from './ApiExplorer';
import SlidePanel from '../components/SlidePanel';

export default function Dashboard() {
  const [wallets, setWallets] = useState([]);
  const [totpEnabled, setTotpEnabled] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showExplorer, setShowExplorer] = useState(false);
  const [explorerWallet, setExplorerWallet] = useState(null);
  const [showSecret, setShowSecret] = useState(false);
  const [secretData, setSecretData] = useState({ name: '', api_key: '', secret_key: '' });
  const [secretLoading, setSecretLoading] = useState(false);
  const [secretError, setSecretError] = useState('');

  const { addToast } = useApp();
  const { requireTfa } = useOutletContext();

  const loadWallets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getWallets();
      setWallets(Array.isArray(data.wallets) ? data.wallets : []);
      setTotpEnabled(!!data.totp_enabled);
    } catch (err) {
      if (err.message === 'UNAUTHORIZED') {
        window.location.href = '/login';
        return;
      }
      setError('Failed to load wallets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadWallets(); }, [loadWallets]);

  // Listen for wallets-changed event (from Layout panels)
  useEffect(() => {
    const handler = () => loadWallets();
    window.addEventListener('wallets-changed', handler);
    return () => window.removeEventListener('wallets-changed', handler);
  }, [loadWallets]);

  const handleDeleteWallet = async (wallet) => {
    if (!confirm(`Delete wallet "${wallet.name}"?`)) return;
    try {
      const res = await deleteWallet(wallet.id);
      if (res.error) {
        addToast(res.error, 'error');
      } else {
        addToast('Wallet deleted');
        loadWallets();
      }
    } catch {
      addToast('Network error', 'error');
    }
  };

  const openSecretKey = (wallet) => {
    requireTfa(async () => {
      setSecretData({ name: wallet.name, api_key: '', secret_key: '' });
      setSecretError('');
      setSecretLoading(true);
      setShowSecret(true);
      try {
        const res = await getWalletSecret(wallet.id);
        if (res.error) {
          setSecretError(res.error);
        } else {
          setSecretData({
            name: res.name || wallet.name,
            api_key: res.api_key || '',
            secret_key: res.secret_key || '',
          });
        }
      } catch {
        setSecretError('Failed to load secret');
      } finally {
        setSecretLoading(false);
      }
    });
  };

  const openWalletExplorer = (wallet) => {
    setExplorerWallet(wallet);
    setShowExplorer(true);
  };

  // Open edit wallet via Layout
  const openEditWallet = (wallet) => {
    requireTfa(() => {
      // Dispatch event to tell Layout to open edit panel
      window.dispatchEvent(new CustomEvent('open-edit-wallet', { detail: wallet }));
    });
  };

  const renderWalletCard = (wallet) => {
    const maskedKey = (wallet.api_key || '').substring(0, 8) + '••••••••••••';
    return (
      <GlassCard key={wallet.id} interactive onClick={() => openWalletExplorer(wallet)} style={{ padding: '1.5rem', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', display: 'flex', gap: '0.25rem' }} onClick={e => e.stopPropagation()}>
          <GlassButton variant="ghost" icon title="Show Secret Key" onClick={() => openSecretKey(wallet)}>
            <EyeIcon />
          </GlassButton>
          <GlassButton variant="ghost" icon title="Edit Wallet" onClick={() => openEditWallet(wallet)}>
            <EditIcon />
          </GlassButton>
          <GlassButton variant="ghost" icon title="Delete Wallet" onClick={() => handleDeleteWallet(wallet)} style={{ color: 'var(--error)' }}>
            <TrashIcon />
          </GlassButton>
        </div>

        <div style={{
          width: 48, height: 48, borderRadius: 'var(--radius-md)',
          background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem',
          color: 'var(--accent-light)',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
            <path d="M4 6v12c0 1.1.9 2 2 2h14v-4" />
            <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
          </svg>
        </div>

        <h3 style={{ fontSize: '1.0625rem', fontWeight: 600, marginBottom: '0.5rem' }}>{wallet.name || 'Unnamed'}</h3>

        <div className="flex items-center gap-2" style={{ marginBottom: '0.75rem' }}>
          <span className="status-dot status-dot--green" />
          <span className="text-dim text-xs">Tradernet API</span>
        </div>

        <div className="code-block" style={{ fontSize: '0.75rem', padding: '0.5rem 0.75rem' }}>
          {maskedKey}
        </div>

        {wallet.login && <div className="text-dim text-xs" style={{ marginTop: '0.5rem' }}>{wallet.login}</div>}

        <div className="text-accent text-xs text-center" style={{ marginTop: '1rem' }}>
          Click to open API Explorer →
        </div>
      </GlassCard>
    );
  };

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header"><h1>My Portfolios</h1><p>Loading...</p></div>
        <div className="grid-3">{[1, 2, 3].map(i => <SkeletonCard key={i} />)}</div>
      </div>
    );
  }

  if (totpEnabled === false) {
    return (
      <div className="page-container">
        <div className="page-header"><h1>My Portfolios</h1></div>
        <GlassCard style={{ padding: '3rem', textAlign: 'center', borderColor: 'rgba(239,68,68,0.3)' }}>
          <p style={{ fontWeight: 600, color: 'var(--error)', marginBottom: '0.5rem' }}>Security Alert</p>
          <p className="text-dim" style={{ marginBottom: '1.5rem' }}>
            You must enable Two-Factor Authentication (2FA) before connecting wallets.
          </p>
          <GlassButton onClick={() => window.dispatchEvent(new Event('open-security'))}>
            Enable Security
          </GlassButton>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>My Portfolios</h1>
        <p>{wallets.length} wallet{wallets.length !== 1 ? 's' : ''} connected</p>
      </div>

      {error && <div className="form-error text-center mb-2">{error}</div>}

      {wallets.length === 0 ? (
        <GlassCard style={{ padding: '3rem', textAlign: 'center' }}>
          <p className="text-dim" style={{ marginBottom: '1.5rem' }}>No wallets connected yet</p>
          <GlassButton onClick={() => window.dispatchEvent(new Event('open-add-wallet'))}>
            + Connect Wallet
          </GlassButton>
        </GlassCard>
      ) : (
        <div className="grid-3">
          {wallets.map(renderWalletCard)}
        </div>
      )}

      {/* Explorer panel */}
      <ApiExplorer open={showExplorer} onClose={() => setShowExplorer(false)} wallet={explorerWallet} />

      {/* Secret Key panel */}
      <SlidePanel open={showSecret} onClose={() => setShowSecret(false)} title="Secret Key">
        {secretLoading ? (
          <div className="text-dim text-sm" style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>
        ) : (
          <>
            <div className="form-group">
              <span className="form-label">Wallet Name</span>
              <div className="glass-input" style={{ cursor: 'default' }}>{secretData.name}</div>
            </div>
            <div className="form-group">
              <span className="form-label">API Key</span>
              <div className="code-block">{secretData.api_key}</div>
            </div>
            <div className="form-group">
              <span className="form-label">Secret Key</span>
              <div className="code-block" style={{ color: 'var(--accent-light)' }}>{secretData.secret_key}</div>
            </div>
            {secretError && <div className="form-error mb-2">{secretError}</div>}
            <GlassButton
              variant="secondary"
              style={{ width: '100%' }}
              onClick={() => {
                navigator.clipboard.writeText(secretData.secret_key).catch(() => {});
                addToast('Secret key copied');
              }}
            >
              Copy Secret Key
            </GlassButton>
          </>
        )}
      </SlidePanel>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
    </svg>
  );
}
