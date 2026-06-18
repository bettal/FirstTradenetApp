import { useState } from 'react';
import GlassInput from '../components/GlassInput';
import GlassButton from '../components/GlassButton';
import SlidePanel from '../components/SlidePanel';
import { reverify2FA } from '../api';

export default function TfaVerifyPanel({ open, onClose, onVerified }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await reverify2FA(code);
      if (res.error) {
        setError(res.error);
      } else {
        setCode('');
        onClose();
        if (onVerified) onVerified();
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setCode('');
      setError('');
      onClose();
    }
  };

  return (
    <SlidePanel open={open} onClose={handleClose} title="Verify Identity">
      <p className="text-dim text-sm" style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
        Enter your Google Authenticator code to proceed.
      </p>
      <form onSubmit={handleSubmit}>
        <GlassInput
          label="Verification Code"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="000000"
          maxLength={6}
          autoComplete="off"
          autoFocus
          style={{ textAlign: 'center', fontSize: '1.25rem', letterSpacing: '0.5rem' }}
        />
        {error && <div className="form-error text-center mb-2">{error}</div>}
        <GlassButton type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Verifying...' : 'Verify & Continue'}
        </GlassButton>
      </form>
    </SlidePanel>
  );
}
