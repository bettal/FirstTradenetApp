// Simple Frontend Router & Logic

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    
    if (path === '/' || path === '/index.html') {
        initLogin();
    } else if (path === '/dashboard' || path === '/dashboard.html') {
        initDashboard();
    }
});

// --- Login Logic ---
function initLogin() {
    const authForm = document.getElementById('auth-form');
    const codeForm = document.getElementById('code-form');
    const stepAuth = document.getElementById('step-auth');
    const step2fa = document.getElementById('step-2fa');
    const btnBack = document.getElementById('btn-back');
    const btnLogin = document.getElementById('btn-login');
    const btnRegister = document.getElementById('btn-register');
    
    if (!authForm) return;

    async function handleAuth(action) {
        const phone = document.getElementById('phone').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('auth-error');
        errorDiv.classList.add('hidden');
        
        if (!phone || !password) {
            errorDiv.textContent = 'Phone and password required';
            errorDiv.classList.remove('hidden');
            return;
        }

        const endpoint = action === 'login' ? '/api/auth/login' : '/api/auth/register';
        
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, password })
            });
            const data = await res.json();
            
            if (res.ok) {
                if (action === 'register') {
                    alert('Registration successful! You can now log in.');
                    // Optionally clear password
                } else if (action === 'login') {
                    if (data.requires_2fa) {
                        stepAuth.classList.add('hidden');
                        step2fa.classList.remove('hidden');
                    } else {
                        window.location.href = '/dashboard';
                    }
                }
            } else {
                errorDiv.textContent = data.error || `Failed to ${action}`;
                errorDiv.classList.remove('hidden');
            }
        } catch (err) {
            errorDiv.textContent = 'Network error';
            errorDiv.classList.remove('hidden');
        }
    }

    btnLogin.addEventListener('click', (e) => {
        e.preventDefault();
        handleAuth('login');
    });

    btnRegister.addEventListener('click', (e) => {
        e.preventDefault();
        handleAuth('register');
    });

    codeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const phone = document.getElementById('phone').value;
        const password = document.getElementById('password').value;
        const code = document.getElementById('code').value;
        const errorDiv = document.getElementById('code-error');
        errorDiv.classList.add('hidden');
        
        try {
            const res = await fetch('/api/auth/verify-2fa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, password, code })
            });
            const data = await res.json();
            
            if (res.ok) {
                window.location.href = '/dashboard';
            } else {
                errorDiv.textContent = data.error || 'Invalid code';
                errorDiv.classList.remove('hidden');
            }
        } catch (err) {
            errorDiv.textContent = 'Network error';
            errorDiv.classList.remove('hidden');
        }
    });

    btnBack.addEventListener('click', () => {
        step2fa.classList.add('hidden');
        stepAuth.classList.remove('hidden');
    });
}

