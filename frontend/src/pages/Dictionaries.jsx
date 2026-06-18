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
  const [selectedDict, setSelectedDict] = useState(null);
  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

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

  const loadEntries = useCallback(async (code) => {
    setEntriesLoading(true);
    setSearch('');
    try {
      const data = await getDictionaryEntries(code);
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  }, []);

  const handleSelectDict = (dict) => {
    setSelectedDict(dict);
    loadEntries(dict.code);
  };

  const handleRefresh = async () => {
    if (!selectedWallet || !selectedDict) {
      addToast('Select a wallet first', 'warning');
      return;
    }
    try {
      const res = await refreshDictionary(selectedDict.code, selectedWallet);
      if (res.error) {
        addToast(res.error, 'error');
        return;
      }
      addToast('Entries refreshed', 'success');
      loadEntries(selectedDict.code);
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
    addToast('All dictionaries refreshed', 'success');
    try {
      const updated = await getDictionaries();
      setDictionaries(Array.isArray(updated) ? updated : []);
    } catch {}
    setRefreshing(false);
    if (selectedDict) loadEntries(selectedDict.code);
  };

  const filteredEntries = search
    ? entries.filter(e =>
        (e.code || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.name || '').toLowerCase().includes(search.toLowerCase()) ||
        JSON.stringify(e.data || {}).toLowerCase().includes(search.toLowerCase())
      )
    : entries;

  const formatData = (data) => {
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return '—';
    try {
      const s = JSON.stringify(data, null, 2);
      return s.length > 200 ? s.substring(0, 200) + '…' : s;
    } catch { return String(data); }
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

      {/* Toolbar */}
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

      {/* Two-column layout: sidebar + table */}
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
        {/* Left sidebar: dictionary list */}
        <div style={{ width: 240, flexShrink: 0 }}>
          <GlassCard style={{ padding: '0.5rem' }}>
            <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Dictionaries ({dictionaries.length})
            </div>
            {dictionaries.map(d => {
              const isActive = selectedDict?.code === d.code;
              return (
                <div
                  key={d.code}
                  onClick={() => handleSelectDict(d)}
                  style={{
                    padding: '0.65rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    margin: '0.125rem 0',
                    background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
                    borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ fontSize: '0.8125rem', fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--text-main)' : 'var(--text-muted)' }}>
                    {d.name}
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-dim)', marginTop: '0.125rem', fontFamily: 'JetBrains Mono, monospace' }}>
                    {d.endpoint}
                  </div>
                </div>
              );
            })}
          </GlassCard>
        </div>

        {/* Right content: table */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedDict ? (
            <GlassCard style={{ padding: '3rem', textAlign: 'center' }}>
              <p className="text-dim">Select a dictionary from the list</p>
            </GlassCard>
          ) : (
            <GlassCard style={{ overflow: 'hidden' }}>
              {/* Table header */}
              <div className="flex items-center justify-between" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--glass-border)' }}>
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{selectedDict.name}</h3>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
                    <span className="badge badge--accent" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{selectedDict.endpoint}</span>
                    {selectedDict.description && <span style={{ marginLeft: '0.5rem' }}>{selectedDict.description}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-dim">{entries.length} entries</span>
                  <GlassButton variant="ghost" size="sm" onClick={handleRefresh} disabled={!selectedWallet}>
                    Refresh
                  </GlassButton>
                </div>
              </div>

              {/* Search */}
              <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--glass-border)' }}>
                <input
                  type="text"
                  className="glass-input"
                  placeholder="Search entries by code, name or data..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ fontSize: '0.8125rem', padding: '0.5rem 0.75rem' }}
                />
              </div>

              {/* Table body */}
              <div style={{ maxHeight: 'calc(100vh - 320px)', minHeight: 300, overflowY: 'auto' }}>
                {entriesLoading ? (
                  <div className="text-dim text-sm" style={{ padding: '2rem', textAlign: 'center' }}>Loading entries...</div>
                ) : filteredEntries.length === 0 ? (
                  <div className="text-dim text-sm" style={{ padding: '2rem', textAlign: 'center' }}>
                    {search ? 'No matching entries' : 'No entries cached. Click Refresh to fetch from API.'}
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                        <th style={thStyle}>Code</th>
                        <th style={thStyle}>Name</th>
                        <th style={thStyle}>Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.map((e, i) => {
                        const dataStr = formatData(e.data);
                        const isLast = i === filteredEntries.length - 1;
                        return (
                          <tr
                            key={e.id}
                            style={{
                              borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.04)',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.04)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <td style={tdCodeStyle}>
                              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-light)' }}>
                                {e.code || '—'}
                              </span>
                            </td>
                            <td style={tdNameStyle}>{e.name || '—'}</td>
                            <td style={tdDataStyle}>
                              <span
                                title={JSON.stringify(e.data || {})}
                                style={{
                                  fontFamily: 'JetBrains Mono, monospace',
                                  fontSize: '0.75rem',
                                  color: 'var(--text-muted)',
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                }}
                              >
                                {dataStr}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  padding: '0.625rem 1rem',
  textAlign: 'left',
  fontSize: '0.6875rem',
  fontWeight: 600,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--glass-border)',
};

const tdCodeStyle = {
  padding: '0.5rem 1rem',
  fontSize: '0.8125rem',
  verticalAlign: 'top',
  minWidth: 100,
};

const tdNameStyle = {
  padding: '0.5rem 1rem',
  fontSize: '0.8125rem',
  verticalAlign: 'top',
  minWidth: 140,
};

const tdDataStyle = {
  padding: '0.5rem 1rem',
  fontSize: '0.8125rem',
  verticalAlign: 'top',
};
