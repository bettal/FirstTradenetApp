let csrfToken = '';

export async function fetchCSRF() {
  try {
    const res = await fetch('/api/csrf-token');
    if (res.ok) {
      const data = await res.json();
      csrfToken = data.csrfToken || '';
    }
  } catch { csrfToken = ''; }
  return csrfToken;
}

export function getCSRF() {
  return csrfToken;
}

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (csrfToken && (options.method || 'GET').toUpperCase() !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken;
  }
  headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  return fetch(url, { ...options, headers });
}

async function handleResponse(res, ignore401 = false) {
  if (res.status === 401 && !ignore401) {
    return { error: 'Unauthorized', status: 401 };
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return { ...err, status: res.status };
  }
  const data = await res.json().catch(() => null);
  return data === null ? { error: 'Invalid response' } : data;
}

// ── Auth ──────────────────────────────────────────────────────────────
export async function login(phone, password) {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
  return handleResponse(res, true);
}

export async function register(phone, password) {
  const res = await apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
  return handleResponse(res);
}

export async function verify2FA(phone, password, code) {
  const res = await apiFetch('/api/auth/verify-2fa', {
    method: 'POST',
    body: JSON.stringify({ phone, password, code }),
  });
  return handleResponse(res, true);
}

export async function setup2FA() {
  const res = await apiFetch('/api/auth/setup-2fa', { method: 'POST' });
  return handleResponse(res);
}

export async function confirm2FA(code) {
  const res = await apiFetch('/api/auth/confirm-2fa', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  return handleResponse(res);
}

export async function forgotPassword(phone) {
  const res = await apiFetch('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
  return handleResponse(res, true);
}

export async function reverify2FA(code) {
  const res = await apiFetch('/api/auth/reverify-2fa', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  return handleResponse(res, true);
}

// ── Wallets ───────────────────────────────────────────────────────────
export async function getWallets() {
  const res = await apiFetch('/api/wallets');
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) {
    console.error('Wallets fetch failed:', res.status, await res.text().catch(() => ''));
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function createWallet({ name, apiKey, secretKey, login, password }) {
  const res = await apiFetch('/api/wallets', {
    method: 'POST',
    body: JSON.stringify({ name, apiKey, secretKey, login, password }),
  });
  return handleResponse(res);
}

export async function updateWallet({ id, name, apiKey, secretKey, login, password }) {
  const res = await apiFetch('/api/wallets', {
    method: 'PUT',
    body: JSON.stringify({ id, name, apiKey, secretKey, login, password }),
  });
  return handleResponse(res);
}

export async function deleteWallet(id) {
  const res = await apiFetch('/api/wallets', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  });
  return handleResponse(res);
}

export async function getWalletSecret(id) {
  const res = await apiFetch(`/api/wallets/secret?id=${id}`);
  return handleResponse(res);
}

// ── Profile ──────────────────────────────────────────────────────────
export async function getProfile() {
  const res = await apiFetch('/api/profile');
  return handleResponse(res);
}

export async function changePassword(currentPassword, newPassword) {
  const res = await apiFetch('/api/profile/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return handleResponse(res);
}

export async function setEmail(email) {
  const res = await apiFetch('/api/profile/email', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}

export async function verifyEmail(token) {
  const res = await fetch(`/api/profile/email/verify?token=${encodeURIComponent(token)}`);
  return handleResponse(res);
}

export async function reset2FA(password) {
  const res = await apiFetch('/api/profile/reset-2fa', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  return handleResponse(res);
}

// ── Dictionaries ──────────────────────────────────────────────────────
export async function getDictionaries() {
  const res = await apiFetch('/api/dictionaries');
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getDictionaryEntries(code) {
  const res = await apiFetch(`/api/dictionaries/${code}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function refreshDictionary(code, walletId) {
  const res = await apiFetch(`/api/dictionaries/${code}/refresh`, {
    method: 'POST',
    body: JSON.stringify({ walletId: parseInt(walletId) }),
  });
  return handleResponse(res);
}

// ── Commands & Wallet Command ─────────────────────────────────────────
export async function getCommands() {
  const res = await apiFetch('/api/commands');
  return handleResponse(res);
}

export async function executeWalletCommand(walletId, command, params = {}) {
  const res = await apiFetch('/api/wallet-command', {
    method: 'POST',
    body: JSON.stringify({ walletId, command, params }),
  });
  return handleResponse(res);
}

export async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {}
  window.location.href = '/login';
}