// --- Dashboard Logic ---
function initDashboard() {
    const walletsContainer = document.getElementById('wallets-container');
    const modal = document.getElementById('connect-modal');
    const btnOpenModal = document.getElementById('btn-open-modal');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const walletForm = document.getElementById('wallet-form');
    const btnLogout = document.getElementById('btn-logout');

    if (!walletsContainer) return;

    // Fetch and display wallets
    let totpEnabled = false;

    async function loadWallets() {
        try {
            const res = await fetch('/api/wallets');
            if (res.status === 401) {
                window.location.href = '/';
                return;
            }
            const data = await res.json();
            totpEnabled = data.totp_enabled;
            renderWallets(data.wallets || [], totpEnabled);
        } catch (err) {
            console.error('Failed to load wallets');
        }
    }

    function renderWallets(wallets, isTotpEnabled) {
        if (!isTotpEnabled) {
            walletsContainer.innerHTML = `
                <div class="glass-panel" style="grid-column: 1 / -1; padding: 3rem; text-align: center; border-color: var(--error-color);">
                    <p style="margin-bottom: 1rem; color: var(--error-color); font-weight: bold;">Security Alert</p>
                    <p style="margin-bottom: 1.5rem;">You must enable Two-Factor Authentication (2FA) before connecting wallets.</p>
                    <button onclick="document.getElementById('btn-security').click()" style="width: auto;">Enable Security</button>
                </div>
            `;
            btnOpenModal.style.display = 'none';
            return;
        }

        btnOpenModal.style.display = 'inline-block';

        if (wallets.length === 0) {
            walletsContainer.innerHTML = `
                <div class="glass-panel" style="grid-column: 1 / -1; padding: 3rem; text-align: center;">
                    <p style="margin-bottom: 1rem;">No wallets connected yet.</p>
                    <button onclick="document.getElementById('btn-open-modal').click()" style="width: auto;">Connect Your First Wallet</button>
                </div>
            `;
            return;
        }

        walletsContainer.innerHTML = wallets.map(w => `
            <div class="glass-panel wallet-card" data-id="${w.id}" data-name="${w.name}" data-api-key="${w.api_key}" data-login="${w.login || ''}" style="position: relative;">
                <div style="position: absolute; top: 1rem; right: 1rem; display: flex; gap: 0.25rem;">
                    <button class="btn-show-secret" data-id="${w.id}" style="background: transparent; color: var(--accent-color); padding: 0.25rem; width: auto; border: 1px solid var(--accent-color); border-radius: 4px; display: flex; align-items: center; justify-content: center;" title="Show Secret Key">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <button class="btn-edit-wallet" data-id="${w.id}" style="background: transparent; color: var(--text-main); padding: 0.25rem; width: auto; border: 1px solid var(--glass-border); border-radius: 4px; display: flex; align-items: center; justify-content: center;" title="Edit Wallet">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-delete-wallet" data-id="${w.id}" style="background: transparent; color: var(--error-color); padding: 0.25rem; width: auto; border: 1px solid var(--error-color); border-radius: 4px; display: flex; align-items: center; justify-content: center;" title="Delete Wallet">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>
                    </button>
                </div>
                <div class="wallet-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/>
                        <path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/>
                        <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"/>
                    </svg>
                </div>
                <h3>${w.name}</h3>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem;">
                    <span style="font-size: 0.875rem; color: var(--text-muted);">Tradernet API</span>
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></span>
                </div>
                <div class="wallet-api-key">${w.api_key.substring(0, 8)}••••••••••••</div>
                ${w.login ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">${w.login}</div>` : ''}
                <div style="margin-top: 1rem; text-align: center; font-size: 0.75rem; color: var(--accent-color);">Click to Open API Explorer</div>
            </div>
        `).join('');
    }

    // Modal Events
    btnOpenModal.addEventListener('click', () => {
        modal.classList.add('active');
    });

    btnCloseModal.addEventListener('click', () => {
        modal.classList.remove('active');
        walletForm.reset();
        document.getElementById('wallet-error').classList.add('hidden');
    });

    // Close on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            btnCloseModal.click();
        }
    });

    // --- API Explorer Logic ---
    const explorerModal = document.getElementById('explorer-modal');
    const btnCloseExplorer = document.getElementById('btn-close-explorer');
    const explorerForm = document.getElementById('explorer-form');
    const explorerWalletId = document.getElementById('explorer-wallet-id');
    const explorerTitle = document.getElementById('explorer-title');
    const apiResponse = document.getElementById('api-response');
    const expCategory = document.getElementById('explorer-category');
    const expCommand = document.getElementById('explorer-command');
    const expParamsContainer = document.getElementById('explorer-params-container');

    let explorerCommands = [];
    let selectedCommandDef = null;

    async function loadExplorerCommands() {
        try {
            const res = await fetch('/api/commands');
            if (res.ok) {
                explorerCommands = await res.json();
                populateCategories();
            }
        } catch (err) {
            console.error('Failed to load commands');
        }
    }

    function populateCategories() {
        const cats = new Map();
        explorerCommands.forEach(cmd => {
            if (!cats.has(cmd.category)) {
                cats.set(cmd.category, cmd.category_display);
            }
        });
        expCategory.innerHTML = '<option value="">-- Select Category --</option>';
        cats.forEach((display, key) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = display;
            expCategory.appendChild(opt);
        });
    }

    function populateCommands(category) {
        expCommand.innerHTML = '<option value="">-- Select Command --</option>';
        expParamsContainer.innerHTML = '';
        selectedCommandDef = null;

        if (!category) return;

        const filtered = explorerCommands.filter(cmd => cmd.category === category);
        filtered.forEach(cmd => {
            const opt = document.createElement('option');
            opt.value = cmd.name;
            opt.textContent = cmd.display_name;
            expCommand.appendChild(opt);
        });
    }

    function renderParams(commandDef) {
        expParamsContainer.innerHTML = '';
        selectedCommandDef = commandDef;
        if (!commandDef || !commandDef.params) return;

        commandDef.params.forEach(param => {
            const group = document.createElement('div');
            group.className = 'form-group';

            const label = document.createElement('label');
            label.setAttribute('for', `param-${param.name}`);
            label.textContent = `${param.name}${param.required ? ' *' : ''}`;

            const input = document.createElement(param.type === 'bool' ? 'select' : param.type === 'json' ? 'textarea' : 'input');
            input.id = `param-${param.name}`;
            input.name = param.name;
            input.dataset.paramType = param.type;

            if (param.type === 'bool') {
                const trueOpt = document.createElement('option');
                trueOpt.value = 'true';
                trueOpt.textContent = 'true';
                const falseOpt = document.createElement('option');
                falseOpt.value = 'false';
                falseOpt.textContent = 'false';
                input.appendChild(trueOpt);
                input.appendChild(falseOpt);
                input.value = param.default !== undefined ? String(param.default) : 'true';
            } else if (param.type === 'json') {
                input.rows = 4;
                input.placeholder = param.default || '{}';
                input.style.cssText = 'width: 100%; padding: 0.75rem 1rem; background: rgba(15, 23, 42, 0.6); border: 1px solid var(--glass-border); border-radius: 8px; color: var(--text-main); font-family: monospace; font-size: 0.875rem; resize: vertical;';
            } else if (param.type === 'int' || param.type === 'float') {
                input.type = 'number';
                input.step = param.type === 'float' ? '0.01' : '1';
                if (param.default !== undefined && param.default !== '') input.value = param.default;
                input.placeholder = String(param.default ?? '');
            } else {
                input.type = 'text';
                if (param.default !== undefined && param.default !== '') input.value = param.default;
                input.placeholder = param.default || param.description || '';
            }

            input.style.cssText = (input.style.cssText || '') + 'width: 100%; padding: 0.75rem 1rem; background: rgba(15, 23, 42, 0.6); border: 1px solid var(--glass-border); border-radius: 8px; color: var(--text-main); font-size: 0.875rem;';

            if (param.description) {
                const desc = document.createElement('small');
                desc.style.cssText = 'display: block; color: var(--text-muted); font-size: 0.75rem; margin-top: 0.25rem;';
                desc.textContent = param.description;
                group.appendChild(label);
                group.appendChild(input);
                group.appendChild(desc);
            } else {
                group.appendChild(label);
                group.appendChild(input);
            }

            expParamsContainer.appendChild(group);
        });
    }

    expCategory.addEventListener('change', () => {
        populateCommands(expCategory.value);
    });

    expCommand.addEventListener('change', () => {
        const cmdName = expCommand.value;
        const cmdDef = explorerCommands.find(c => c.name === cmdName);
        renderParams(cmdDef);
    });

    // --- 2FA Verify Modal Logic ---
    const tfaVerifyModal = document.getElementById('tfa-verify-modal');
    const btnCloseTfaVerify = document.getElementById('btn-close-tfa-verify');
    const tfaVerifyForm = document.getElementById('tfa-verify-form');
    let pending2faAction = null;

    function closeTfaVerify() {
        tfaVerifyModal.classList.remove('active');
        tfaVerifyForm.reset();
        document.getElementById('tfa-verify-error').classList.add('hidden');
        pending2faAction = null;
    }

    btnCloseTfaVerify.addEventListener('click', closeTfaVerify);
    tfaVerifyModal.addEventListener('click', (e) => {
        if (e.target === tfaVerifyModal) closeTfaVerify();
    });

    tfaVerifyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('tfa-verify-code').value;
        const errorDiv = document.getElementById('tfa-verify-error');
        errorDiv.classList.add('hidden');

        try {
            const res = await fetch('/api/auth/reverify-2fa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            const data = await res.json();

            if (res.ok) {
                const action = pending2faAction;
                closeTfaVerify();
                if (action) action();
            } else {
                errorDiv.textContent = data.error || 'Invalid code';
                errorDiv.classList.remove('hidden');
            }
        } catch (err) {
            errorDiv.textContent = 'Network error';
            errorDiv.classList.remove('hidden');
        }
    });

    // --- Edit Wallet Modal Logic ---
    const editWalletModal = document.getElementById('edit-wallet-modal');
    const btnCloseEditModal = document.getElementById('btn-close-edit-modal');
    const editWalletForm = document.getElementById('edit-wallet-form');

    const btnToggleSecret = document.getElementById('btn-toggle-secret');
    const editSecretKeyInput = document.getElementById('edit-secret-key');
    const toggleSecretIcon = document.getElementById('toggle-secret-icon');

    btnToggleSecret.addEventListener('click', () => {
        const isPassword = editSecretKeyInput.type === 'password';
        editSecretKeyInput.type = isPassword ? 'text' : 'password';
        toggleSecretIcon.innerHTML = isPassword
            ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
            : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    });

    function closeEditModal() {
        editWalletModal.classList.remove('active');
        editWalletForm.reset();
        document.getElementById('edit-wallet-error').classList.add('hidden');
        // Reset to password mode
        editSecretKeyInput.type = 'password';
        toggleSecretIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }

    btnCloseEditModal.addEventListener('click', closeEditModal);
    editWalletModal.addEventListener('click', (e) => {
        if (e.target === editWalletModal) closeEditModal();
    });

    editWalletForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-wallet-id').value;
        const name = document.getElementById('edit-wallet-name').value;
        const apiKey = document.getElementById('edit-api-key').value;
        const secretKey = document.getElementById('edit-secret-key').value;
        const errorDiv = document.getElementById('edit-wallet-error');
        errorDiv.classList.add('hidden');

        const login = document.getElementById('edit-login').value;
        const password = document.getElementById('edit-password').value;
        const body = { id, name, apiKey };
        if (secretKey) body.secretKey = secretKey;
        if (login) body.login = login;
        if (password) body.password = password;

        try {
            const res = await fetch('/api/wallets', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();

            if (res.ok) {
                closeEditModal();
                loadWallets();
            } else {
                errorDiv.textContent = data.error || 'Failed to update wallet';
                errorDiv.classList.remove('hidden');
            }
        } catch (err) {
            errorDiv.textContent = 'Network error';
            errorDiv.classList.remove('hidden');
        }
    });

    // --- Secret Key Modal Logic ---
    const secretModal = document.getElementById('secret-modal');
    const btnCloseSecretModal = document.getElementById('btn-close-secret-modal');
    const btnCopySecret = document.getElementById('btn-copy-secret');

    function closeSecretModal() {
        secretModal.classList.remove('active');
        document.getElementById('secret-error').classList.add('hidden');
    }

    btnCloseSecretModal.addEventListener('click', closeSecretModal);
    secretModal.addEventListener('click', (e) => {
        if (e.target === secretModal) closeSecretModal();
    });

    btnCopySecret.addEventListener('click', () => {
        const secretText = document.getElementById('secret-key-value').textContent;
        if (secretText) {
            navigator.clipboard.writeText(secretText).catch(() => {});
        }
    });

    // Make wallet cards clickable to open explorer
    walletsContainer.addEventListener('click', async (e) => {
        const deleteBtn = e.target.closest('.btn-delete-wallet');
        if (deleteBtn) {
            e.stopPropagation();
            if (confirm('Are you sure you want to delete this wallet?')) {
                const walletId = deleteBtn.dataset.id;
                try {
                    const res = await fetch('/api/wallets', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: walletId })
                    });
                    if (res.ok) {
                        loadWallets();
                    } else {
                        alert('Failed to delete wallet');
                    }
                } catch (err) {
                    alert('Network error');
                }
            }
            return;
        }

        const editBtn = e.target.closest('.btn-edit-wallet');
        if (editBtn) {
            e.stopPropagation();
            const card = editBtn.closest('.wallet-card');
            pending2faAction = async () => {
                document.getElementById('edit-wallet-id').value = card.dataset.id;
                document.getElementById('edit-wallet-name').value = card.dataset.name;
                document.getElementById('edit-api-key').value = card.dataset.apiKey;
                document.getElementById('edit-login').value = card.dataset.login || '';
                document.getElementById('edit-password').value = '';
                document.getElementById('edit-secret-key').value = '';
                editSecretKeyInput.type = 'password';
                toggleSecretIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
                editWalletModal.classList.add('active');
                // Fetch current secret key and fill it in (masked)
                try {
                    const res = await fetch(`/api/wallets/secret?id=${card.dataset.id}`);
                    const data = await res.json();
                    if (res.ok) {
                        document.getElementById('edit-secret-key').value = data.secret_key;
                    }
                } catch (err) {}
            };
            tfaVerifyModal.classList.add('active');
            document.getElementById('tfa-verify-code').focus();
            return;
        }

        const showSecretBtn = e.target.closest('.btn-show-secret');
        if (showSecretBtn) {
            e.stopPropagation();
            const card = showSecretBtn.closest('.wallet-card');
            pending2faAction = async () => {
                document.getElementById('secret-wallet-name').textContent = card.dataset.name;
                document.getElementById('secret-api-key').textContent = card.dataset.apiKey;
                document.getElementById('secret-key-value').textContent = 'Loading...';
                document.getElementById('secret-error').classList.add('hidden');
                secretModal.classList.add('active');
                try {
                    const res = await fetch(`/api/wallets/secret?id=${card.dataset.id}`);
                    const data = await res.json();
                    if (res.ok) {
                        document.getElementById('secret-api-key').textContent = data.api_key;
                        document.getElementById('secret-key-value').textContent = data.secret_key;
                    } else {
                        document.getElementById('secret-error').textContent = data.error || 'Failed to load secret';
                        document.getElementById('secret-error').classList.remove('hidden');
                        document.getElementById('secret-key-value').textContent = '';
                    }
                } catch (err) {
                    document.getElementById('secret-error').textContent = 'Network error';
                    document.getElementById('secret-error').classList.remove('hidden');
                    document.getElementById('secret-key-value').textContent = '';
                }
            };
            tfaVerifyModal.classList.add('active');
            document.getElementById('tfa-verify-code').focus();
            return;
        }

        const card = e.target.closest('.wallet-card');
        if (card) {
            const walletId = card.dataset.id;
            const walletName = card.dataset.name;
            explorerTitle.textContent = `API Explorer: ${walletName}`;
            explorerWalletId.value = walletId;
            apiResponse.textContent = "Awaiting request...";
            loadExplorerCommands();
            explorerModal.classList.add('active');
        }
    });

    btnCloseExplorer.addEventListener('click', () => {
        explorerModal.classList.remove('active');
        explorerForm.reset();
        expParamsContainer.innerHTML = '';
        document.getElementById('explorer-error').classList.add('hidden');
    });

    explorerModal.addEventListener('click', (e) => {
        if (e.target === explorerModal) {
            btnCloseExplorer.click();
        }
    });

    explorerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const walletId = explorerWalletId.value;
        const commandName = expCommand.value;
        const errorDiv = document.getElementById('explorer-error');
        errorDiv.classList.add('hidden');

        if (!commandName) {
            errorDiv.textContent = 'Please select a command';
            errorDiv.classList.remove('hidden');
            return;
        }

        const params = {};
        const paramInputs = expParamsContainer.querySelectorAll('input, select, textarea');
        paramInputs.forEach(input => {
            const type = input.dataset.paramType;
            let val = input.value;
            if (type === 'int') val = parseInt(val, 10);
            else if (type === 'float') val = parseFloat(val);
            else if (type === 'bool') val = val === 'true';
            else if (type === 'json') {
                try { val = JSON.parse(val || '{}'); } catch { val = {}; }
            }
            params[input.name] = val;
        });

        apiResponse.textContent = "Loading...";

        try {
            const res = await fetch('/api/wallet-command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletId, command: commandName, params })
            });
            const data = await res.json();
            apiResponse.textContent = JSON.stringify(data, null, 2);
        } catch (err) {
            apiResponse.textContent = "Network error or server unavailable.";
        }
    });

    // Add Wallet
    walletForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('wallet-name').value;
        const apiKey = document.getElementById('api-key').value;
        const secretKey = document.getElementById('secret-key').value;
        const login = document.getElementById('login').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('wallet-error');
        errorDiv.classList.add('hidden');

        try {
            const res = await fetch('/api/wallets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, apiKey, secretKey, login, password })
            });
            const data = await res.json();

            if (res.ok) {
                btnCloseModal.click();
                loadWallets();
            } else {
                errorDiv.textContent = data.error || 'Failed to connect wallet';
                errorDiv.classList.remove('hidden');
            }
        } catch (err) {
            errorDiv.textContent = 'Network error';
            errorDiv.classList.remove('hidden');
        }
    });

    // Logout
    btnLogout.addEventListener('click', () => {
        document.cookie = "session_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        window.location.href = '/';
    });

    // --- Security Modal Logic ---
    const securityModal = document.getElementById('security-modal');
    const btnSecurity = document.getElementById('btn-security');
    const btnCloseSecurity = document.getElementById('btn-close-security');
    const btnSetup2fa = document.getElementById('btn-setup-2fa');
    const securityIdle = document.getElementById('security-idle');
    const securitySetup = document.getElementById('security-setup');
    const confirm2faForm = document.getElementById('confirm-2fa-form');
    const qrCodeDiv = document.getElementById('dashboard-qrcode');
    const securityErrorMain = document.getElementById('security-error-main');
    const securityErrorSetup = document.getElementById('security-error-setup');

    if (btnSecurity) {
        btnSecurity.addEventListener('click', () => {
            securityModal.classList.add('active');
            securityIdle.classList.remove('hidden');
            securitySetup.classList.add('hidden');
            securityErrorMain.classList.add('hidden');
            securityErrorSetup.classList.add('hidden');
        });
    }

    if (btnCloseSecurity) {
        btnCloseSecurity.addEventListener('click', () => {
            securityModal.classList.remove('active');
        });
        
        securityModal.addEventListener('click', (e) => {
            if (e.target === securityModal) {
                btnCloseSecurity.click();
            }
        });
    }

    if (btnSetup2fa) {
        btnSetup2fa.addEventListener('click', async () => {
            securityErrorMain.classList.add('hidden');
            try {
                const res = await fetch('/api/auth/setup-2fa', { method: 'POST' });
                const data = await res.json();
                
                if (res.ok) {
                    securityIdle.classList.add('hidden');
                    securitySetup.classList.remove('hidden');
                    qrCodeDiv.innerHTML = '';
                    new QRCode(qrCodeDiv, {
                        text: data.setupUri,
                        width: 150,
                        height: 150,
                        colorDark : "#000000",
                        colorLight : "#ffffff",
                        correctLevel : QRCode.CorrectLevel.M
                    });
                } else {
                    securityErrorMain.textContent = data.error || 'Failed to setup 2FA';
                    securityErrorMain.classList.remove('hidden');
                }
            } catch (err) {
                securityErrorMain.textContent = 'Network error';
                securityErrorMain.classList.remove('hidden');
            }
        });
    }

    if (confirm2faForm) {
        confirm2faForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = document.getElementById('confirm-code').value;
            securityErrorSetup.classList.add('hidden');
            
            try {
                const res = await fetch('/api/auth/confirm-2fa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code })
                });
                const data = await res.json();
                
                if (res.ok) {
                    alert('2FA successfully enabled!');
                    btnCloseSecurity.click();
                    loadWallets(); // Reload to show wallet options
                } else {
                    securityErrorSetup.textContent = data.error || 'Invalid code';
                    securityErrorSetup.classList.remove('hidden');
                }
            } catch (err) {
                securityErrorSetup.textContent = 'Network error';
                securityErrorSetup.classList.remove('hidden');
            }
        });
    }

    // Init
    loadWallets();
}
