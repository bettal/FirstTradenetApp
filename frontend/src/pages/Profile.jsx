import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import GlassCard from '../components/GlassCard';
import GlassInput from '../components/GlassInput';
import GlassButton from '../components/GlassButton';
import { getProfile, changePassword, setEmail, setup2FA, confirm2FA, reset2FA } from '../api';
import { useApp } from '../context';

const TABS = [
  { id: 'account', label: 'Account', icon: 'user' },
  { id: 'security', label: 'Security', icon: 'lock' },
  { id: 'email', label: 'Email', icon: 'mail' },
];

const SvgIcon = ({ name, size = 20, ...props }) => {
  const icons = {
    user:   <><path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' /><circle cx='12' cy='7' r='4' /></>,
    lock:   <><rect x='3' y='11' width='18' height='11' rx='2' ry='2' /><path d='M7 11V7a5 5 0 0 1 10 0v4' /></>,
    mail:   <><rect x='2' y='4' width='20' height='16' rx='2' /><path d='m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' /></>,
    shield: <path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' />,
    check:  <path d='M20 6 9 17l-5-5' />,
    key:    <path d='m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4' />,
    phone:  <path d='M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z' />,
    copy:   <><rect x='9' y='9' width='13' height='13' rx='2' ry='2' /><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' /></>,
    alert:  <><path d='m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z' /><line x1='12' y1='9' x2='12' y2='13' /><line x1='12' y1='17' x2='12.01' y2='17' /></>,
    qrcode: <><rect x='3' y='3' width='7' height='7' rx='1' /><rect x='14' y='3' width='7' height='7' rx='1' /><rect x='3' y='14' width='7' height='7' rx='1' /><path d='M14 14h3v3m0-7v4m0 3h-3m4 0h3' /></>,
    badge:  <path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      {icons[name]}
    </svg>
  );
};

