import { useState, useRef, useCallback } from 'react';
import SlidePanel from '../components/SlidePanel';
import GlassInput from '../components/GlassInput';
import GlassButton from '../components/GlassButton';
import { setup2FA, confirm2FA } from '../api';
import { useApp } from '../context';

export default function SecurityPanel({ open, onClose, on2FAEnabled }) {
  const [step, setStep] = useState('idle'); // idle | setup
  const [setupUri, setSetupUri] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const qrRef = useRef(null);
  const { addToast } = useApp();

  const handleEnable2FA = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const data = await setup2FA();
      if (data.error) {
        setError(data.error);
      } else {
        setSetupUri(data.setupUri);
        setStep('setup');
        // Draw QR code after render
        setTimeout(() => {
          if (qrRef.current && window.QRCode) {
            qrRef.current.innerHTML = '';
            new window.QRCode(qrRef.current, {
              text: data.setupUri,
              width: 180,
              height: 180,
              colorDark: '#000000',
              colorLight: '#ffffff',
              correctLevel: window.QRCode.CorrectLevel.M,
            });
          }
        }, 100);
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleConfirm2FA = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await confirm2FA(code);
      if (data.error) {
        setError(data.error);
      } else {
        addToast('2FA successfully enabled!', 'success');
        onClose();
        on2FAEnabled();
        setStep('idle');
        setCode('');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    setStep('idle');
    setCode('');
    setError('');
  };

  return (
    <SlidePanel open={open} onClose={handleClose} title="Security Settings" width="420px">
      {step === 'idle' && (
        <div style={{ textAlign: 'center' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem' }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <p className="text-dim" style={{ marginBottom: '1.5rem', fontSize: '0.875rem' }}>
            Enhance your account security by enabling Two-Factor Authentication.
          </p>
          <GlassButton onClick={handleEnable2FA} disabled={loading}>
            {loading ? 'Loading...' : 'Enable Google Authenticator'}
          </GlassButton>
          {error && <div className="form-error text-center" style={{ marginTop: '1rem' }}>{error}</div>}
        </div>
      )}

      {step === 'setup' && (
        <div style={{ textAlign: 'center' }}>
          <h4 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>Setup 2FA</h4>
          <p className="text-dim text-sm" style={{ marginBottom: '1rem' }}>
            Scan this QR code with Google Authenticator.
          </p>
          <div
            ref={qrRef}
            style={{
              display: 'inline-block',
              background: '#fff',
              padding: '10px',
              borderRadius: 'var(--radius-md)',
              marginBottom: '1.5rem',
            }}
          />
          <form onSubmit={handleConfirm2FA} style={{ textAlign: 'left' }}>
            <GlassInput
              label="Verification Code"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="Enter 6-digit code"
              maxLength={6}
              autoComplete="off"
              autoFocus
            />
            {error && <div className="form-error" style={{ marginBottom: '0.5rem' }}>{error}</div>}
            <GlassButton type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Verifying...' : 'Verify & Enable'}
            </GlassButton>
          </form>
        </div>
      )}
    </SlidePanel>
  );
}
