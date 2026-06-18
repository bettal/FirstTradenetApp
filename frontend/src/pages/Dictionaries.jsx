import { useState, useEffect, useCallback } from 'react';
import GlassCard from '../components/GlassCard';
import GlassButton from '../components/GlassButton';
import { SkeletonCard } from '../components/Skeleton';
import { useApp } from '../context';
import { getDictionaries, getDictionaryEntries, refreshDictionary, getWallets } from '../api';

export default function Dictionaries() {
  const [dictionaries, setDictionaries] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [selectedWallet, setSelectedWallet] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedCode, setExpandedCode] = useState(null);
  const [entries, setEntries] = useState({});
  const [entriesLoading, setEntriesLoading] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  const { addToast } = useApp();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dicts, walletData] = await Promise.all([
        getDictionaries(),
        getWallets().catch(() => ({ wallets: [] })),
      ]);
      setDictionaries(Array.isArray(dicts) ? dicts : []);
      setWallets(Array.isArray(walletData.wallets) ? walletData.wallets : []);
    } catch (err) {
      console.error('Dictionaries load error:', err);
      setError('Failed to load: ' + (err.message || ''));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (wallets.length > 0 && !selectedWallet) {
      setSelectedWallet(String(wallets[0].id));
    }
  }, [wallets, selectedWallet]);

  const toggleExpand = useCallback(async (code) => {
    if (expandedCode === code) {
      setExpandedCode(null);
      return;
    }
    setExpandedCode(code);
    if (!entries[code]) {
      setEntriesLoading(prev => ({ ...prev, [code]: true }));
      try {
        const data = await getDictionaryEntries(code);
        setEntries(prev => ({ ...prev, [code]: Array.isArray(data.entries) ? data.entries : [] }));
      } catch {
        setEntries(prev => ({ ...prev, [code]: [] }));
      } finally {
        setEntriesLoading(prev => ({ ...prev, [code]: false }));
      }
    }
  }, [expandedCode, entries]);

  const handleRefresh = async (code) => {
    if (!selectedWallet) {
      addToast('Select a wallet first', 'warning');
      return;
    }
    try {
      const res = await refreshDictionary(code, selectedWallet);
      if (res.error) {
        addToast(res.error, 'error');
        return;
      }
      addToast('Entries refreshed', 'success');
      setEntries(prev => ({ ...prev, [code]: null }));
      setEntriesLoading(prev => ({ ...prev, [code]: true }));
      const data = await getDictionaryEntries(code);
      setEntries(prev => ({ ...prev, [code]: Array.isArray(data.entries) ? data.entries : [] }));
      setEntriesLoading(prev => ({ ...prev, [code]: false }));
    } catch {
      addToast('Network error', 'error');
    }
  };

  const handleRefreshAll = async () => {
    if (!selectedWallet) {
      addToast('Select a wallet first', 'warning');
      return;
    }
    if (!confirm('Fetch all dictionaries from Tradernet API? This may take some time.')) return;
    setRefreshing(true);
    for (const d of dictionaries) {
      try { await refreshDictionary(d.code, selectedWallet); } catch {}
    }
    setEntries({});
    setExpandedCode(null);
    addToast('All dictionaries refreshed', 'success');
    try {
      const updated = await getDictionaries();
      setDictionaries(Array.isArray(updated) ? updated : []);
    } catch {}
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header"><h1>API Dictionaries</h1><p>Loading...</p></div>
        <div className="grid-dict">{[1, 2, 3, 4, 5, 6].map(i => <SkeletonCard key={i} />)}</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>API Dictionaries</h1>
        <p>Reference data from Tradernet API</p>
      </div>

      {error && <div className="form-error mb-2">{error}</div>}

      <div className="flex items-center gap-2 mb-3" style={{ flexWrap: 'wrap' }}>
        <select className="glass-select" style={{ width: 'auto', minWidth: 200 }} value={selectedWallet} onChange={e => setSelectedWallet(e.target.value)}>
          <option value="">-- Select Wallet --</option>
          {wallets.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <GlassButton variant="secondary" size="sm" onClick={handleRefreshAll} disabled={refreshing || !selectedWallet}>
          {refreshing ? 'Refreshing...' : 'Refresh All'}
        </GlassButton>
      </div>

      {dictionaries.length === 0 ? (
        <GlassCard style={{ padding: '3rem', textAlign: 'center' }}>
          <p className="text-dim">No dictionaries found</p>
        </GlassCard>
      ) : (
        <div className="grid-dict">
          {dictionaries.map(d => {
            const isExpanded = expandedCode === d.code;
            const dictEntries = entries[d.code];
            const isLoadingEntries = entriesLoading[d.code];

            return (
              <GlassCard key={d.code} interactive onClick={() => toggleExpand(d.code)} style={{ padding: '1.25rem' }}>
                <div className="flex items-center gap-2 mb-2">
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, flex: 1 }}>{d.name}</h3>
                  <span className={`badge ${d.updated_at ? 'badge--success' : 'badge--warning'}`}>
                    {d.updated_at ? 'cached' : 'empty'}
                  </span>
                </div>

                <span className="badge badge--accent" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{d.endpoint}</span>

                {d.description && <p className="text-dim text-xs mt-1">{d.description}</p>}

                <div className="flex gap-3 mt-2 text-xs text-dim">
                  <span>{d.updated_at ? d.updated_at.replace('T', ' ').substring(0, 19) : 'never fetched'}</span>
                </div>

                {isExpanded && (
                  <div
                    style={{
                      margin: '1rem -1.25rem -1.25rem',
                      padding: '1rem 1.25rem',
                      background: 'rgba(0,0,0,0.25)',
                      borderTop: '1px solid var(--glass-border)',
                      borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
                      maxHeight: 350,
                      overflowY: 'auto',
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs text-dim">{dictEntries ? dictEntries.length : 0} entries</span>
                      <GlassButton variant="ghost" size="sm" onClick={() => handleRefresh(d.code)} disabled={!selectedWallet}>Refresh</GlassButton>
                    </div>

                    {isLoadingEntries ? (
                      <div className="text-dim text-xs" style={{ padding: '1rem 0' }}>Loading entries...</div>
                    ) : dictEntries && dictEntries.length > 0 ? (
                      dictEntries.map(e => (
                        <div key={e.id} className="flex items-center gap-2" style={{ padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.75rem' }}>
                          <span className="font-mono text-accent" style={{ minWidth: 80 }}>{e.code || '—'}</span>
                          <span style={{ flex: 1 }}>{e.name || '—'}</span>
                          <span className="text-dim truncate" style={{ maxWidth: 150 }} title={JSON.stringify(e.data)}>
                            {(JSON.stringify(e.data) || '').substring(0, 40)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-dim text-xs" style={{ padding: '1rem 0' }}>No entries cached. Click Refresh to fetch.</div>
                    )}
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
