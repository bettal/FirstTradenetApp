import { useState, useEffect } from 'react';
import GlassInput from './GlassInput';
import GlassButton from './GlassButton';
import SlidePanel from './SlidePanel';
import { createWallet, updateWallet } from '../api';
import { useApp } from '../context';

export default function ConnectWalletPanel({ open, onClose, onDone, editWallet = null }) {
  const isEdit = !!editWallet;
  const [form, setForm] = useState({
    name: editWallet?.name || '',
    apiKey: editWallet?.api_key || '',
    secretKey: '',
    login: editWallet?.login || '',
    password: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { addToast } = useApp();

  // Reset form when wallet selection changes or panel opens
  useEffect(() => {
    setForm({
      name: editWallet?.name || '',
      apiKey: editWallet?.api_key || '',
      secretKey: '',
      login: editWallet?.login || '',
      password: '',
    });
    setError('');
  }, [open, editWallet?.id]);

  const updateField = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.apiKey || (!isEdit && !form.secretKey)) {
      setError('Name, API Key, and Secret Key are required');
      return;
    }
    if (form.login && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.login)) {
      setError('Please enter a valid email address for Login');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = { name: form.name, apiKey: form.apiKey };
      if (isEdit) {
        body.id = editWallet.id;
        if (form.secretKey) body.secretKey = form.secretKey;
        if (form.login) body.login = form.login;
        if (form.password) body.password = form.password;
      } else {
        body.secretKey = form.secretKey;
        if (form.login) body.login = form.login;
        if (form.password) body.password = form.password;
      }
      const fn = isEdit ? updateWallet : createWallet;
      const res = await fn(body);
      if (res.error) {
        setError(res.error);
      } else {
        addToast(isEdit ? 'Wallet updated' : 'Wallet connected');
        onClose();
        if (onDone) onDone();
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) onClose();
  };

  return (
    <SlidePanel open={open} onClose={handleClose} title={isEdit ? 'Edit Wallet' : 'Connect Wallet'}>
      <form onSubmit={handleSubmit}>
        <GlassInput label="Wallet Name" value={form.name} onChange={updateField('name')} placeholder="e.g. Main Investment" required />
        <GlassInput label="API Key (Public Key)" value={form.apiKey} onChange={updateField('apiKey')} placeholder="Enter API public key" required />
        <GlassInput label="Secret Key (Private Key)" type="password" value={form.secretKey} onChange={updateField('secretKey')} placeholder={isEdit ? 'Leave blank to keep current' : 'Enter API private key'} required={!isEdit} />

        <div style={{ margin: '1.5rem 0 0.75rem' }}>
          <div style={{ height: 1, background: 'var(--glass-border)', marginBottom: '1rem' }} />
          <p className="text-dim text-xs" style={{ marginBottom: '0.75rem' }}>
            Additional credentials (optional) — for API methods that use login/password authentication instead of key-based HMAC signing.
          </p>
        </div>
        <GlassInput label="Login (Email)" type="email" value={form.login} onChange={updateField('login')} placeholder="your@email.com — optional" />
        <GlassInput label="Password" type="password" value={form.password} onChange={updateField('password')} placeholder="Optional" />
        {error && <div className="form-error" style={{ marginBottom: '1rem' }}>{error}</div>}
        <GlassButton type="submit" disabled={saving} style={{ width: '100%' }}>
          {saving ? (isEdit ? 'Saving...' : 'Connecting...') : (isEdit ? 'Save Changes' : 'Connect Wallet')}
        </GlassButton>
      </form>
    </SlidePanel>
  );
}
