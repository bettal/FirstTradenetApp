import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import GlassCard from '../components/GlassCard';
import GlassInput from '../components/GlassInput';
import GlassButton from '../components/GlassButton';
import { login, register, verify2FA, fetchCSRF } from '../api';
import { useApp } from '../context';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('auth'); // 'auth' | '2fa'
  const navigate = useNavigate();
  const { addToast } = useApp();
  const pendingAuthRef = useRef(null);

  const handleAuth = useCallback(async (action) => {
    setError('');
    if (!phone || !password) {
      setError('Phone and password are required');
      return;
    }
    setLoading(true);
    try {
      const fn = action === 'login' ? login : register;
      const data = await fn(phone, password);
      if (action === 'register') {
        if (data.error) {
          setError(data.error);
        } else {
          addToast('Registration successful! You can now log in.', 'success');
          setPassword('');
        }
      } else if (data.requires_2fa) {
        pendingAuthRef.current = { phone, password };
        setStep('2fa');
        setCode('');
        setError('');
      } else if (data.error) {
        setError(data.error);
      } else {
        await fetchCSRF();
        navigate('/dashboard');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [phone, password, navigate, addToast]);

  const handle2FA = useCallback(async (e) => {
    e.preventDefault();
    if (!code || code.length < 6) {
      setError('Please enter the 6-digit code');
      return;
    }
    const pending = pendingAuthRef.current;
    if (!pending) {
      setError('Session expired. Please login again.');
      setStep('auth');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const data = await verify2FA(pending.phone, pending.password, code);
      if (data.error) {
        setError(data.error);
      } else {
        await fetchCSRF();
        navigate('/dashboard');
      }
    } catch (err) {
      console.error('2FA error:', err);
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [code, navigate]);

  const handleFormSubmit = useCallback((e) => {
    e.preventDefault();
    handleAuth('login');
  }, [handleAuth]);

  if (step === '2fa') {
    return (
      <div className="auth-wrapper">
        <GlassCard style={{ width: '100%', maxWidth: 400, padding: '2.5rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem' }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Two-Factor Authentication</h2>
            <p className="text-dim text-sm">Enter the 6-digit code from your authenticator app.</p>
          </div>
          <form onSubmit={handle2FA}>
            <GlassInput
              label="Verification Code"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              maxLength={6}
              autoComplete="off"
              autoFocus
              inputMode="numeric"
              style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5rem' }}
            />
            <GlassButton type="submit" disabled={loading} style={{ width: '100%', marginTop: '1rem' }}>
              {loading ? 'Verifying...' : 'Verify & Login'}
            </GlassButton>
            {error && <div className="form-error text-center" style={{ marginTop: '0.75rem' }}>{error}</div>}
          </form>
          <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
            <GlassButton variant="ghost" size="sm" onClick={() => { setStep('auth'); setCode(''); setError(''); }}>
              Back to Login
            </GlassButton>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="auth-wrapper">
      <GlassCard style={{ width: '100%', maxWidth: 400, padding: '2.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem' }}>
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Welcome back</h2>
          <p className="text-dim text-sm">Sign in to your account</p>
        </div>

        <form onSubmit={handleFormSubmit}>
          <GlassInput
            label="Phone or Email"
            type="text"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="+1 234 567 8900 or user@mail.com"
            autoComplete="username"
          />
          <GlassInput
            label="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter your password"
          />

          <div className="flex gap-2" style={{ marginTop: '1rem' }}>
            <GlassButton className="flex-1" type="submit" disabled={loading}>
              {loading ? 'Loading...' : 'Login'}
            </GlassButton>
            <GlassButton variant="secondary" className="flex-1" type="button" onClick={() => handleAuth('register')} disabled={loading}>
              Register
            </GlassButton>
          </div>
        </form>

        {error && <div className="form-error text-center" style={{ marginTop: '0.75rem' }}>{error}</div>}
      </GlassCard>
    </div>
  );
}

const authWrapperStyle = `
.auth-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 2rem;
}
`;
const styleEl = document.createElement('style');
styleEl.textContent = authWrapperStyle;
document.head.appendChild(styleEl);