export default function Profile() {
  const location = useLocation();
  const isNewUser = location.state?.newUser;
  const { addToast } = useApp();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(isNewUser ? 'security' : 'account');

  // ── 2FA ──
  const [tfaStep, setTfaStep] = useState('idle');
  const [setupUri, setSetupUri] = useState('');
  const [tfaCode, setTfaCode] = useState('');
  const [tfaError, setTfaError] = useState('');
  const qrRef = useRef(null);

  // ── Password ──
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  // ── Email ──
  const [email, setEmailState] = useState('');
  const [emailMsg, setEmailMsg] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  // ── Reset 2FA ──
  const [showReset2FA, setShowReset2FA] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const data = await getProfile();
      if (data.error) { addToast(data.error, 'error'); return; }
      setProfile(data);
      if (data.email) setEmailState(data.email);
      if (!data.totp_enabled) setTfaStep('idle');
    } catch { addToast('Failed to load profile', 'error'); }
    finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // ── 2FA ──
  const handleEnable2FA = async () => {
    setTfaError(''); setSaving(true);
    try {
      const data = await setup2FA();
      if (data.error) { setTfaError(data.error); } else {
        setSetupUri(data.setupUri); setTfaStep('setup');
        setTimeout(() => {
          if (qrRef.current && window.QRCode) {
            qrRef.current.innerHTML = '';
            new window.QRCode(qrRef.current, { text: data.setupUri, width: 180, height: 180, colorDark: '#000', colorLight: '#fff', correctLevel: window.QRCode.CorrectLevel.M });
          }
        }, 100);
      }
    } catch { setTfaError('Network error'); }
    finally { setSaving(false); }
  };

  const handleConfirm2FA = async (e) => {
    e.preventDefault(); setTfaError(''); setSaving(true);
    try {
      const data = await confirm2FA(tfaCode);
      if (data.error) { setTfaError(data.error); } else {
        addToast('2FA enabled', 'success');
        setTfaStep('done'); setTfaCode('');
        setProfile(p => ({ ...p, totp_enabled: true }));
      }
    } catch { setTfaError('Network error'); }
    finally { setSaving(false); }
  };

  const handleReset2FA = async (e) => {
    e.preventDefault(); setResetError(''); setResetLoading(true);
    try {
      const data = await reset2FA(resetPassword);
      if (data.error) { setResetError(data.error); } else {
        addToast('2FA reset — set up a new authenticator', 'success');
        setShowReset2FA(false); setResetPassword(''); setResetError('');
        setTfaStep('idle'); setTfaCode('');
        setProfile(p => ({ ...p, totp_enabled: false }));
      }
    } catch { setResetError('Network error'); }
    finally { setResetLoading(false); }
  };

  // ── Password ──
  const handlePasswordChange = async (e) => {
    e.preventDefault(); setPwError(''); setPwSuccess('');
    if (!currentPw || !newPw || !confirmPw) { setPwError('All fields are required'); return; }
    if (newPw.length < 8) { setPwError('Password must be at least 8 characters'); return; }
    if (!/[A-Z]/.test(newPw)) { setPwError('Password must contain an uppercase letter'); return; }
    if (!/[a-z]/.test(newPw)) { setPwError('Password must contain a lowercase letter'); return; }
    if (!/[0-9]/.test(newPw)) { setPwError('Password must contain a digit'); return; }
    if (newPw !== confirmPw) { setPwError('Passwords do not match'); return; }
    setSaving(true);
    try {
      const data = await changePassword(currentPw, newPw);
      if (data.error) { setPwError(data.error); } else {
        setPwSuccess(data.message || 'Password changed successfully.'); setCurrentPw(''); setNewPw(''); setConfirmPw('');
        addToast('Password changed', 'success');
      }
    } catch { setPwError('Network error'); }
    finally { setSaving(false); }
  };

  // ── Email ──
  const handleEmailSave = async (e) => {
    e.preventDefault(); setEmailMsg('');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEmailMsg('Please enter a valid email'); return; }
    setEmailLoading(true);
    try {
      const data = await setEmail(email);
      if (data.error) { setEmailMsg(data.error); } else {
        setEmailMsg('Verification link sent — check your inbox.');
        setProfile(p => ({ ...p, email, email_verified: false }));
      }
    } catch { setEmailMsg('Network error'); }
    finally { setEmailLoading(false); }
  };

  // ── Avatar initials ──
  const initials = profile?.phone ? profile.phone.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() || 'U' : 'U';

  if (loading) return <div className="page"><div className="page-container"><p className="text-dim">Loading...</p></div></div>;
  if (!profile) return <div className="page"><div className="page-container"><p className="text-dim">Profile not available</p></div></div>;

  const is2FAEnabled = profile.totp_enabled;
  const isEmailVerified = profile.email_verified;
  const hasEmail = !!profile.email;

  const statusColor = is2FAEnabled && isEmailVerified ? 'var(--success)' : is2FAEnabled || isEmailVerified ? 'var(--warning)' : 'var(--error)';
  const statusLabel = is2FAEnabled && isEmailVerified ? 'Secure' : 'Needs attention';

  return (
    <div className="page">
      <div className="page-container" style={{ maxWidth: 960 }}>
        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '2rem',
          padding: '1.5rem', background: 'var(--glass-bg)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--glass-border)',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent), var(--purple))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.25rem', fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.15rem' }}>{profile.phone}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="status-dot" style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
              <span className="text-sm" style={{ color: statusColor }}>{statusLabel}</span>
            </div>
          </div>
          {isNewUser && (
            <span className="badge badge--accent" style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}>
              New account
            </span>
          )}
        </div>

        {/* ── New user banner ── */}
        {isNewUser && (
          <GlassCard style={{
            marginBottom: '1.5rem', padding: '1rem 1.25rem',
            borderColor: 'rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.06)',
            display: 'flex', alignItems: 'center', gap: '0.75rem',
          }}>
            <SvgIcon name="alert" size={18} style={{ color: 'var(--accent-light)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <p className="text-sm" style={{ color: 'var(--accent-light)', fontWeight: 500 }}>Welcome! Set up your account</p>
              <p className="text-dim text-xs">Enable 2FA and verify your email to access all features.</p>
            </div>
          </GlassCard>
        )}

        {/* ── Content: sidebar + main ── */}
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
          {/* Sidebar */}
          <GlassCard style={{
            width: 200, flexShrink: 0, padding: '0.75rem',
            position: 'sticky', top: '5rem',
          }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%',
                  padding: '0.6rem 0.75rem', marginBottom: '0.25rem',
                  borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent',
                  color: activeTab === tab.id ? 'var(--accent-light)' : 'var(--text-muted)',
                  fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                  ...(activeTab === tab.id ? { background: 'rgba(99,102,241,0.08)' } : {}),
                }}
              >
                <SvgIcon name={tab.icon} size={16} />
                {tab.label}
              </button>
            ))}
          </GlassCard>

          {/* Main content */}
          <div style={{ flex: 1, minWidth: 0 }}>

            {/* ── Account tab ── */}
            {activeTab === 'account' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <GlassCard style={{ padding: '1.5rem' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <SvgIcon name="user" size={18} style={{ color: 'var(--accent-light)' }} />
                    <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Account details</h3>
                  </div>
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    <div className="flex items-center justify-between" style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--glass-border)' }}>
                      <div className="flex items-center gap-2">
                        <SvgIcon name="phone" size={14} style={{ color: 'var(--text-dim)' }} />
                        <span className="text-sm text-muted">Phone</span>
                      </div>
                      <span className="text-sm" style={{ fontWeight: 500 }}>{profile.phone}</span>
                    </div>
                    <div className="flex items-center justify-between" style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--glass-border)' }}>
                      <div className="flex items-center gap-2">
                        <SvgIcon name="shield" size={14} style={{ color: 'var(--text-dim)' }} />
                        <span className="text-sm text-muted">Two-factor auth</span>
                      </div>
                      <span className={`badge ${is2FAEnabled ? 'badge--success' : 'badge--warning'}`}>
                        {is2FAEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between" style={{ padding: '0.75rem 0' }}>
                      <div className="flex items-center gap-2">
                        <SvgIcon name="mail" size={14} style={{ color: 'var(--text-dim)' }} />
                        <span className="text-sm text-muted">Recovery email</span>
                      </div>
                      <span className={`badge ${isEmailVerified ? 'badge--success' : 'badge--warning'}`}>
                        {hasEmail ? (isEmailVerified ? 'Verified' : 'Unverified') : 'Not set'}
                      </span>
                    </div>
                  </div>
                </GlassCard>

                <GlassCard style={{ padding: '1.5rem' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <SvgIcon name="key" size={18} style={{ color: 'var(--accent-light)' }} />
                    <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Change password</h3>
                  </div>
                  <form onSubmit={handlePasswordChange}>
                    <div className="form-group">
                      <label className="form-label">Current password</label>
                      <GlassInput type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="Enter current password" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">New password</label>
                      <GlassInput type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min 8 chars, upper + lower + digit" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Confirm new password</label>
                      <GlassInput type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Re-enter new password" />
                    </div>
                    {pwError && <div className="form-error" style={{ marginBottom: '0.75rem' }}>{pwError}</div>}
                    {pwSuccess && <div style={{ color: 'var(--success)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{pwSuccess}</div>}
                    <GlassButton type="submit" disabled={saving}>
                      {saving ? 'Updating...' : 'Update Password'}
                    </GlassButton>
                  </form>
                </GlassCard>
              </div>
            )}

            {/* ── Security tab ── */}
            {activeTab === 'security' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <GlassCard style={{ padding: '1.5rem' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <SvgIcon name="shield" size={18} style={{ color: 'var(--accent-light)' }} />
                    <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Two-factor authentication</h3>
                  </div>

                  {is2FAEnabled || tfaStep === 'done' ? (
                    <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: '50%', background: 'rgba(16,185,129,0.12)',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem',
                      }}>
                        <SvgIcon name="check" size={24} style={{ color: 'var(--success)' }} />
                      </div>
                      <p style={{ fontWeight: 600, color: 'var(--success)', marginBottom: '0.25rem' }}>Authenticator enabled</p>
                      <p className="text-sm text-dim" style={{ marginBottom: '1rem' }}>Your account is protected with Google Authenticator.</p>

                      {!showReset2FA ? (
                        <GlassButton variant="secondary" size="sm" onClick={() => setShowReset2FA(true)}>
                          Reset 2FA
                        </GlassButton>
                      ) : (
                        <form onSubmit={handleReset2FA} style={{ maxWidth: 280, margin: '0 auto' }}>
                          <div className="form-group">
                            <label className="form-label">Confirm your password to reset</label>
                            <GlassInput type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="Enter password" autoFocus />
                          </div>
                          {resetError && <div className="form-error" style={{ marginBottom: '0.5rem' }}>{resetError}</div>}
                          <div className="flex gap-2">
                            <GlassButton type="submit" variant="danger" size="sm" disabled={resetLoading} className="flex-1">
                              {resetLoading ? 'Resetting...' : 'Confirm Reset'}
                            </GlassButton>
                            <GlassButton type="button" variant="ghost" size="sm" onClick={() => { setShowReset2FA(false); setResetError(''); setResetPassword(''); }}>
                              Cancel
                            </GlassButton>
                          </div>
                        </form>
                      )}
                    </div>
                  ) : tfaStep === 'setup' ? (
                    <div style={{ textAlign: 'center' }}>
                      <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>
                        Scan this QR code with <strong>Google Authenticator</strong>
                      </p>
                      <div style={{
                        display: 'inline-block', background: '#fff', padding: '12px',
                        borderRadius: 'var(--radius-md)', marginBottom: '1.25rem',
                        boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
                      }}>
                        <div ref={qrRef} />
                      </div>
                      <form onSubmit={handleConfirm2FA} style={{ maxWidth: 260, margin: '0 auto' }}>
                        <div className="form-group">
                          <label className="form-label">Verification code</label>
                          <input
                            className="glass-input"
                            value={tfaCode} onChange={e => setTfaCode(e.target.value.replace(/\D/g, ''))}
                            placeholder="000000" maxLength={6} autoComplete="off" autoFocus
                            style={{ textAlign: 'center', fontSize: '1.3rem', letterSpacing: '0.4rem', fontFamily: "'JetBrains Mono', monospace" }}
                          />
                        </div>
                        {tfaError && <div className="form-error" style={{ marginBottom: '0.75rem' }}>{tfaError}</div>}
                        <GlassButton type="submit" disabled={saving} style={{ width: '100%' }}>
                          {saving ? 'Verifying...' : 'Enable 2FA'}
                        </GlassButton>
                      </form>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: '50%', background: 'rgba(239,68,68,0.1)',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem',
                      }}>
                        <SvgIcon name="lock" size={24} style={{ color: 'var(--error)' }} />
                      </div>
                      <p style={{ fontWeight: 600, color: 'var(--error)', marginBottom: '0.25rem' }}>2FA not enabled</p>
                      <p className="text-sm text-dim" style={{ marginBottom: '1.25rem', maxWidth: 340, margin: '0 auto 1.25rem' }}>
                        {isNewUser ? 'Required before using the dashboard.' : 'Add an extra layer of security with Google Authenticator.'}
                      </p>
                      <GlassButton onClick={handleEnable2FA} disabled={saving}>
                        {saving ? 'Generating...' : 'Set up Authenticator'}
                      </GlassButton>
                      {tfaError && <div className="form-error text-center" style={{ marginTop: '0.75rem' }}>{tfaError}</div>}
                    </div>
                  )}
                </GlassCard>
              </div>
            )}

            {/* ── Email tab ── */}
            {activeTab === 'email' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <GlassCard style={{ padding: '1.5rem' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <SvgIcon name="mail" size={18} style={{ color: 'var(--accent-light)' }} />
                    <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Recovery email</h3>
                  </div>
                  <p className="text-sm text-dim" style={{ marginBottom: '1.25rem' }}>
                    Used for password recovery. {isNewUser ? 'Required before using the dashboard.' : 'We will send a verification link to confirm your address.'}
                  </p>

                  {hasEmail && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.75rem 1rem', background: 'rgba(10,12,30,0.6)',
                      borderRadius: 'var(--radius-md)', border: '1px solid var(--glass-border)', marginBottom: '1.25rem',
                    }}>
                      <SvgIcon name="mail" size={16} style={{ color: isEmailVerified ? 'var(--success)' : 'var(--warning)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="text-sm truncate" style={{ fontWeight: 500 }}>{profile.email}</div>
                        <div className={`text-xs ${isEmailVerified ? 'text-success' : ''}`} style={{ color: isEmailVerified ? 'var(--success)' : 'var(--warning)' }}>
                          {isEmailVerified ? 'Verified' : 'Awaiting verification'}
                        </div>
                      </div>
                      <span className={`badge ${isEmailVerified ? 'badge--success' : 'badge--warning'}`}>
                        {isEmailVerified ? 'OK' : 'Pending'}
                      </span>
                    </div>
                  )}

                  <form onSubmit={handleEmailSave}>
                    <div className="form-group">
                      <label className="form-label">Email address</label>
                      <GlassInput type="email" value={email} onChange={e => setEmailState(e.target.value)} placeholder="your@email.com" />
                    </div>
                    {emailMsg && <div className={`text-sm ${emailMsg.includes('sent') ? 'text-accent' : ''}`} style={{ marginBottom: '0.75rem', color: emailMsg.includes('sent') ? 'var(--accent-light)' : 'var(--error)' }}>{emailMsg}</div>}
                    <GlassButton type="submit" disabled={emailLoading}>
                      {emailLoading ? 'Sending...' : hasEmail ? 'Update & Verify' : 'Save Email'}
                    </GlassButton>
                  </form>
                </GlassCard>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
