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

export async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (csrfToken && (options.method || 'GET').toUpperCase() !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken;
  }
  headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  return fetch(url, { ...options, headers });
}

// ── Auth ──────────────────────────────────────────────────────────────
export async function login(phone, password) {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
  if (!res.ok && res.status !== 200) {
    return res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  }
  return res.json();
}

export async function register(phone, password) {
  const res = await apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
  return res.json();
}

export async function verify2FA(phone, password, code) {
  const res = await apiFetch('/api/auth/verify-2fa', {
    method: 'POST',
    body: JSON.stringify({ phone, password, code }),
  });
  return res.json();
}

export async function setup2FA() {
  const res = await apiFetch('/api/auth/setup-2fa', { method: 'POST' });
  return res.json();
}

export async function confirm2FA(code) {
  const res = await apiFetch('/api/auth/confirm-2fa', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  return res.json();
}

export async function reverify2FA(code) {
  const res = await apiFetch('/api/auth/reverify-2fa', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  return res.json();
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
  return res.json();
}

export async function updateWallet({ id, name, apiKey, secretKey, login, password }) {
  const res = await apiFetch('/api/wallets', {
    method: 'PUT',
    body: JSON.stringify({ id, name, apiKey, secretKey, login, password }),
  });
  return res.json();
}

export async function deleteWallet(id) {
  const res = await apiFetch('/api/wallets', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  });
  return res.json();
}

export async function getWalletSecret(id) {
  const res = await apiFetch(`/api/wallets/secret?id=${id}`);
  return res.json();
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
  return res.json();
}

// ── Commands & Wallet Command ─────────────────────────────────────────
export async function getCommands() {
  const res = await apiFetch('/api/commands');
  return res.json();
}

export async function executeWalletCommand(walletId, command, params = {}) {
  const res = await apiFetch('/api/wallet-command', {
    method: 'POST',
    body: JSON.stringify({ walletId, command, params }),
  });
  return res.json();
}

export async function logout() {
  // Server-side session invalidation
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {}
  // Clear client-side cookie
  document.cookie = 'session_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  window.location.href = '/login';
}
